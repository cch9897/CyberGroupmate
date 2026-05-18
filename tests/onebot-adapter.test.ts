import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve as pathResolve } from "node:path";
import { NotificationCenter } from "../src/event/notification-center.js";
import { OneBotAdapter } from "../src/adapter/onebot-adapter.js";
import type { OneBotConfig } from "../src/core/config.js";

function makeNC(): NotificationCenter {
    return new NotificationCenter(join(tmpdir(), `onebot-adapter-${randomUUID()}.jsonl`), false);
}

function makeConfig(overrides: Partial<OneBotConfig> = {}): OneBotConfig {
    return {
        wsUrl: "ws://127.0.0.1:6700/onebot",
        selfId: "123456789",
        ...overrides,
    };
}

describe("OneBotAdapter", () => {
    it("should resolve numeric download refs through get_msg image URLs", async () => {
        const nc = makeNC();
        const adapter = new OneBotAdapter(makeConfig(), nc);
        const calls: Array<{ action: string; params: Record<string, unknown> }> = [];
        const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        const originalFetch = globalThis.fetch;

        // @ts-expect-error - fake connected websocket for handleCall guard
        adapter.ws = { readyState: 1 };
        // @ts-expect-error - override private method for payload inspection
        adapter.callAction = async (action: string, params: Record<string, unknown>) => {
            calls.push({ action, params });
            if (action === "get_msg") {
                return {
                    message_id: 794582600,
                    message: [
                        {
                            type: "image",
                            data: {
                                file: "cached-image.jpg",
                                file_unique: "unique-image",
                                url: "https://cdn.example.test/image.png",
                            },
                        },
                    ],
                };
            }
            throw new Error(`unexpected action: ${action}`);
        };
        globalThis.fetch = async (url) => {
            assert.equal(String(url), "https://cdn.example.test/image.png");
            return new Response(bytes, { status: 200 });
        };

        try {
            const result = await adapter.handleCall("onebot.downloadMedia", ["794582600"]) as { buffer: string; size: number };
            assert.deepEqual(calls, [{ action: "get_msg", params: { message_id: 794582600 } }]);
            assert.equal(result.buffer, bytes.toString("base64"));
            assert.equal(result.size, bytes.length);
        } finally {
            globalThis.fetch = originalFetch;
            nc.dispose();
        }
    });

    it("should use get_image base64 instead of remote local paths", async () => {
        const nc = makeNC();
        const adapter = new OneBotAdapter(makeConfig(), nc);
        const bytes = Buffer.from("image-bytes");

        // @ts-expect-error - override private method for focused download test
        adapter.callAction = async (action: string, params: Record<string, unknown>) => {
            assert.equal(action, "get_image");
            assert.deepEqual(params, { file: "cached-image.jpg" });
            return {
                file: "/remote/napcat/cache/cached-image.jpg",
                base64: bytes.toString("base64"),
            };
        };

        try {
            // @ts-expect-error - invoke private-ish adapter API directly for focused transport test
            const result = await adapter.downloadMedia(null, "cached-image.jpg");
            assert.deepEqual(result, bytes);
        } finally {
            nc.dispose();
        }
    });

    it("should drop replyTo for group voice payloads", async () => {
        const nc = makeNC();
        const adapter = new OneBotAdapter(makeConfig(), nc);
        const calls: Array<{ action: string; params: Record<string, unknown> }> = [];

        // @ts-expect-error - override private method for payload inspection
        adapter.callAction = async (action: string, params: Record<string, unknown>) => {
            calls.push({ action, params });
            return { message_id: 1 };
        };

        // @ts-expect-error - invoke private method for focused transport test
        await adapter.sendMedia(
            "onebot:group:979200391",
            { type: "audio", file: "media/mimo_tts_1777522996493.ogg" },
            { replyTo: 1805758077 },
        );

        assert.equal(calls.length, 1);
        assert.equal(calls[0].action, "send_group_msg");
        assert.equal(calls[0].params.group_id, 979200391);
        assert.deepEqual(calls[0].params.message, [
            { type: "record", data: { file: `file://${pathResolve(process.cwd(), "workspace", "media/mimo_tts_1777522996493.ogg")}` } },
        ]);

        nc.dispose();
    });

    it("should drop replyTo for private voice payloads", async () => {
        const nc = makeNC();
        const adapter = new OneBotAdapter(makeConfig(), nc);
        const calls: Array<{ action: string; params: Record<string, unknown> }> = [];

        // @ts-expect-error - override private method for payload inspection
        adapter.callAction = async (action: string, params: Record<string, unknown>) => {
            calls.push({ action, params });
            return { message_id: 2 };
        };

        // @ts-expect-error - invoke private method for focused transport test
        await adapter.sendMedia(
            "onebot:private:12345678",
            { type: "audio", file: "media/private_voice.ogg" },
            { replyTo: 99887766 },
        );

        assert.equal(calls.length, 1);
        assert.equal(calls[0].action, "send_private_msg");
        assert.deepEqual(calls[0].params.message, [
            { type: "record", data: { file: `file://${pathResolve(process.cwd(), "workspace", "media/private_voice.ogg")}` } },
        ]);

        nc.dispose();
    });

    it("markAsRead dispatches to group/private NapCat actions", async () => {
        const nc = makeNC();
        const adapter = new OneBotAdapter(makeConfig(), nc);
        const calls: Array<{ action: string; params: Record<string, unknown> }> = [];

        // @ts-expect-error - fake connected ws so markAsRead doesn't early-return
        adapter.ws = { readyState: 1 };
        // @ts-expect-error - override private method for payload inspection
        adapter.callAction = async (action: string, params: Record<string, unknown>) => {
            calls.push({ action, params });
            return null;
        };

        await adapter.markAsRead("onebot:group:979200391");
        await adapter.markAsRead("onebot:private:12345678");

        assert.deepEqual(calls, [
            { action: "mark_group_msg_as_read", params: { group_id: 979200391 } },
            { action: "mark_private_msg_as_read", params: { user_id: 12345678 } },
        ]);

        nc.dispose();
    });

    it("markAsRead swallows callAction errors", async () => {
        const nc = makeNC();
        const adapter = new OneBotAdapter(makeConfig(), nc);

        // @ts-expect-error - fake connected ws
        adapter.ws = { readyState: 1 };
        // @ts-expect-error - override private method to throw
        adapter.callAction = async () => { throw new Error("boom"); };

        // Should not throw
        await adapter.markAsRead("onebot:group:1");

        nc.dispose();
    });

    it("deleteMessages now works for private chats", async () => {
        const nc = makeNC();
        const adapter = new OneBotAdapter(makeConfig(), nc);
        const calls: Array<{ action: string; params: Record<string, unknown> }> = [];

        // @ts-expect-error - fake connected ws for handleCall guard
        adapter.ws = { readyState: 1 };
        // @ts-expect-error - override private method
        adapter.callAction = async (action: string, params: Record<string, unknown>) => {
            calls.push({ action, params });
            return null;
        };

        await adapter.handleCall("onebot.deleteMessages", ["onebot:private:12345678", ["100", "101"]]);

        assert.deepEqual(calls, [
            { action: "delete_msg", params: { message_id: 100 } },
            { action: "delete_msg", params: { message_id: 101 } },
        ]);

        nc.dispose();
    });

    it("applyHumanizedDelay waits on bunched sends but not the first", async () => {
        const nc = makeNC();
        const adapter = new OneBotAdapter(makeConfig({
            humanizedDelay: { enabled: true, msPerChar: 50, minDelay: 200, maxDelay: 1000 },
        }), nc);

        // 首次发送不应等待（无 lastSendTimes 基准）
        const t0 = Date.now();
        // @ts-expect-error - invoke private method directly
        await adapter.applyHumanizedDelay("onebot:group:1", 0);
        const firstElapsed = Date.now() - t0;
        assert.ok(firstElapsed < 50, `first send should not wait (was ${firstElapsed}ms)`);

        // 立刻紧跟一次，距上次发送 elapsed≈0，应补足 ~targetDelay (200ms)
        const t1 = Date.now();
        // @ts-expect-error - invoke private method directly
        await adapter.applyHumanizedDelay("onebot:group:1", 0);
        const secondElapsed = Date.now() - t1;
        assert.ok(secondElapsed >= 180, `second send should wait ~200ms (was ${secondElapsed}ms)`);

        // 等够 targetDelay 之后再发，又不应等待
        await new Promise(r => setTimeout(r, 220));
        const t2 = Date.now();
        // @ts-expect-error - invoke private method directly
        await adapter.applyHumanizedDelay("onebot:group:1", 0);
        const thirdElapsed = Date.now() - t2;
        assert.ok(thirdElapsed < 50, `third send (after window) should not wait (was ${thirdElapsed}ms)`);

        nc.dispose();
    });

    it("sendReaction routes to set_msg_emoji_like with emoji_id", async () => {
        const nc = makeNC();
        const adapter = new OneBotAdapter(makeConfig(), nc);
        const calls: Array<{ action: string; params: Record<string, unknown> }> = [];

        // @ts-expect-error - fake connected ws for handleCall guard
        adapter.ws = { readyState: 1 };
        // @ts-expect-error - override private method
        adapter.callAction = async (action: string, params: Record<string, unknown>) => {
            calls.push({ action, params });
            return null;
        };

        await adapter.handleCall("onebot.sendReaction", ["onebot:group:1", "12345", "128077"]);

        assert.deepEqual(calls, [
            { action: "set_msg_emoji_like", params: { message_id: 12345, emoji_id: "128077" } },
        ]);

        nc.dispose();
    });

    it("pokeUser routes to group_poke for group chats", async () => {
        const nc = makeNC();
        const adapter = new OneBotAdapter(makeConfig(), nc);
        const calls: Array<{ action: string; params: Record<string, unknown> }> = [];

        // @ts-expect-error - fake connected ws for handleCall guard
        adapter.ws = { readyState: 1 };
        // @ts-expect-error - override private method
        adapter.callAction = async (action: string, params: Record<string, unknown>) => {
            calls.push({ action, params });
            return null;
        };

        await adapter.handleCall("onebot.pokeUser", ["onebot:group:979200391", "12345678"]);

        assert.deepEqual(calls, [
            { action: "group_poke", params: { group_id: 979200391, user_id: 12345678 } },
        ]);

        // 私聊场景应抛错
        await assert.rejects(
            adapter.handleCall("onebot.pokeUser", ["onebot:private:1", "2"]),
            /仅支持群聊/,
        );

        nc.dispose();
    });

    it("getChatMembers routes to get_group_member_list", async () => {
        const nc = makeNC();
        const adapter = new OneBotAdapter(makeConfig(), nc);
        const calls: Array<{ action: string; params: Record<string, unknown> }> = [];

        // @ts-expect-error - fake connected ws for handleCall guard
        adapter.ws = { readyState: 1 };
        // @ts-expect-error - override private method
        adapter.callAction = async (action: string, params: Record<string, unknown>) => {
            calls.push({ action, params });
            return [{ user_id: 1 }, { user_id: 2 }];
        };

        const result = await adapter.handleCall("onebot.getChatMembers", ["onebot:group:979200391"]);

        assert.deepEqual(calls, [
            { action: "get_group_member_list", params: { group_id: 979200391 } },
        ]);
        assert.deepEqual(result, [{ user_id: 1 }, { user_id: 2 }]);

        nc.dispose();
    });

    it("extractText rewrites @self to @personaName, others use nickname cache with CQ fallback", () => {
        const nc = makeNC();
        const adapter = new OneBotAdapter(makeConfig(), nc, undefined, "赛博群友");
        // 预填一个其他用户的昵称缓存，验证缓存路径
        // @ts-expect-error - 私有字段，测试需要
        adapter.userNickCache.set("999", "张三");
        // @ts-expect-error - 私有方法，验证渲染逻辑
        const out = adapter["extractText"]([
            { type: "at", data: { qq: "123456789" } },   // 自己
            { type: "text", data: { text: " 在吗，告诉 " } },
            { type: "at", data: { qq: "999" } },          // 缓存命中
            { type: "text", data: { text: " 和 " } },
            { type: "at", data: { qq: "777" } },          // 缓存未命中
            { type: "text", data: { text: " 一声" } },
        ]);
        assert.equal(out, "@赛博群友 在吗，告诉 @张三(999) 和 [CQ:at,qq=777] 一声");
        nc.dispose();
    });

    it("getMessage strips envelope only once (no double .data unwrap)", async () => {
        const nc = makeNC();
        const adapter = new OneBotAdapter(makeConfig(), nc);

        // callAction 已剥过 envelope，返回的就是业务数据；getMessage 不应再去碰 .data
        // @ts-expect-error - override private method
        adapter.callAction = async () => ({
            message_id: 123,
            message: [{ type: "text", data: { text: "hello" } }],
            // 故意带一个 .data 字段，验证 getMessage 不会错误地读它
            data: { trapped: true },
        });

        // @ts-expect-error - invoke private method for focused test
        const result = await adapter.getMessage("123") as Record<string, unknown>;
        assert.equal(result.message_id, 123);
        assert.ok(Array.isArray(result.message));
        // 验证 trapped 字段没有被错误剥离上来
        assert.deepEqual(result.data, { trapped: true });

        nc.dispose();
    });
});
