import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TopicRegistry } from "../src/pipeline/topic-registry.js";
import type { Topic } from "../src/pipeline/types.js";

function makeTopic(id: string): Topic {
    return {
        id,
        chatId: "telegram:1",
        label: "test topic",
        keywords: [],
        participantIds: new Set(),
        messageIds: [],
        state: "ACTIVE",
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        turnCount: 0,
        maxTurns: 0,
        pendingMessages: [],
        exitSignals: [],
        irrelevantStreak: 0,
        messageCount: 0,
        recentContext: "",
    };
}

describe("TopicRegistry.setDecision", () => {
    it("strips newlines from triageReason so it cannot cause JSON control-char errors", () => {
        const registry = new TopicRegistry();
        registry["topics"].set("t1", makeTopic("t1"));

        const multilineReason = "F1sh 作为可信赖用户已提供完整解决方案\n草师傅回应了但还有疑问\r\n应当跟进确认";
        registry.setDecision("t1", { reason: multilineReason });

        const topic = registry["topics"].get("t1");
        const storedReason = topic?.decision?.reason ?? "";

        assert.ok(!storedReason.includes("\n"), "stored reason must not contain LF");
        assert.ok(!storedReason.includes("\r"), "stored reason must not contain CR");
        assert.ok(storedReason.length > 0, "reason should not be empty");

        // Verify it round-trips safely through JSON.stringify
        const json = JSON.stringify({ reason: storedReason });
        assert.doesNotThrow(() => JSON.parse(json), "sanitized reason must produce valid JSON");

        // Verify that the original multiline reason would have been problematic
        const rawJson = `{"reason":"${multilineReason}"}`;
        assert.throws(() => JSON.parse(rawJson), "raw multiline reason breaks JSON.parse (regression proof)");
    });

    it("leaves single-line reasons unchanged", () => {
        const registry = new TopicRegistry();
        registry["topics"].set("t2", makeTopic("t2"));

        const reason = "用户直接提及 Miu，需要正式回应。";
        registry.setDecision("t2", { reason });

        const topic = registry["topics"].get("t2");
        assert.equal(topic?.decision?.reason, reason);
    });

    it("toDigest reflects sanitized triageReason", () => {
        const registry = new TopicRegistry();
        registry["topics"].set("t3", makeTopic("t3"));

        registry.setDecision("t3", { reason: "line one\nline two" });

        const digest = TopicRegistry.toDigest(registry["topics"].get("t3")!);
        assert.ok(digest.triageReason && !digest.triageReason.includes("\n"),
            "toDigest triageReason must not contain newlines");
    });
});
