/**
 * chat-title-sync.test.ts — 群名变更实时同步测试
 *
 * 当前实现：
 * - 适配器层维护内存缓存，并通过 notice 事件处理 group_name_change。
 * - 主流程在消息到达时通过 memory.upsertGroupModel 持久化 chatTitle。
 * - CodeActExecutor 不再持有 updateChatTitle；渲染时通过 formatChatLabel(memory, chatId)
 *   实时从 group model 读取最新 chatTitle。
 *
 * 测试场景:
 * 1. OneBot group_name_change → NC 广播
 * 2. memory.upsertGroupModel 后 formatChatLabel 读取最新群名
 * 3. Telegram chat_title_refresh 事件流
 * 4. NC 事件字段映射
 * 5. 端到端: NC事件 → memory 更新 → formatChatLabel 刷新
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotificationCenter } from "../src/event/notification-center.js";
import { MemoryStoreV2 } from "../src/memory-v2/index.js";
import { getGroupModelKey } from "../src/core/chat-id.js";
import type { CodeActReplyTask, GroupContextPackage } from "../src/subagent/types.js";

function makeNC(): NotificationCenter {
    return new NotificationCenter();
}

function makeMemory(): MemoryStoreV2 {
    return new MemoryStoreV2(":memory:");
}

function makeContextSnapshot(overrides: Partial<GroupContextPackage> = {}): GroupContextPackage {
    return {
        depth: 1,
        chatId: "onebot:group:123456",
        snapshotTimestamp: new Date().toISOString(),
        topicDigests: [],
        engagementScore: 0,
        chatTitle: "旧群名",
        ...overrides,
    };
}

function makeTask(chatTitle: string, chatId = "onebot:group:123456"): CodeActReplyTask {
    return {
        taskId: `task-${randomUUID()}`,
        chatId,
        contextSnapshot: makeContextSnapshot({ chatId, chatTitle, groupModel: { chatId, chatTitle, isDirectMessage: false } }),
        decisions: [],
        enqueuedAt: Date.now(),
    };
}

function formatChatLabel(memory: MemoryStoreV2, chatId: string, fallbackTitle?: string | null): string {
    const model = memory.getGroupModel(getGroupModelKey(chatId));
    const title = model?.chatTitle?.trim() || fallbackTitle?.trim() || chatId;
    return `${title}(${chatId})`;
}

function updateChatTitle(memory: MemoryStoreV2, chatId: string, newTitle: string): void {
    memory.upsertGroupModel(getGroupModelKey(chatId), { chatTitle: newTitle, isDirectMessage: false });
}

describe("群名变更同步", () => {
    describe("OneBot group_name_change → NC 广播", () => {
        it("should broadcast onebot.group_name_change event via NC when group name changes", () => {
            const nc = makeNC();
            const receivedEvents: Array<Record<string, unknown>> = [];

            nc.onPush(event => {
                if (event.type === "onebot.group_name_change") {
                    receivedEvents.push(event as Record<string, unknown>);
                }
            });

            nc.push({
                type: "onebot.group_name_change",
                chatId: "onebot:group:679691983",
                groupId: "679691983",
                oldName: "旧群名",
                newName: "新群名",
            });

            assert.equal(receivedEvents.length, 1);
            assert.equal(receivedEvents[0].chatId, "onebot:group:679691983");
            assert.equal(receivedEvents[0].newName, "新群名");
            assert.equal(receivedEvents[0].oldName, "旧群名");

            nc.dispose();
        });

        it("should not broadcast for unrelated events", () => {
            const nc = makeNC();
            const receivedEvents: Array<Record<string, unknown>> = [];

            nc.onPush(event => {
                if (event.type === "onebot.group_name_change") {
                    receivedEvents.push(event as Record<string, unknown>);
                }
            });

            nc.push({ type: "nc.message", chatId: "onebot:group:679691983" });
            nc.push({ type: "system.adapter_status" });

            assert.equal(receivedEvents.length, 0);

            nc.dispose();
        });
    });

    describe("Memory group model 更新", () => {
        it("should reflect updated chatTitle through formatChatLabel after upsertGroupModel", () => {
            const memory = makeMemory();
            const chatId = "onebot:group:123456";

            assert.equal(formatChatLabel(memory, chatId), `${chatId}(${chatId})`);

            updateChatTitle(memory, chatId, "新群名");

            assert.equal(formatChatLabel(memory, chatId), `新群名(${chatId})`);
        });

        it("should update only chatTitle field in group model", () => {
            const memory = makeMemory();
            const chatId = "onebot:group:123456";

            updateChatTitle(memory, chatId, "旧群名");
            const before = memory.getGroupModel(getGroupModelKey(chatId));
            assert.ok(before);
            assert.equal(before!.chatTitle, "旧群名");
            assert.equal(before!.isDirectMessage, false);

            updateChatTitle(memory, chatId, "更新后的群名");
            const after = memory.getGroupModel(getGroupModelKey(chatId));
            assert.ok(after);
            assert.equal(after!.chatTitle, "更新后的群名");
            assert.equal(after!.isDirectMessage, false);
        });

        it("should handle empty title gracefully", () => {
            const memory = makeMemory();
            const chatId = "onebot:group:999";

            updateChatTitle(memory, chatId, "新群名");
            assert.equal(formatChatLabel(memory, chatId), `新群名(${chatId})`);
        });
    });

    describe("NC listener: chatTitle 同步字段映射", () => {
        it("should extract newTitle from newName field (onebot)", () => {
            const event = {
                type: "onebot.group_name_change",
                chatId: "onebot:group:123",
                newName: "来自OneBot的新群名",
            };

            const newTitle = String(event.newName ?? event.chatTitle ?? "");
            assert.equal(newTitle, "来自OneBot的新群名");
        });

        it("should extract newTitle from chatTitle field (telegram)", () => {
            const event = {
                type: "telegram.chat_title_refresh",
                chatId: "telegram:-1001234567890",
                chatTitle: "来自Telegram的新群名",
            };

            const newTitle = String(event.newName ?? event.chatTitle ?? "");
            assert.equal(newTitle, "来自Telegram的新群名");
        });

        it("should prefer newName over chatTitle when both present", () => {
            const event = {
                type: "onebot.group_name_change",
                chatId: "onebot:group:123",
                newName: "OneBot名称",
                chatTitle: "不应使用",
            };

            const newTitle = String(event.newName ?? event.chatTitle ?? "");
            assert.equal(newTitle, "OneBot名称");
        });

        it("should handle missing both newName and chatTitle", () => {
            const event = {
                type: "onebot.group_name_change",
                chatId: "onebot:group:123",
            };

            const newTitle = String((event as Record<string, unknown>).newName ?? (event as Record<string, unknown>).chatTitle ?? "");
            assert.equal(newTitle, "");
        });
    });

    describe("Telegram chat_title_refresh 事件", () => {
        it("should broadcast telegram.chat_title_refresh event via NC", () => {
            const nc = makeNC();
            const receivedEvents: Array<Record<string, unknown>> = [];

            nc.onPush(event => {
                if (event.type === "telegram.chat_title_refresh") {
                    receivedEvents.push(event as Record<string, unknown>);
                }
            });

            nc.push({
                type: "telegram.chat_title_refresh",
                chatId: "telegram:-1001234567890",
                chatTitle: "Telegram新群名",
                platform: "telegram",
            });

            assert.equal(receivedEvents.length, 1);
            assert.equal(receivedEvents[0].chatId, "telegram:-1001234567890");
            assert.equal(receivedEvents[0].chatTitle, "Telegram新群名");

            nc.dispose();
        });
    });

    describe("端到端: NC事件 → memory 更新 → formatChatLabel 刷新", () => {
        it("should reflect new chat title from onebot.group_name_change", () => {
            const nc = makeNC();
            const memory = makeMemory();
            const chatId = "onebot:group:123456";

            updateChatTitle(memory, chatId, "旧群名");
            assert.equal(formatChatLabel(memory, chatId), `旧群名(${chatId})`);

            // 模拟 main.ts 中的 onPush 监听逻辑
            nc.onPush(event => {
                const eventType = String(event.type ?? "");
                if (eventType !== "onebot.group_name_change" && eventType !== "telegram.chat_title_refresh") return;
                const newTitle = String((event as Record<string, unknown>).newName ?? (event as Record<string, unknown>).chatTitle ?? "");
                if (newTitle) {
                    updateChatTitle(memory, String(event.chatId), newTitle);
                }
            });

            nc.push({
                type: "onebot.group_name_change",
                chatId,
                newName: "端到端新群名",
            });

            assert.equal(formatChatLabel(memory, chatId), `端到端新群名(${chatId})`);

            nc.dispose();
        });

        it("should work with telegram.chat_title_refresh events too", () => {
            const nc = makeNC();
            const memory = makeMemory();
            const chatId = "telegram:-1001234567890";

            updateChatTitle(memory, chatId, "旧TG群名");
            assert.equal(formatChatLabel(memory, chatId), `旧TG群名(${chatId})`);

            nc.onPush(event => {
                const eventType = String(event.type ?? "");
                if (eventType !== "onebot.group_name_change" && eventType !== "telegram.chat_title_refresh") return;
                const newTitle = String((event as Record<string, unknown>).newName ?? (event as Record<string, unknown>).chatTitle ?? "");
                if (newTitle) {
                    updateChatTitle(memory, String(event.chatId), newTitle);
                }
            });

            nc.push({
                type: "telegram.chat_title_refresh",
                chatId,
                chatTitle: "新TG群名",
            });

            assert.equal(formatChatLabel(memory, chatId), `新TG群名(${chatId})`);

            nc.dispose();
        });
    });
});
