import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SentMessageCollector } from "../src/sandbox/session-runner.js";

describe("SentMessageCollector", () => {
    it("renders sent sticker confirmations through the cached sticker description path", () => {
        const collector = new SentMessageCollector({
            getStickerDescription: (uniqueFileId: string) => uniqueFileId === "AgADdg0AAvE2QVQ"
                ? { description: "角色露出轻松得意的表情", emojis: ["😌"] }
                : null,
        });

        collector.collect({
            type: "system.agent_message_sent",
            scene: "telegram",
            chatId: "-1002450361141",
            messageId: 4014,
            text: "[🎭 贴纸: AgADdg0AAvE2QVQ]",
            mediaInfo: {
                type: "sticker",
                fileId: "CAACAgUAAyEGAASSDYs1AAIP22oW8HOv8YPnYqAcp_PDn3hSYL3sAALiHQACtJK5VIO-anIsyB9fOgQ",
                uniqueFileId: "AgAD4h0AArSSuVQ",
                fileName: "telegram_-1002984884196_550880_AgADdg0AAvE2QVQ.webp",
            },
            timestamp: "2026-05-27T12:17:00.000Z",
        });

        const [record] = collector.drainTurn();
        assert.ok(record);
        assert.equal(record.mediaType, "sticker");
        assert.match(record.mediaInfo ?? "", /AgADdg0AAvE2QVQ/);

        const observation = collector.formatAsObservation([record]);
        assert.match(observation, /贴纸 😌: 角色露出轻松得意的表情/);
        assert.doesNotMatch(observation, /AgADdg0AAvE2QVQ/);
    });
});
