import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { HarnessNotify } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..");

/** 做梦回顾文件（本周期 subagent 任务 + 群关系画像），由 manager 启动前重建 */
export const DREAMING_FILE = "workspace/background-dreaming.md";
/** 启动前积攒的「有人找你」通知，由 manager 启动前写入 */
export const PENDING_FILE = "workspace/background-pending.md";

// 触发用的合成通知（不是真正「有人找你」的内容，不写进 pending 文件）
const TRIGGER_MARKERS = new Set(["scheduled-dreaming", "manual-trigger-from-dashboard"]);

/** 过滤掉调度/手动触发的合成标记，只留下真正需要 agent 处理的通知 */
export function selectPendingNotifications(pending: HarnessNotify[]): HarnessNotify[] {
    return pending.filter((n) => !TRIGGER_MARKERS.has(n.content));
}

/** 渲染 pending 通知文件内容（写入 PENDING_FILE） */
export function renderPendingFile(pending: HarnessNotify[]): string {
    const items = pending
        .map((n, i) => `${i + 1}. ${n.source ? `[来自 ${n.source}] ` : ""}${n.content}`)
        .join("\n");
    return `# 有人找你\n\n这些是启动前积攒的通知：\n\n${items}\n`;
}

export function buildSystemPrompt(
    workDir: string,
    persona: { name: string; description: string },
): string {
    const sections: string[] = [];

    sections.push(`# 身份\n\n你是「${persona.name}」。\n\n${persona.description}`);

    const dreamingMode = tryRead(join(PROJECT_ROOT, "system-prompts", "harness", "dreaming-mode.md"));
    if (dreamingMode) {
        sections.push(dreamingMode);
    }

    sections.push(`# 工作区\n\n当前项目根目录是：\`${workDir}\`。`);

    return sections.join("\n\n---\n\n");
}

/**
 * 任务 prompt（命令行 -p 参数）只放本次做梦的目标，保持简短。
 * 可能很长的内容（本周期回顾、积攒的通知）都已由 manager 写入文件，
 * 这里只指引 agent 自己去读，避免撑爆命令行参数（spawn E2BIG）。
 */
export function buildTaskPrompt(
    workDir: string,
    pending: HarnessNotify[],
): string {
    const hasDreaming = fileHasContent(join(workDir, DREAMING_FILE));
    const hasPending = selectPendingNotifications(pending).length > 0;

    const lines: string[] = ["# 本次任务", "", "进行一次后台做梦。"];
    const pointers: string[] = [];

    if (hasDreaming) {
        pointers.push(
            `- 先读 \`${DREAMING_FILE}\`：本周期（上次做梦以来）你通过 subagent 实际做过的事，以及各个聊天的关系画像。` +
            "把它当作回忆今天、决定今晚想做什么的起点。",
        );
    }
    if (hasPending) {
        pointers.push(
            `- \`${PENDING_FILE}\` 里是启动前有人专门找你或交代的事，先认真处理完，再回到你自己想做的事。`,
        );
    }

    if (pointers.length > 0) {
        lines.push("", ...pointers);
    } else {
        lines.push("", "回顾最近可用的上下文，寻找值得整理、研究、维护或交给其他 agent 的方向。");
    }

    return lines.join("\n");
}

function fileHasContent(path: string): boolean {
    try {
        return existsSync(path) && statSync(path).size > 0;
    } catch {
        return false;
    }
}

function tryRead(path: string): string | null {
    try {
        return readFileSync(path, "utf-8").trim();
    } catch {
        return null;
    }
}
