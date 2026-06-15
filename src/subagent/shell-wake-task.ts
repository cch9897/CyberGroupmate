/**
 * shell-wake-task.ts — direct Subagent continuation for shell.runBackground wakeups
 */

import { prefixedShortUuid } from "../core/ids.js";
import type { ShellWakeEvent } from "../sandbox/sandbox.js";
import { buildShellWakeDescription } from "../sandbox/shell-wake.js";
import type {
    AttentionQueueEntry,
    CodeActReplyTask,
    DispatchedSubagentTaskRecord,
    GroupContextPackage,
} from "./types.js";

export interface BuildShellWakeDirectTaskOptions {
    chatId: string;
    event: ShellWakeEvent;
    queueEntry: Pick<AttentionQueueEntry, "topicDigests" | "engagementScore">;
    now?: Date;
}

export function buildShellWakeContinuationPrompt(event: ShellWakeEvent): string {
    return [
        "[shell.runBackground 回调]",
        buildShellWakeDescription(event),
        "读对应 tab 输出并闭环；不要重新派发给 Meta。",
    ].join("\n");
}

export function buildShellWakeDirectTask(options: BuildShellWakeDirectTaskOptions): CodeActReplyTask {
    const createdAt = (options.now ?? new Date()).toISOString();
    const description = buildShellWakeDescription(options.event);
    const toneGuidance = "后台命令回调；确认输出后简短闭环。";
    const contextSnapshot: GroupContextPackage = {
        depth: 2,
        chatId: options.chatId,
        snapshotTimestamp: createdAt,
        topicDigests: options.queueEntry.topicDigests ?? [],
        engagementScore: options.queueEntry.engagementScore ?? 0,
        toneGuidance,
        contentDirection: description,
    };

    return {
        type: "CODEACT_REPLY",
        chatId: options.chatId,
        taskId: prefixedShortUuid("shell-wake-"),
        decisions: [{
            action: "REPLY",
            reason: `shell.runBackground ${options.event.reason}`,
            confidence: 1,
            contentDirection: description,
            toneGuidance,
        }],
        contextSnapshot,
        replyMode: "SINGLE",
        createdAt,
        replyStrategy: "DIRECT_REPLY",
        continuationPrompt: buildShellWakeContinuationPrompt(options.event),
        continuationReason: "shell-wake",
        skipRefreshTaskMessages: true,
    };
}

export function buildDispatchedRecordForShellWakeDirect(
    task: CodeActReplyTask,
    event: ShellWakeEvent,
): DispatchedSubagentTaskRecord {
    return {
        taskId: task.taskId,
        chatId: task.chatId,
        sourceType: "subagent",
        sourceChatId: task.chatId,
        contentDirection: task.contextSnapshot.contentDirection
            ?? task.decisions[0]?.contentDirection
            ?? buildShellWakeDescription(event),
        toneGuidance: task.contextSnapshot.toneGuidance,
        status: "PENDING",
        createdAt: task.createdAt,
        updatedAt: task.createdAt,
    };
}
