/**
 * user-gate.ts — 跨平台用户闸门（invisible + 紧急拉黑）
 *
 * 平台无关的单一真相源：按 composite userId（如 "telegram:123" / "discord:456" / "onebot:789"）
 * 维护两类集合，并持久化到 workspace 下的 JSON 文件。
 *
 * - invisible：用户自愿隐身（/invisible 命令或 dashboard），消息对 bot 完全不可见。
 * - blocked：LLM 通过 emergency.block 紧急拉黑，消息完全丢弃；仅 dashboard 人工解除。
 *
 * 入站丢弃在 main.ts 的 nc.message handler 顶部统一执行（所有平台都经此汇聚），
 * 因此各 adapter 无需各自实现；emergency 的"发一次预设文案"由对应 adapter 的 sendText 完成。
 */

import fs from "node:fs";
import path from "node:path";
import { createLogger } from "../core/logger.js";

const log = createLogger("user-gate");

const INVISIBLE_USERS_PATH = "workspace/invisible-users.json";
const BLOCKED_USERS_PATH = "workspace/blocked-users.json";

function loadSet(filePath: string): Set<string> {
    try {
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
            if (Array.isArray(data)) return new Set(data.map((v) => String(v)));
        }
    } catch { /* ignore corrupt file */ }
    return new Set();
}

function saveSet(filePath: string, users: Set<string>): void {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify([...users]), "utf-8");
    } catch (err) {
        log.warn("saveSet: 写入失败", { filePath, error: String(err) });
    }
}

function normalizeIds(userIds: string[]): Set<string> {
    return new Set(userIds.map((s) => String(s).trim()).filter(Boolean));
}

export class UserGate {
    private invisible: Set<string>;
    private blocked: Set<string>;

    constructor() {
        this.invisible = loadSet(INVISIBLE_USERS_PATH);
        this.blocked = loadSet(BLOCKED_USERS_PATH);
    }

    /** 入站是否应丢弃该用户消息（隐身或被拉黑）。 */
    shouldDrop(userId: string): boolean {
        return this.invisible.has(userId) || this.blocked.has(userId);
    }

    // ─── invisible ───
    isInvisible(userId: string): boolean { return this.invisible.has(userId); }
    getInvisible(): string[] { return [...this.invisible]; }
    setInvisible(userIds: string[]): void {
        this.invisible = normalizeIds(userIds);
        saveSet(INVISIBLE_USERS_PATH, this.invisible);
        log.info("隐身列表已更新", { count: this.invisible.size });
    }
    /** 切换隐身状态，返回切换后的新状态（true=现在隐身）。 */
    toggleInvisible(userId: string): boolean {
        if (this.invisible.has(userId)) {
            this.invisible.delete(userId);
            saveSet(INVISIBLE_USERS_PATH, this.invisible);
            return false;
        }
        this.invisible.add(userId);
        saveSet(INVISIBLE_USERS_PATH, this.invisible);
        return true;
    }

    // ─── blocked（紧急拉黑）───
    isBlocked(userId: string): boolean { return this.blocked.has(userId); }
    getBlocked(): string[] { return [...this.blocked]; }
    setBlocked(userIds: string[]): void {
        this.blocked = normalizeIds(userIds);
        saveSet(BLOCKED_USERS_PATH, this.blocked);
        log.info("拉黑列表已更新", { count: this.blocked.size });
    }
    /** 拉黑一个用户（幂等）。返回是否为本次新拉黑（用于决定是否发送一次预设文案）。 */
    block(userId: string): { newlyBlocked: boolean } {
        const uid = String(userId).trim();
        if (!uid || this.blocked.has(uid)) return { newlyBlocked: false };
        this.blocked.add(uid);
        saveSet(BLOCKED_USERS_PATH, this.blocked);
        log.info("紧急拉黑用户", { userId: uid });
        return { newlyBlocked: true };
    }
}

/** 进程级单例：所有 adapter / main / dashboard / host-call 共享同一份闸门状态。 */
export const userGate = new UserGate();
