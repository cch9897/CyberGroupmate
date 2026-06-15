import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    buildDispatchedRecordForShellWakeDirect,
    buildShellWakeContinuationPrompt,
    buildShellWakeDirectTask,
} from "../src/subagent/shell-wake-task.js";
import type { ShellWakeEvent } from "../src/sandbox/sandbox.js";

function makeEvent(overrides?: Partial<ShellWakeEvent>): ShellWakeEvent {
    return {
        tabId: "bg-1",
        reason: "exit",
        command: "ping -c 120 1.1.1.1",
        exitCode: 0,
        recentOutput: "120 packets transmitted, 120 received, 0% packet loss",
        ...overrides,
    };
}

describe("shell wake direct task", () => {
    it("builds a concise continuation prompt for the original subagent", () => {
        const prompt = buildShellWakeContinuationPrompt(makeEvent());

        assert.match(prompt, /shell\.runBackground 回调/);
        assert.match(prompt, /shell\.read\("bg-1"\)/);
        assert.match(prompt, /不要重新派发给 Meta/);
    });

    it("creates a lightweight continuation task", () => {
        const task = buildShellWakeDirectTask({
            chatId: "telegram:682932098",
            event: makeEvent(),
            queueEntry: { topicDigests: [], engagementScore: 42 },
            now: new Date("2026-05-31T10:00:00.000Z"),
        });

        assert.match(task.taskId, /^shell-wake-[0-9a-f]{8}$/);
        assert.equal(task.chatId, "telegram:682932098");
        assert.equal(task.replyStrategy, "DIRECT_REPLY");
        assert.equal(task.continuationReason, "shell-wake");
        assert.equal(task.skipRefreshTaskMessages, true);
        assert.equal(task.contextSnapshot.engagementScore, 42);
    });

    it("records shell wake tasks as subagent-origin work", () => {
        const event = makeEvent({ reason: "idle", exitCode: undefined });
        const task = buildShellWakeDirectTask({
            chatId: "telegram:682932098",
            event,
            queueEntry: { topicDigests: [], engagementScore: 0 },
            now: new Date("2026-05-31T10:00:00.000Z"),
        });

        const record = buildDispatchedRecordForShellWakeDirect(task, event);

        assert.equal(record.taskId, task.taskId);
        assert.equal(record.sourceType, "subagent");
        assert.equal(record.sourceChatId, "telegram:682932098");
        assert.match(record.contentDirection, /可能卡住或在等待输入/);
    });
});
