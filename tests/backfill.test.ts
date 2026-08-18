/**
 * tests/backfill.test.ts — 离线补抓
 *
 * 覆盖：
 * - resolveEventTimestamp：落盘用消息原始时间而非入库时间
 * - isNewerThanWatermark：水位线比较（含 snowflake 超 2^53、时间兜底）
 * - BackfillCoordinator：合并唤醒语义（只有直接提及才唤醒、一个会话只唤醒一次）
 * - memory 水位线查询
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NotificationCenter } from "../src/event/notification-center.js";
import { resolveEventTimestamp } from "../src/core/message-enricher.js";
import {
    BackfillCoordinator,
    isNewerThanWatermark,
    resolveBackfillConfig,
    DEFAULT_BACKFILL,
    BACKFILL_FLAG,
    type BackfillWakeSummary,
} from "../src/adapter/backfill.js";
import type { PlatformAdapter, BackfillOptions, BackfillResult } from "../src/adapter/platform-adapter.js";
import { createTestMemory, cleanupTestMemory } from "./helpers/test-db.js";

function makeNC(): NotificationCenter {
    return new NotificationCenter(undefined, false);
}

describe("resolveEventTimestamp", () => {
    it("优先使用事件自带的 ISO 时间", () => {
        const ts = resolveEventTimestamp({ timestamp: "2026-08-01T10:00:00.000Z" });
        assert.equal(ts, "2026-08-01T10:00:00.000Z");
    });

    it("支持秒级 unix 时间戳（OneBot event.time）", () => {
        const ts = resolveEventTimestamp({ timestamp: 1_770_000_000 });
        assert.equal(ts, new Date(1_770_000_000_000).toISOString());
    });

    it("支持毫秒时间戳与 Date", () => {
        assert.equal(resolveEventTimestamp({ timestamp: 1_770_000_000_000 }), new Date(1_770_000_000_000).toISOString());
        const date = new Date("2026-07-01T00:00:00.000Z");
        assert.equal(resolveEventTimestamp({ timestamp: date }), date.toISOString());
    });

    it("无法解析时回退到给定兜底时间", () => {
        const fallback = new Date("2026-01-01T00:00:00.000Z");
        assert.equal(resolveEventTimestamp({}, fallback), fallback.toISOString());
        assert.equal(resolveEventTimestamp({ timestamp: "not-a-date" }, fallback), fallback.toISOString());
        assert.equal(resolveEventTimestamp(null, fallback), fallback.toISOString());
    });
});

describe("isNewerThanWatermark", () => {
    const since = new Date("2026-08-01T00:00:00.000Z");

    it("没有水位线时按 since 判断", () => {
        assert.equal(isNewerThanWatermark(
            { messageId: "5", timestamp: "2026-08-02T00:00:00.000Z" }, null, "numeric-id", since,
        ), true);
        assert.equal(isNewerThanWatermark(
            { messageId: "5", timestamp: "2026-07-01T00:00:00.000Z" }, null, "numeric-id", since,
        ), false, "早于 since 的消息不补抓");
    });

    it("numeric-id：按 id 数值比较", () => {
        const watermark = { messageId: "100", timestamp: "2026-08-02T00:00:00.000Z" };
        assert.equal(isNewerThanWatermark(
            { messageId: "101", timestamp: "2026-08-02T01:00:00.000Z" }, watermark, "numeric-id", since,
        ), true);
        assert.equal(isNewerThanWatermark(
            { messageId: "100", timestamp: "2026-08-02T01:00:00.000Z" }, watermark, "numeric-id", since,
        ), false, "等于水位线的消息已经见过");
        assert.equal(isNewerThanWatermark(
            { messageId: "99", timestamp: "2026-08-02T01:00:00.000Z" }, watermark, "numeric-id", since,
        ), false);
    });

    it("discord snowflake 超过 2^53 仍能正确比较", () => {
        const watermark = { messageId: "1485835320535810058", timestamp: "2026-08-02T00:00:00.000Z" };
        assert.equal(isNewerThanWatermark(
            { messageId: "1485835320535810059", timestamp: "2026-08-02T01:00:00.000Z" }, watermark, "numeric-id", since,
        ), true, "相邻 snowflake 不能因浮点精度判等");
        assert.equal(isNewerThanWatermark(
            { messageId: "1485835320535810057", timestamp: "2026-08-02T01:00:00.000Z" }, watermark, "numeric-id", since,
        ), false);
    });

    it("timestamp 模式：按时间比较（onebot message_id 无序）", () => {
        const watermark = { messageId: "999", timestamp: "2026-08-02T00:00:00.000Z" };
        assert.equal(isNewerThanWatermark(
            { messageId: "1", timestamp: "2026-08-02T00:00:01.000Z" }, watermark, "timestamp", since,
        ), true, "id 更小但时间更新 → 是新消息");
        assert.equal(isNewerThanWatermark(
            { messageId: "1000", timestamp: "2026-08-01T23:00:00.000Z" }, watermark, "timestamp", since,
        ), false);
    });

    it("非数字 id 在 numeric-id 模式下退回时间比较", () => {
        const watermark = { messageId: "agent-abc", timestamp: "2026-08-02T00:00:00.000Z" };
        assert.equal(isNewerThanWatermark(
            { messageId: "100", timestamp: "2026-08-02T01:00:00.000Z" }, watermark, "numeric-id", since,
        ), true);
    });
});

describe("resolveBackfillConfig", () => {
    it("未配置时返回默认值", () => {
        assert.deepEqual(resolveBackfillConfig(undefined), DEFAULT_BACKFILL);
    });

    it("部分覆盖保留其余默认值", () => {
        const resolved = resolveBackfillConfig({ maxChats: 3, enabled: false });
        assert.equal(resolved.maxChats, 3);
        assert.equal(resolved.enabled, false);
        assert.equal(resolved.maxMessagesPerChat, DEFAULT_BACKFILL.maxMessagesPerChat);
    });
});

describe("BackfillCoordinator 合并唤醒", () => {
    function makeCoordinator() {
        const wakes: Array<{ chatId: string; summary: BackfillWakeSummary }> = [];
        const coordinator = new BackfillCoordinator({
            nc: makeNC(),
            adapters: [],
            getWatermark: () => null,
            listKnownChatIds: () => [],
            onConsolidatedWake: (chatId, summary) => wakes.push({ chatId, summary }),
            getConfig: () => ({ enabled: true }),
        });
        return { coordinator, wakes };
    }

    it("只有直接提及的会话才唤醒，普通群消息交给话题信号链路", () => {
        const { coordinator, wakes } = makeCoordinator();

        coordinator.noteBackfilledMessage("telegram:-100", { timestamp: "2026-08-01T10:00:00.000Z" });
        coordinator.noteBackfilledMessage("telegram:-100", { timestamp: "2026-08-01T10:01:00.000Z" });
        coordinator.noteBackfilledMessage("telegram:42", { timestamp: "2026-08-01T10:02:00.000Z", directReason: "DM" });

        const summaries = coordinator.flushWakes();
        coordinator.dispose();

        assert.equal(summaries.length, 2, "两个会话都应产出 summary");
        assert.equal(wakes.length, 1, "只有被直接提及的会话唤醒");
        assert.equal(wakes[0].chatId, "telegram:42");
        assert.deepEqual(wakes[0].summary.reasons, ["DM"]);
    });

    it("同一会话多条直接提及只唤醒一次，并汇总时间范围", () => {
        const { coordinator, wakes } = makeCoordinator();

        coordinator.noteBackfilledMessage("telegram:42", { timestamp: "2026-08-01T12:00:00.000Z", directReason: "@mention" });
        coordinator.noteBackfilledMessage("telegram:42", { timestamp: "2026-08-01T10:00:00.000Z", directReason: "DM" });
        coordinator.noteBackfilledMessage("telegram:42", { timestamp: "2026-08-01T11:00:00.000Z" });

        coordinator.flushWakes();
        coordinator.dispose();

        assert.equal(wakes.length, 1, "一个会话只唤醒一次，而不是每条消息一次");
        const summary = wakes[0].summary;
        assert.equal(summary.messageCount, 3);
        assert.equal(summary.directCount, 2);
        assert.equal(summary.earliestTs, "2026-08-01T10:00:00.000Z");
        assert.equal(summary.latestTs, "2026-08-01T12:00:00.000Z");
        assert.deepEqual([...summary.reasons].sort(), ["@mention", "DM"]);
    });

    it("flush 后状态清空，不会重复唤醒", () => {
        const { coordinator, wakes } = makeCoordinator();
        coordinator.noteBackfilledMessage("telegram:42", { timestamp: "2026-08-01T10:00:00.000Z", directReason: "DM" });
        coordinator.flushWakes();
        assert.equal(coordinator.flushWakes().length, 0);
        coordinator.dispose();
        assert.equal(wakes.length, 1);
    });

    it("禁用时 run() 直接跳过所有 adapter", async () => {
        let called = false;
        const adapter: PlatformAdapter = {
            platform: "telegram",
            start: async () => {},
            stop: async () => {},
            canHandle: () => false,
            handleCall: async () => null,
            getWriteMethods: () => [],
            formatMention: () => undefined,
            fetchMissedMessages: async () => {
                called = true;
                return { chats: 0, messages: 0 };
            },
        };
        const coordinator = new BackfillCoordinator({
            nc: makeNC(),
            adapters: [adapter],
            getWatermark: () => null,
            listKnownChatIds: () => [],
            onConsolidatedWake: () => {},
            getConfig: () => ({ enabled: false }),
        });

        const outcome = await coordinator.run();
        coordinator.dispose();
        assert.equal(called, false);
        assert.deepEqual(outcome.results, {});
    });

    it("run() 给 adapter 传入上限与水位线，并把消息打上 backfill 标记推进 NC", async () => {
        const nc = makeNC();
        const pushed: Record<string, unknown>[] = [];
        nc.onPush((event) => pushed.push(event as Record<string, unknown>));

        let seen: BackfillOptions | null = null;
        const adapter: PlatformAdapter = {
            platform: "telegram",
            start: async () => {},
            stop: async () => {},
            canHandle: () => false,
            handleCall: async () => null,
            getWriteMethods: () => [],
            formatMention: () => undefined,
            getConnectionStatus: () => ({
                platform: "telegram",
                state: "connected",
                since: "",
                reconnectAttempts: 0,
                nextRetryAt: null,
                lastConnectedAt: null,
            }),
            fetchMissedMessages: async (options): Promise<BackfillResult> => {
                seen = options;
                options.deliver({ type: "nc.message", chatId: "telegram:42", text: "老消息" });
                return { chats: 1, messages: 1 };
            },
        };

        const coordinator = new BackfillCoordinator({
            nc,
            adapters: [adapter],
            getWatermark: () => ({ messageId: "7", timestamp: "2026-08-01T00:00:00.000Z" }),
            listKnownChatIds: () => ["telegram:42"],
            onConsolidatedWake: () => {},
            getConfig: () => ({ enabled: true, maxChats: 5, maxMessagesPerChat: 11, maxAgeMinutes: 60 }),
        });

        const outcome = await coordinator.run();
        coordinator.dispose();

        assert.equal(outcome.results.telegram?.messages, 1);
        assert.ok(seen, "adapter 应被调用");
        assert.equal(seen!.maxChats, 5);
        assert.equal(seen!.maxMessagesPerChat, 11);
        assert.deepEqual(seen!.knownChatIds, ["telegram:42"]);
        assert.equal(seen!.getWatermark("telegram:42")?.messageId, "7");
        // since 应约等于 now - 60min
        const ageMs = Date.now() - seen!.since.getTime();
        assert.ok(ageMs > 59 * 60_000 && ageMs < 61 * 60_000, `since 应为 60 分钟前, got ${ageMs}ms`);

        assert.equal(pushed.length, 1);
        assert.equal(pushed[0][BACKFILL_FLAG], true, "补抓消息必须带 backfill 标记");
    });

    it("自动触发有最小间隔，防止「补抓弄崩连接 → 重连 → 再补抓」自激循环", async () => {
        let calls = 0;
        const adapter: PlatformAdapter = {
            platform: "onebot",
            start: async () => {},
            stop: async () => {},
            canHandle: () => false,
            handleCall: async () => null,
            getWriteMethods: () => [],
            formatMention: () => undefined,
            fetchMissedMessages: async () => {
                calls++;
                return { chats: 0, messages: 0 };
            },
        };
        const coordinator = new BackfillCoordinator({
            nc: makeNC(),
            adapters: [adapter],
            getWatermark: () => null,
            listKnownChatIds: () => [],
            onConsolidatedWake: () => {},
            getConfig: () => ({ enabled: true }),
        });

        // 首次（模拟 startup）force 通过
        await coordinator.run(undefined, { force: true });
        assert.equal(calls, 1);

        // 紧接着的自动触发（模拟 reconnected）应被节流挡掉
        await coordinator.run();
        assert.equal(calls, 1, "自动触发应被最小间隔挡掉");

        // 手动 force 仍然可以立刻补
        await coordinator.run(undefined, { force: true });
        assert.equal(calls, 2, "force 应绕过节流");

        coordinator.dispose();
    });

    it("adapter 未连接时跳过", async () => {
        let called = false;
        const adapter: PlatformAdapter = {
            platform: "onebot",
            start: async () => {},
            stop: async () => {},
            canHandle: () => false,
            handleCall: async () => null,
            getWriteMethods: () => [],
            formatMention: () => undefined,
            getConnectionStatus: () => ({
                platform: "onebot",
                state: "disconnected",
                since: "",
                reconnectAttempts: 1,
                nextRetryAt: null,
                lastConnectedAt: null,
            }),
            fetchMissedMessages: async () => {
                called = true;
                return { chats: 0, messages: 0 };
            },
        };
        const coordinator = new BackfillCoordinator({
            nc: makeNC(),
            adapters: [adapter],
            getWatermark: () => null,
            listKnownChatIds: () => [],
            onConsolidatedWake: () => {},
            getConfig: () => ({ enabled: true }),
        });

        await coordinator.run();
        coordinator.dispose();
        assert.equal(called, false, "未连接的 adapter 不应被拉取");
    });
});

describe("memory 水位线查询", () => {
    it("numeric-id 取 message_id 最大值，timestamp 取最新时间", () => {
        const memory = createTestMemory("backfill-watermark");
        try {
            memory.storeMessageBatch([
                { messageId: "10", chatId: "telegram:42", userId: "u1", displayName: "A", text: "早", timestamp: "2026-08-01T10:00:00.000Z" },
                { messageId: "9", chatId: "telegram:42", userId: "u1", displayName: "A", text: "晚到但 id 小", timestamp: "2026-08-01T12:00:00.000Z" },
                { messageId: "agent-xyz", chatId: "telegram:42", userId: "bot", displayName: "bot", text: "agent 兜底 id", timestamp: "2026-08-01T13:00:00.000Z" },
            ]);

            const byId = memory.getBackfillWatermark("telegram:42", "numeric-id");
            assert.equal(byId?.messageId, "10", "非数字 id 不应污染水位线");

            const byTime = memory.getBackfillWatermark("telegram:42", "timestamp");
            assert.equal(byTime?.messageId, "agent-xyz");

            assert.equal(memory.getBackfillWatermark("telegram:999", "numeric-id"), null);
        } finally {
            cleanupTestMemory(memory, "backfill-watermark");
        }
    });

    it("listKnownChatIds 按平台前缀过滤", () => {
        const memory = createTestMemory("backfill-known-chats");
        try {
            memory.storeMessageBatch([
                { messageId: "1", chatId: "telegram:42", userId: "u1", displayName: "A", text: "a", timestamp: "2026-08-01T10:00:00.000Z" },
                { messageId: "2", chatId: "discord:g:c", userId: "u2", displayName: "B", text: "b", timestamp: "2026-08-01T11:00:00.000Z" },
                { messageId: "3", chatId: "onebot:group:1", userId: "u3", displayName: "C", text: "c", timestamp: "2026-08-01T12:00:00.000Z" },
            ]);

            assert.deepEqual(memory.listKnownChatIds("telegram"), ["telegram:42"]);
            assert.deepEqual(memory.listKnownChatIds("discord"), ["discord:g:c"]);
            assert.equal(memory.listKnownChatIds().length, 3);
        } finally {
            cleanupTestMemory(memory, "backfill-known-chats");
        }
    });
});
