/**
 * onebot-message-utils.ts — OneBot 消息段归一化与渲染的公共工具
 *
 * 此模块统一 adapter、sandbox module、host-call-handler 三处曾各自实现的逻辑：
 *   - normalizeMentionTarget  / normalizeMentionTargets  — @ 目标归一
 *   - summarizeOneBotMessage  — 消息段→纯文本渲染
 *
 * 黄金实现以 adapter 版 normalizeMentionTarget 为准（用 parseChatId 解析复合 ID，
 * 完整处理 onebot:private: / onebot:group: / 裸 QQ 等形态）；segment 渲染合并了
 * host-call-handler 版的非对象防御逻辑——TS 结构类型不防运行时畸形对象，
 * 轻量防御对三处调用方都有保护价值。
 */

import { parseChatId } from "../core/chat-id.js";

export type OneBotMessageSegment = {
    type: string;
    data?: Record<string, unknown>;
};

export type OneBotOutgoingMessage = string | OneBotMessageSegment[];

/**
 * 把多种形态的 @ 目标归一化为裸 QQ 号或 "all"。
 *
 * 接受：裸 QQ 号、"all"、[CQ:at,qq=xxx]、@xxx、qq:xxx、
 *      onebot:private:xxx / onebot:group:xxx / onebot:xxx
 */
export function normalizeMentionTarget(value: unknown): string {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    if (raw.toLowerCase() === "all") return "all";

    let candidate = raw;
    const cqMatch = /^\[CQ:at,qq=([^,\]]+)/i.exec(candidate);
    if (cqMatch) candidate = cqMatch[1];
    if (candidate.startsWith("@")) candidate = candidate.slice(1);
    if (candidate.startsWith("qq:")) candidate = candidate.slice("qq:".length);

    if (candidate.startsWith("onebot:")) {
        const parsed = parseChatId(candidate);
        if (parsed.rawId.startsWith("private:")) {
            candidate = parsed.rawId.slice("private:".length);
        } else if (parsed.rawId.startsWith("group:")) {
            candidate = parsed.rawId.slice("group:".length);
        } else {
            candidate = parsed.rawId;
        }
    }

    return candidate.trim();
}

/**
 * 把多种形态的 @ 目标集合归一化为去重的裸 QQ 号/"all" 列表。
 *
 * 接受：单值、数组、逗号/顿号/分号/空格分隔字符串、含 [CQ:at,qq=xxx] 的串。
 */
export function normalizeMentionTargets(value: unknown): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    const add = (target: string) => {
        if (!target) return;
        const key = target.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        result.push(target);
    };
    const visit = (item: unknown): void => {
        if (item == null) return;
        if (Array.isArray(item)) {
            for (const child of item) visit(child);
            return;
        }
        const raw = String(item).trim();
        if (!raw) return;
        const cqMatches = [...raw.matchAll(/\[CQ:at,qq=([^,\]]+)/ig)];
        if (cqMatches.length > 0) {
            for (const match of cqMatches) add(normalizeMentionTarget(match[1]));
            return;
        }
        if (/[,，、;；\s]/.test(raw)) {
            for (const part of raw.split(/[,，、;；\s]+/)) {
                add(normalizeMentionTarget(part));
            }
            return;
        }
        add(normalizeMentionTarget(raw));
    };
    visit(value);
    return result;
}

/**
 * 把 OneBot 消息（字符串或段数组）渲染为纯文本。
 *
 * 用于：
 *   - 拟人延迟长度计算（adapter outgoingMessageText）
 *   - 发送意图提取（host-call-handler summarizeOneBotMessage）
 *   - 去重 key 构造（sandbox module oneBotMessageToText）
 *
 * 渲染规则：text→原文，at→@qq，face→[face:id]，reply→[reply:id]，
 *          image/record/video/file→[type:file]，未知→[type]。
 *
 * 含轻量输入防御：非 string/数组返回 String(value)，
 * segment 非对象返回空串——TS 结构类型不防运行时畸形对象。
 */
export function summarizeOneBotMessage(value: unknown): string {
    if (typeof value === "string") return value;
    if (!Array.isArray(value)) return String(value ?? "");
    return value.map((segment) => {
        if (!segment || typeof segment !== "object") return "";
        const record = segment as OneBotMessageSegment;
        const type = String(record.type ?? "");
        const data = record.data && typeof record.data === "object"
            ? record.data
            : {};
        switch (type) {
            case "text":
                return String(data.text ?? "");
            case "at": {
                const qq = normalizeMentionTarget(data.qq ?? data.user_id ?? data.id);
                return qq ? `@${qq}` : "@";
            }
            case "reply":
                return `[reply:${String(data.id ?? data.message_id ?? "")}]`;
            case "face":
                return `[face:${String(data.id ?? "")}]`;
            case "image":
            case "record":
            case "video":
            case "file":
                return `[${type}:${String(data.file ?? "")}]`;
            default:
                return type ? `[${type}]` : "";
        }
    }).join("");
}

/**
 * outgoingMessageText 是 summarizeOneBotMessage 的语义别名，
 * 保留以匹配 adapter 原方法名，便于迁移调用方。
 */
export const outgoingMessageText = summarizeOneBotMessage;
