import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";

import { userGate } from "../src/adapter/user-gate.js";
import type { PlatformAdapter } from "../src/adapter/platform-adapter.js";
import { clearConfigCache, loadConfig, type AppConfig, type ChatFilterConfig } from "../src/core/config.js";
import { isChatBlockedByFilter, releaseChatFromFilter } from "../src/core/inbound-filter.js";
import { createConversationsApi } from "../src/meta-sandbox/meta-api/conversations.js";
import { createSandboxHostCallHandler, type CreateSandboxHostCallHandlerDeps } from "../src/sandbox/host-call-handler.js";
import type { MemoryStoreV2 } from "../src/memory-v2/index.js";
import { cleanupTestMemory, createTestMemory } from "./helpers/test-db.js";

const BLOCKED_GROUP = "onebot:group:123456789";
const ALLOWED_GROUP = "onebot:group:987654321";
const ALLOWED_TELEGRAM = "telegram:allowed";

const WHITELIST: ChatFilterConfig = {
    enabled: true,
    mode: "whitelist",
    chatIds: [ALLOWED_GROUP, ALLOWED_TELEGRAM],
};

const missingConfigPath = () => new URL("./chat-filter-outbound.missing.yaml", import.meta.url).pathname;

function makeConfig(filter: ChatFilterConfig): AppConfig {
    const config = loadConfig(missingConfigPath(), true);
    config.chatFilter = filter;
    return config;
}

interface Call {
    method: string;
    args: unknown[];
}

function makeAdapter(platform: string, writeMethods: string[], calls: Call[]): PlatformAdapter {
    return {
        platform,
        canHandle: (method: string) => method.startsWith(`${platform}.`),
        getWriteMethods: () => writeMethods,
        handleCall: async (method: string, args: unknown[]) => {
            calls.push({ method, args });
            return { ok: true };
        },
    } as unknown as PlatformAdapter;
}

function makeHandler(boundChatId: string, config: AppConfig, adapters: PlatformAdapter[]) {
    return createSandboxHostCallHandler(boundChatId, {
        appConfig: config,
        globalState: {},
        accumulator: {},
        memory: { getGroupModel: () => null },
        adapters,
        sandbox: {},
        sandboxPool: {},
        mcpBridge: {},
        buildEnvPlan: () => ({ hostVisible: {}, sandboxVisible: {}, managedKeys: [] }),
        getCurrentEnvPlan: () => ({ hostVisible: {}, sandboxVisible: {}, managedKeys: [] }),
        setCurrentEnvPlan: () => undefined,
        applyHostManagedEnv: () => undefined,
    } as unknown as CreateSandboxHostCallHandlerDeps);
}

afterEach(() => clearConfigCache());

describe("host-call chat_filter outbound gate", () => {
    it("rejects adapter sends to a blocked bound chat and to blocked explicit targets", async () => {
        const calls: Call[] = [];
        const config = makeConfig(WHITELIST);
        const handler = makeHandler(BLOCKED_GROUP, config, [makeAdapter("onebot", ["onebot.sendMessage"], calls)]);

        await assert.rejects(
            handler("onebot.sendMessage", [BLOCKED_GROUP, "hello"]),
            /\[chat_filter\].*onebot:group:123456789/,
        );
        // 显式裸群号同样会被补全成 onebot:group:<id> 后命中 typed 白名单规则。
        await assert.rejects(
            handler("onebot.sendMessage", ["123456789", "hello"]),
            /\[chat_filter\]/,
        );
        assert.deepEqual(calls, []);

        // 目标本身在白名单内时，发送放行（即使绑定会话被过滤）。
        await handler("onebot.sendMessage", [ALLOWED_GROUP, "hello"]);
        assert.deepEqual(calls.map((call) => call.args[0]), [ALLOWED_GROUP]);
    });

    it("fails closed for __background__ writes when the target cannot be resolved", async () => {
        const calls: Call[] = [];
        const config = makeConfig(WHITELIST);
        const handler = makeHandler("__background__", config, [makeAdapter("onebot", ["onebot.sendMessage"], calls)]);

        await assert.rejects(
            handler("onebot.callApi", ["send_group_msg", { group_id: 123456789, message: "hello" }]),
            /\[chat_filter\].*onebot:group:123456789/,
        );
        await assert.rejects(
            handler("onebot.sendMessage", []),
            /\[chat_filter\].*无法确定写入目标/,
        );
        assert.deepEqual(calls, []);

        await handler("onebot.callApi", ["send_group_msg", { group_id: 987654321, message: "hello" }]);
        assert.equal(calls.length, 1);
    });

    it("falls back to the bound chat for writes without an extractable target", async () => {
        const calls: Call[] = [];
        const config = makeConfig(WHITELIST);
        const handler = makeHandler("telegram:blocked", config, [
            // answerText 等 mtcute 写方法按消息上下文发送，target 无法从参数提取。
            makeAdapter("telegram", [], calls),
        ]);

        await assert.rejects(
            handler("telegram.answerText", [{ id: 1 }, "hello"]),
            /\[chat_filter\].*telegram:blocked/,
        );
        assert.deepEqual(calls, []);

        const allowedHandler = makeHandler(ALLOWED_TELEGRAM, config, [makeAdapter("telegram", [], calls)]);
        await allowedHandler("telegram.answerText", [{ id: 1 }, "hello"]);
        assert.equal(calls.length, 1);
    });

    it("never gates reads or explicit self targets", async () => {
        const calls: Call[] = [];
        const config = makeConfig(WHITELIST);
        const handler = makeHandler(BLOCKED_GROUP, config, [makeAdapter("onebot", ["onebot.sendMessage"], calls)]);

        await handler("onebot.getMessage", [BLOCKED_GROUP, "m1"]);
        await handler("onebot.sendMessage", ["me", "profile update"]);
        assert.equal(calls.length, 2);
    });

    it("releases a chat after the Dashboard flow updates config (hot reload)", async () => {
        const calls: Call[] = [];
        const config = makeConfig(WHITELIST);
        const handler = makeHandler(BLOCKED_GROUP, config, [makeAdapter("onebot", ["onebot.sendMessage"], calls)]);

        await assert.rejects(handler("onebot.sendMessage", [BLOCKED_GROUP, "hello"]), /\[chat_filter\]/);

        // 模拟 Dashboard：releaseChatFromFilter -> saveConfig（刷新同一份缓存），handler 不重建。
        config.chatFilter = releaseChatFromFilter(config.chatFilter!, BLOCKED_GROUP);

        await handler("onebot.sendMessage", [BLOCKED_GROUP, "hello"]);
        assert.equal(calls.length, 1);
    });

    it("does not send the emergency.block preset into a blocked chat but still blocks the user", async () => {
        const calls: Call[] = [];
        const config = makeConfig(WHITELIST);
        const handler = makeHandler(BLOCKED_GROUP, config, [makeAdapter("onebot", ["onebot.sendText"], calls)]);

        const originalBlock = userGate.block;
        userGate.block = () => ({ newlyBlocked: true });
        try {
            const result = await handler("emergency.block", ["onebot:private:999999"]) as {
                notified: boolean;
                blocked: boolean;
            };
            assert.equal(result.notified, false);
            assert.deepEqual(calls, []);
        } finally {
            userGate.block = originalBlock;
        }
    });
});

describe("conversations reads with chat_filter", () => {
    let memory: MemoryStoreV2;

    before(() => {
        memory = createTestMemory("chat-filter-outbound");
        memory.storeMessageBatch([
            {
                messageId: "blocked-history",
                chatId: BLOCKED_GROUP,
                userId: "onebot:private:1",
                displayName: "历史用户",
                text: "过滤生效前的公开历史",
                timestamp: "2026-01-01T10:00:00Z",
            },
            {
                messageId: "blocked-secret",
                chatId: BLOCKED_GROUP,
                userId: "onebot:private:1",
                displayName: "历史用户",
                text: "blocked secret keyword",
                timestamp: "2026-01-02T10:00:00Z",
                accessControlBlocked: true,
            },
            {
                messageId: "allowed-public",
                chatId: ALLOWED_TELEGRAM,
                userId: "telegram:1",
                displayName: "允许用户",
                text: "公开 keyword 消息",
                timestamp: "2026-01-01T11:00:00Z",
            },
            {
                messageId: "allowed-blocked",
                chatId: ALLOWED_TELEGRAM,
                userId: "telegram:1",
                displayName: "允许用户",
                text: "blocked keyword 消息",
                timestamp: "2026-01-02T11:00:00Z",
                accessControlBlocked: true,
            },
        ]);
        memory.upsertGroupModel(BLOCKED_GROUP, { chatTitle: "被过滤群" });
        memory.upsertGroupModel(ALLOWED_TELEGRAM, { chatTitle: "允许群" });
    });

    after(() => cleanupTestMemory(memory, "chat-filter-outbound"));

    const makeApi = () => createConversationsApi(memory, {
        // 同时覆盖 subagents 与 group_models 两个来源。
        getAllSubagents: () => [
            { chatId: BLOCKED_GROUP, lastAttendedAt: null },
            { chatId: ALLOWED_TELEGRAM, lastAttendedAt: null },
        ],
    }, {
        isChatAllowed: (chatId) => !isChatBlockedByFilter(WHITELIST, chatId),
    });

    it("excludes a blocked chat from inbox even when it has pre-filter history", async () => {
        const result = await makeApi().inbox({ limit: 20 });

        assert.deepEqual(result.items.map((item) => item.chatId), [ALLOWED_TELEGRAM]);
        assert.equal(result.items[0].latestMessage?.messageId, "allowed-public");
        assert.equal(result.items[0].unreadCount, 1, "blocked rows must not count as unread");
        assert.equal(result.unreadTotal, 1);
    });

    it("refuses messages() for a blocked chat and hides blocked rows for allowed chats", async () => {
        const api = makeApi();

        await assert.rejects(api.messages(BLOCKED_GROUP), /\[chat_filter\].*123456789/);

        const allowed = await api.messages(ALLOWED_TELEGRAM, { limit: 20 });
        assert.deepEqual(allowed.messages.map((row) => row.messageId), ["allowed-public"]);
    });

    it("excludes blocked chats from query, including explicitly requested ones", async () => {
        const api = makeApi();

        const blockedOnly = await api.query({ chatIds: [BLOCKED_GROUP], keyword: "keyword" });
        assert.deepEqual(blockedOnly.messages, []);
        assert.deepEqual(blockedOnly.topics, []);

        const global = await api.query({ keyword: "keyword", limit: 20 });
        assert.deepEqual(global.messages.map((row) => row.messageId), ["allowed-public"]);
        assert.ok(global.messages.every((row) => row.chatId !== BLOCKED_GROUP));
    });

    it("keeps Dashboard reads intact: includeBlocked defaults to true", async () => {
        // 该会话既有 blocked 新消息，也有过滤前允许历史：chat 级过滤才是 inbox 排除的依据。
        assert.deepEqual(
            memory.getRecentMessages(BLOCKED_GROUP, 1, { includeBlocked: false }).map((row) => row.messageId),
            ["blocked-history"],
        );

        assert.deepEqual(
            memory.getRecentMessages(BLOCKED_GROUP, 10).map((row) => row.messageId),
            ["blocked-secret", "blocked-history"],
        );
        assert.deepEqual(
            memory.queryMessages({ chatIds: [BLOCKED_GROUP] }).map((row) => row.messageId),
            ["blocked-secret", "blocked-history"],
        );
        assert.deepEqual(
            memory.queryMessages({ chatIds: [BLOCKED_GROUP], includeBlocked: false }).map((row) => row.messageId),
            ["blocked-history"],
        );
        assert.equal(
            memory.getRecentMessages(ALLOWED_TELEGRAM, 10).some((row) => row.messageId === "allowed-blocked"),
            true,
            "Dashboard must still see blocked messages by default",
        );
    });
});
