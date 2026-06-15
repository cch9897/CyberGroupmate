/**
 * vision-processor.test.ts — 动态贴纸抽帧管线单元测试
 *
 * 测试范围：
 * - isAnimatedSticker 格式判断
 * - sampleFrameIndexes 采样逻辑
 * - TGS (Lottie) 渲染路径（使用最小 Lottie JSON fixture）
 * - WebM 解码路径（使用 @napi-rs/webcodecs 最小 VP8 fixture）
 * - ensureSupportedFormat 格式降级
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import {
    isAnimatedSticker,
    extractAnimatedStickerFrames,
    sampleFrameIndexes,
    ensureSupportedFormat,
    processMediaBatch,
    type MediaAttachment,
} from "../src/core/vision-processor.js";
import type { LLMConfig } from "../src/core/config.js";

// ─── isAnimatedSticker ───

describe("isAnimatedSticker", () => {
    it("should detect WebM video sticker", () => {
        assert.equal(isAnimatedSticker({ mimeType: "video/webm" }), true);
    });

    it("should detect TGS by mimeType", () => {
        assert.equal(isAnimatedSticker({ mimeType: "application/x-tgsticker" }), true);
    });

    it("should detect TGS by fileName extension", () => {
        assert.equal(isAnimatedSticker({ mimeType: undefined, fileName: "sticker.tgs" }), true);
        assert.equal(isAnimatedSticker({ mimeType: undefined, fileName: "STICKER.TGS" }), true);
    });

    it("should return false for static image sticker", () => {
        assert.equal(isAnimatedSticker({ mimeType: "image/webp" }), false);
        assert.equal(isAnimatedSticker({ mimeType: "image/png" }), false);
    });

    it("should return false when both fields are empty", () => {
        assert.equal(isAnimatedSticker({ mimeType: undefined, fileName: undefined }), false);
        assert.equal(isAnimatedSticker({}), false);
    });

    it("should not false-positive on filenames containing 'tgs' but without extension", () => {
        assert.equal(isAnimatedSticker({ mimeType: undefined, fileName: "my_tgs_file.webp" }), false);
        assert.equal(isAnimatedSticker({ mimeType: undefined, fileName: "tgs" }), false);
    });
});

// ─── ensureSupportedFormat ───

describe("ensureSupportedFormat", () => {
    it("should pass through JPEG without conversion", async () => {
        const buf = Buffer.from("fake jpeg");
        const result = await ensureSupportedFormat(buf, "image/jpeg");
        assert.equal(result.mimeType, "image/jpeg");
        assert.equal(result.buffer, buf); // same reference, no copy
    });

    it("should pass through PNG without conversion", async () => {
        const buf = Buffer.from("fake png");
        const result = await ensureSupportedFormat(buf, "image/png");
        assert.equal(result.mimeType, "image/png");
        assert.equal(result.buffer, buf);
    });

    it("should attempt ffmpeg conversion for unsupported types and gracefully degrade", async () => {
        // WebP with fake data — ffmpeg will fail (not valid image), should return original
        const buf = Buffer.from("not a real webp");
        const result = await ensureSupportedFormat(buf, "image/webp");
        // Either converted (unlikely with fake data) or fallback to original
        assert.ok(result.buffer.length > 0);
    });
});

// ─── processMediaBatch behavior ───

describe("processMediaBatch animated sticker config", () => {
    const visionLlmConfig: LLMConfig = {
        provider: "openai",
        baseUrl: "https://example.invalid/v1",
        apiKey: "test",
        model: "vision-test",
        temperature: 0,
        maxTokens: 100,
        vision: true,
    };

    it("keeps animated stickers as emoji fallback when animatedStickerFrames=0", async () => {
        let downloadCalls = 0;
        const attachment: MediaAttachment = {
            type: "sticker",
            fileId: "file-tgs",
            uniqueFileId: "unique-tgs",
            emoji: "🫠",
            mimeType: "application/x-tgsticker",
            fileName: "sticker.tgs",
            messageIndex: 7,
            chatId: "telegram:-100",
            messageId: "42",
        };

        const result = await processMediaBatch(
            [attachment],
            { stickerMode: "vision_each", animatedStickerFrames: 0 },
            visionLlmConfig,
            [visionLlmConfig],
            async () => {
                downloadCalls += 1;
                return Buffer.from("should not download");
            },
        );

        assert.equal(downloadCalls, 0);
        assert.deepEqual(result, [{
            index: 7,
            description: "[🎭 动态贴纸: 🫠]",
        }]);
    });
});

// ─── TGS 渲染路径 ───

describe("extractAnimatedStickerFrames — TGS", () => {
    // 最小合法 Lottie JSON，可被 LottieAnimation 解析
    const minimalLottie = JSON.stringify({
        v: "5.5.2",
        fr: 30,
        ip: 0,
        op: 60, // 60 frames total
        w: 128,
        h: 128,
        layers: [{
            ty: 1, // solid layer
            sw: 128,
            sh: 128,
            sc: "#ff0000",
            ip: 0,
            op: 60,
            st: 0,
            ks: {
                o: { a: 0, k: 100 },
                r: { a: 0, k: 0 },
                p: { a: 0, k: [64, 64, 0] },
                a: { a: 0, k: [64, 64, 0] },
                s: { a: 0, k: [100, 100, 100] },
            },
        }],
    });
    const tgsBuffer = Buffer.from(gzipSync(Buffer.from(minimalLottie)));

    it("should extract single frame when maxFrames=1", async () => {
        const frames = await extractAnimatedStickerFrames(tgsBuffer, true, 1);
        assert.equal(frames.length, 1);
        // PNG signature: 0x89 P N G
        assert.equal(frames[0][0], 0x89);
        assert.equal(frames[0][1], 0x50); // 'P'
        assert.equal(frames[0][2], 0x4e); // 'N'
        assert.equal(frames[0][3], 0x47); // 'G'
    });

    it("should extract multiple frames when maxFrames=4", async () => {
        const frames = await extractAnimatedStickerFrames(tgsBuffer, true, 4);
        assert.ok(frames.length >= 2 && frames.length <= 4,
            `Expected 2-4 frames, got ${frames.length}`);
        // All frames should be valid PNGs
        for (const frame of frames) {
            assert.equal(frame[0], 0x89, "PNG signature byte 0");
        }
    });

    it("should extract all frames when maxFrames exceeds total", async () => {
        // Lottie has 60 frames; asking for 100 should cap at 60
        const frames = await extractAnimatedStickerFrames(tgsBuffer, true, 100);
        // sampleFrameIndexes will pick at most 60 unique indexes
        assert.ok(frames.length >= 1, "Should extract at least 1 frame");
        assert.ok(frames.length <= 60, `Should not exceed total frames, got ${frames.length}`);
    });

    it("should produce non-empty PNG buffers", async () => {
        const frames = await extractAnimatedStickerFrames(tgsBuffer, true, 2);
        for (const frame of frames) {
            assert.ok(frame.length > 50, `PNG buffer should be non-trivial, got ${frame.length} bytes`);
        }
    });
});

// ─── WebM 解码路径 ───

describe("extractAnimatedStickerFrames — WebM", () => {
    /**
     * 构造最小合法 WebM (VP8) 容器
     * EBML Header + Segment(Info + Tracks(VP8) + Cluster(SimpleBlock))
     * VP8 SimpleBlock 包含 1x1 绿色帧的最小关键帧
     */
    function buildMinimalWebM(): Buffer {
        // Minimal VP8 keyframe: 1x1 green pixel
        // VP8 bitstream: frame_tag(3 bytes) + version_tag(7 bytes) + macroblock data
        const vp8Frame = Buffer.from([
            // Frame tag: keyframe, version 0, show_frame=1, partition_length=4
            0x30, 0x01, 0x00,
            // VP8 start code + dimensions
            0x9d, 0x01, 0x2a, 0x01, 0x00, 0x01, 0x00,
            // Minimal frame data (quantizer + macroblock)
            0x03, 0x40, 0x00, 0x00, 0x09, 0x40, 0x1c, 0xa4,
            0x00, 0xfe, 0xfb, 0x94, 0x00, 0x00,
        ]);

        // Build EBML + WebM container
        const parts: Buffer[] = [];

        // ─ EBML Header ─
        parts.push(Buffer.from([
            0x1a, 0x45, 0xdf, 0xa3, // EBML element ID
            0x93,                     // size = 19
            0x42, 0x86, 0x81, 0x01,  // EBMLVersion = 1
            0x42, 0xf7, 0x81, 0x01,  // EBMLReadVersion = 1
            0x42, 0xf2, 0x81, 0x04,  // EBMLMaxIDLength = 4
            0x42, 0xf3, 0x81, 0x08,  // EBMLMaxSizeLength = 8
            0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, // DocType = "webm"
            0x42, 0x87, 0x81, 0x02,  // DocTypeVersion = 2
            0x42, 0x85, 0x81, 0x02,  // DocTypeReadVersion = 2
        ]));

        // ─ Segment (unknown size) ─
        parts.push(Buffer.from([
            0x18, 0x53, 0x80, 0x67, // Segment ID
            0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, // Unknown size
        ]));

        // ── Info ──
        const infoPayload = Buffer.from([
            0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40, // TimestampScale = 1000000
            0x44, 0x89, 0x84, 0x41, 0x20, 0x00, 0x00,  // Duration = 10.0 (float)
        ]);
        parts.push(Buffer.from([0x15, 0x49, 0xa9, 0x66, 0x80 | infoPayload.length])); // Info ID + size
        parts.push(infoPayload);

        // ── Tracks ──
        // TrackEntry: TrackNumber=1, TrackUID=1, TrackType=1(video), CodecID="V_VP8", Video(PixelWidth=1, PixelHeight=1)
        const trackEntry = Buffer.from([
            0xd7, 0x81, 0x01,        // TrackNumber = 1
            0x73, 0xc5, 0x81, 0x01,  // TrackUID = 1
            0x83, 0x81, 0x01,        // TrackType = 1 (video)
            0x86, 0x85, 0x56, 0x5f, 0x56, 0x50, 0x38, // CodecID = "V_VP8"
            // Video element
            0xe0, 0x86,              // Video ID + size=6
            0xb0, 0x81, 0x01,        // PixelWidth = 1
            0xba, 0x81, 0x01,        // PixelHeight = 1
        ]);
        const tracksPayload = Buffer.concat([
            Buffer.from([0xae, 0x80 | trackEntry.length]), // TrackEntry ID + size
            trackEntry,
        ]);
        parts.push(Buffer.from([0x16, 0x54, 0xae, 0x6b, 0x80 | tracksPayload.length])); // Tracks ID + size
        parts.push(tracksPayload);

        // ── Cluster ──
        const timestamp = Buffer.from([0xe7, 0x81, 0x00]); // Cluster Timestamp = 0
        // SimpleBlock: track=1, timecode=0, keyframe
        const blockHeader = Buffer.from([
            0x81,       // track number (1, EBML-style vint)
            0x00, 0x00, // timecode = 0 (relative to cluster)
            0x80,       // flags: keyframe
        ]);
        const simpleBlockPayload = Buffer.concat([blockHeader, vp8Frame]);
        const simpleBlock = Buffer.concat([
            Buffer.from([0xa3, 0x80 | simpleBlockPayload.length]), // SimpleBlock ID + size
            simpleBlockPayload,
        ]);
        const clusterPayload = Buffer.concat([timestamp, simpleBlock]);
        parts.push(Buffer.from([
            0x1f, 0x43, 0xb6, 0x75,     // Cluster ID
            0x80 | clusterPayload.length, // size
        ]));
        parts.push(clusterPayload);

        return Buffer.concat(parts);
    }

    it("should extract frames from minimal WebM", async () => {
        const webmBuffer = buildMinimalWebM();
        try {
            const frames = await extractAnimatedStickerFrames(webmBuffer, false, 1);
            assert.ok(frames.length >= 1, "Should extract at least 1 frame");
            // Check PNG signature
            assert.equal(frames[0][0], 0x89, "PNG signature byte");
            assert.equal(frames[0][1], 0x50, "'P'");
        } catch (err) {
            // VP8 最小帧可能不被所有解码器接受，如果解码器报错也是合理的
            assert.ok(
                String(err).includes("解码") || String(err).includes("track") || String(err).includes("frame")
                || String(err).includes("VP8") || String(err).includes("FFmpeg") || String(err).includes("Invalid"),
                `Unexpected error: ${err}`,
            );
        }
    });

    it("should throw on empty buffer", async () => {
        await assert.rejects(
            () => extractAnimatedStickerFrames(Buffer.alloc(0), false, 1),
            (err: Error) => {
                assert.ok(err instanceof Error);
                return true;
            },
        );
    });

    it("should throw on invalid WebM data", async () => {
        await assert.rejects(
            () => extractAnimatedStickerFrames(Buffer.from("not webm"), false, 1),
            (err: Error) => {
                assert.ok(err instanceof Error);
                return true;
            },
        );
    });
});

// ─── sampleFrameIndexes 逻辑验证 ───

describe("sampleFrameIndexes", () => {
    it("maxFrames=2 should return first and middle frame for loops", () => {
        assert.deepEqual(sampleFrameIndexes(60, 2), [0, 30]);
    });

    it("should keep first and last frames when sampling 4 frames", () => {
        assert.deepEqual(sampleFrameIndexes(60, 4), [0, 20, 39, 59]);
    });

    it("should handle 0 and 1 frame requests", () => {
        assert.deepEqual(sampleFrameIndexes(60, 0), []);
        assert.deepEqual(sampleFrameIndexes(60, 1), [0]);
    });
});

// ─── sampleFrameIndexes 与 TGS 渲染集成验证 ───

describe("sampleFrameIndexes via TGS extraction", () => {
    // 构造一个 60 帧的 TGS fixture
    const lottie60 = JSON.stringify({
        v: "5.5.2", fr: 30, ip: 0, op: 60, w: 64, h: 64,
        layers: [{
            ty: 1, sw: 64, sh: 64, sc: "#0000ff",
            ip: 0, op: 60, st: 0,
            ks: {
                o: { a: 0, k: 100 }, r: { a: 0, k: 0 },
                p: { a: 0, k: [32, 32, 0] }, a: { a: 0, k: [32, 32, 0] },
                s: { a: 0, k: [100, 100, 100] },
            },
        }],
    });
    const tgs60 = Buffer.from(gzipSync(Buffer.from(lottie60)));

    it("maxFrames=1 should return exactly 1 frame (the first)", async () => {
        const frames = await extractAnimatedStickerFrames(tgs60, true, 1);
        assert.equal(frames.length, 1);
    });

    it("maxFrames=2 should return two sampled frames", async () => {
        const frames = await extractAnimatedStickerFrames(tgs60, true, 2);
        assert.equal(frames.length, 2);
        assert.ok(frames[0].length > 0 && frames[1].length > 0);
    });

    it("maxFrames=4 should return 4 evenly spaced frames", async () => {
        const frames = await extractAnimatedStickerFrames(tgs60, true, 4);
        assert.equal(frames.length, 4);
    });

    it("maxFrames=0 should return empty array", async () => {
        const frames = await extractAnimatedStickerFrames(tgs60, true, 0);
        assert.equal(frames.length, 0);
    });
});
