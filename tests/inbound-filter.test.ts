import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isChatBlockedByFilter, releaseChatFromFilter, shouldDropInbound } from "../src/core/inbound-filter.js";

describe("inbound access control release", () => {
    it("adds a blocked chat to a whitelist", () => {
        const config = { enabled: true, mode: "whitelist" as const, chatIds: ["telegram:allowed"] };
        assert.equal(shouldDropInbound(config, { chatId: "telegram:new" }), true);

        const released = releaseChatFromFilter(config, "telegram:new");

        assert.equal(shouldDropInbound(released, { chatId: "telegram:new" }), false);
        assert.deepEqual(released.chatIds, ["telegram:allowed", "telegram:new"]);
        assert.deepEqual(config.chatIds, ["telegram:allowed"], "input config must not be mutated");
    });

    it("removes an exact blacklist entry", () => {
        const config = { enabled: true, mode: "blacklist" as const, chatIds: ["telegram:blocked", "discord:keep"] };

        const released = releaseChatFromFilter(config, "telegram:blocked");

        assert.equal(shouldDropInbound(released, { chatId: "telegram:blocked" }), false);
        assert.deepEqual(released.chatIds, ["discord:keep"]);
    });

    it("uses a per-chat exception without deleting a wildcard blacklist", () => {
        const config = { enabled: true, mode: "blacklist" as const, chatIds: ["discord:*"] };

        const released = releaseChatFromFilter(config, "discord:channel:123");

        assert.deepEqual(released.chatIds, ["discord:*"]);
        assert.deepEqual(released.allowedChatIds, ["discord:channel:123"]);
        assert.equal(shouldDropInbound(released, { chatId: "discord:channel:123" }), false);
        assert.equal(shouldDropInbound(released, { chatId: "discord:channel:456" }), true);
    });

    it("releases the whole chat from sender blacklist rules", () => {
        const config = { enabled: true, mode: "blacklist" as const, userIds: ["telegram:bad-user"] };
        assert.equal(shouldDropInbound(config, { chatId: "telegram:chat", userId: "telegram:bad-user" }), true);

        const released = releaseChatFromFilter(config, "telegram:chat");

        assert.equal(shouldDropInbound(released, { chatId: "telegram:chat", userId: "telegram:bad-user" }), false);
        assert.equal(shouldDropInbound(released, { chatId: "telegram:other", userId: "telegram:bad-user" }), true);
    });
});

describe("isChatBlockedByFilter", () => {
    it("uses whitelist mode without a sender id", () => {
        const config = {
            enabled: true,
            mode: "whitelist" as const,
            chatIds: ["telegram:*", "onebot:private:111111111", "onebot:group:987654321"],
        };

        assert.equal(isChatBlockedByFilter(config, "telegram:-1001"), false);
        assert.equal(isChatBlockedByFilter(config, "onebot:private:111111111"), false);
        assert.equal(isChatBlockedByFilter(config, "onebot:group:987654321"), false);
        assert.equal(isChatBlockedByFilter(config, "onebot:group:123456789"), true);
        assert.equal(isChatBlockedByFilter(config, "discord:guild:channel"), true);
    });

    it("uses blacklist mode and keeps sender-only rules from blocking a whole chat", () => {
        const config = {
            enabled: true,
            mode: "blacklist" as const,
            chatIds: ["onebot:group:123456789"],
            userIds: ["telegram:bad-user"],
        };

        assert.equal(isChatBlockedByFilter(config, "onebot:group:123456789"), true);
        // 出站时没有 sender 身份，不能把「某发送者被拉黑」升级成整个会话被禁。
        assert.equal(isChatBlockedByFilter(config, "telegram:chat"), false);
    });

    it("honours explicit chat exceptions and disabled filters", () => {
        const config = {
            enabled: true,
            mode: "blacklist" as const,
            chatIds: ["discord:*"],
            allowedChatIds: ["discord:guild:released"],
        };

        assert.equal(isChatBlockedByFilter(config, "discord:guild:other"), true);
        assert.equal(isChatBlockedByFilter(config, "discord:guild:released"), false);
        assert.equal(isChatBlockedByFilter({ ...config, enabled: false }, "discord:guild:other"), false);
        assert.equal(isChatBlockedByFilter(undefined, "discord:guild:other"), false);
    });

    it("matches untyped onebot targets against typed group/private rules", () => {
        const config = {
            enabled: true,
            mode: "blacklist" as const,
            chatIds: ["onebot:group:123456789"],
        };

        assert.equal(isChatBlockedByFilter(config, "onebot:123456789"), true);
    });
});
