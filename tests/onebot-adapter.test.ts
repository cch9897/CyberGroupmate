import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as pathResolve } from "node:path";
import { crc32 } from "node:zlib";
import { NotificationCenter } from "../src/event/notification-center.js";
import type { NotificationEvent } from "../src/event/notification-center.js";
import { OneBotAdapter } from "../src/adapter/onebot-adapter.js";
import type { MediaDownloader } from "../src/core/media-downloader.js";
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

function captureEvents(nc: NotificationCenter): NotificationEvent[] {
    const events: NotificationEvent[] = [];
    nc.onPush(event => events.push(event));
    return events;
}

async function waitForAsyncHandlers(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0));
}

function hasCommand(command: string): boolean {
    try {
        execFileSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

function writeAnimatedGif(filePath: string): void {
    execFileSync("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc=size=64x64:rate=5",
        "-t", "0.6", "-loop", "0",
        "-f", "gif",
        filePath,
    ], { timeout: 15000 });
}

function writeStaticPng(filePath: string): void {
    execFileSync("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=red:s=64x64",
        "-frames:v", "1",
        filePath,
    ], { timeout: 15000 });
}

function writeApng(filePath: string): void {
    execFileSync("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc=size=64x64:rate=5",
        "-t", "0.6", "-plays", "0",
        "-f", "apng",
        filePath,
    ], { timeout: 15000 });
}

/**
 * 生成一个 acTL 前带 >64KB tEXt 辅助块的 APNG（合法 PNG/APNG 布局）。
 * 用于验证嗅探不会停在 64KB 前缀内把 APNG 误判成静态图。
 * 注意：本环境的 ffmpeg 8.0.1 会把这种布局按单帧处理，因此测试只断言分类分支。
 */
function writeApngWithOversizedTextChunk(filePath: string): void {
    writeApng(filePath);
    const source = readFileSync(filePath);
    let offset = 8;
    while (offset + 8 <= source.length) {
        const length = source.readUInt32BE(offset);
        if (source.toString("latin1", offset + 4, offset + 8) === "acTL") break;
        offset += 12 + length;
    }
    assert.equal(source.toString("latin1", offset + 4, offset + 8), "acTL", "ffmpeg APNG output must contain acTL");
    const payload = Buffer.concat([
        Buffer.from("Comment", "latin1"),
        Buffer.from([0]),
        Buffer.alloc(70 * 1024, 0x41),
    ]);
    const typeAndPayload = Buffer.concat([Buffer.from("tEXt", "latin1"), payload]);
    const chunk = Buffer.alloc(12 + payload.length);
    chunk.writeUInt32BE(payload.length, 0);
    typeAndPayload.copy(chunk, 4);
    chunk.writeUInt32BE(crc32(typeAndPayload), 4 + typeAndPayload.length);
    writeFileSync(filePath, Buffer.concat([source.subarray(0, offset), chunk, source.subarray(offset)]));
    assert.ok(offset + chunk.length > 64 * 1024, "acTL must land beyond the 64KB sniff prefix");
}

function countVideoFrames(filePath: string): number {
    const raw = execFileSync("ffprobe", [
        "-v", "error",
        "-count_frames",
        "-select_streams", "v:0",
        "-show_entries", "stream=nb_read_frames",
        "-of", "default=nokey=1:noprint_wrappers=1",
        filePath,
    ], { timeout: 15000 }).toString().trim();
    return Number(raw.split(/\s+/)[0]);
}

function decodeOutgoingImage(calls: Array<{ action: string; params: Record<string, unknown> }>): Buffer {
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, "send_group_msg");
    const message = calls[0].params.message as Array<{ type: string; data?: Record<string, unknown> }>;
    const image = message.find(segment => segment.type === "image");
    assert.ok(image, "expected an image segment");
    const file = String(image.data?.file ?? "");
    assert.ok(file.startsWith("base64://"), `expected base64 image payload, got ${file.slice(0, 60)}`);
    return Buffer.from(file.slice("base64://".length), "base64");
}

/** 清理适配器写入 workspace/Downloads/other/qq-converted 的测试产物。 */
function cleanConvertedArtifacts(prefix: string): void {
    const outDir = pathResolve(process.cwd(), "workspace", "Downloads", "other", "qq-converted");
    try {
        for (const name of readdirSync(outDir)) {
            if (name.startsWith(`${prefix}_`)) unlinkSync(join(outDir, name));
        }
    } catch {
        // 没有转换产物时目录可能不存在
    }
}

describe("OneBotAdapter", () => {
    it("should normalize array at segments into readable mentions and direct attention", async () => {
        const nc = makeNC();
        const events = captureEvents(nc);
        const adapter = new OneBotAdapter(makeConfig(), nc);

        // @ts-expect-error - override private method for focused ingress test
        adapter.callAction = async (action: string, params: Record<string, unknown>) => {
            if (action === "get_group_member_info") {
                assert.deepEqual(params, { group_id: 42, user_id: 123456789, no_cache: false });
                return { user_id: 123456789, card: "BotName", nickname: "BotNick" };
            }
            if (action === "get_group_info") {
                return { group_id: 42, group_name: "Test QQ Group" };
            }
            throw new Error(`unexpected action: ${action}`);
        };

        // @ts-expect-error - invoke private websocket handler for ingress normalization
        adapter.handleWsMessage(JSON.stringify({
            post_type: "message",
            self_id: "123456789",
            message_type: "group",
            group_id: 42,
            user_id: 777,
            message_id: 9001,
            time: 1770000000,
            sender: { user_id: 777, nickname: "Alice", card: "" },
            message: [
                { type: "text", data: { text: "hi " } },
                { type: "at", data: { qq: "123456789" } },
                { type: "text", data: { text: " ping" } },
            ],
        }));
        await waitForAsyncHandlers();

        assert.equal(events.length, 1);
        assert.equal(events[0].type, "nc.message");
        assert.equal(events[0].scene, "onebot");
        assert.equal(events[0].chatId, "onebot:group:42");
        assert.equal(events[0].userId, "onebot:777");
        assert.equal(events[0].displayName, "Alice");
        assert.equal(events[0].text, "hi @BotName ping");
        assert.equal(events[0].mentionsAgent, true);
        assert.equal(events[0].chatTitle, "42");
        assert.deepEqual(events[0].mentions, [{
            userId: "onebot:123456789",
            rawUserId: "123456789",
            displayName: "BotName",
            isAll: false,
            isSelf: true,
        }]);
        assert.deepEqual(events[0].messageSegments, [
            { type: "text", data: { text: "hi " } },
            { type: "at", data: { qq: "123456789" } },
            { type: "text", data: { text: " ping" } },
        ]);
        assert.deepEqual(events[0].source, {
            scene: "onebot",
            platform: "onebot",
            chatId: "onebot:group:42",
            userId: "onebot:777",
            chatType: "group",
            messageId: "9001",
            replyToMessageId: undefined,
        });

        nc.dispose();
    });

    it("should parse CQ at-all strings and unescape text", async () => {
        const nc = makeNC();
        const events = captureEvents(nc);
        const adapter = new OneBotAdapter(makeConfig(), nc);

        // @ts-expect-error - override private method for focused ingress test
        adapter.callAction = async (action: string) => {
            if (action === "get_group_info") return { group_id: 42, group_name: "Test QQ Group" };
            throw new Error(`unexpected action: ${action}`);
        };

        // @ts-expect-error - invoke private websocket handler for ingress normalization
        adapter.handleWsMessage(JSON.stringify({
            post_type: "message",
            self_id: "123456789",
            message_type: "group",
            group_id: 42,
            user_id: 777,
            message_id: 9002,
            sender: { user_id: 777, nickname: "Alice" },
            raw_message: "look &#91;x&#93;[CQ:at,qq=all] done",
        }));
        await waitForAsyncHandlers();

        assert.equal(events.length, 1);
        assert.equal(events[0].text, "look [x]@全体成员 done");
        assert.equal(events[0].mentionsAgent, true);
        assert.deepEqual(events[0].mentions, [{
            userId: "onebot:all",
            rawUserId: "all",
            displayName: "全体成员",
            isAll: true,
            isSelf: false,
        }]);

        nc.dispose();
    });

    it("should send at messages as OneBot segment arrays", async () => {
        const nc = makeNC();
        const adapter = new OneBotAdapter(makeConfig(), nc);
        const calls: Array<{ action: string; params: Record<string, unknown> }> = [];

        // @ts-expect-error - fake connected websocket for handleCall guard
        adapter.ws = { readyState: 1 };
        // @ts-expect-error - override private method for payload inspection
        adapter.callAction = async (action: string, params: Record<string, unknown>) => {
            calls.push({ action, params });
            return { message_id: 3 };
        };

        await adapter.handleCall("onebot.sendAt", [
            "onebot:group:42",
            "onebot:private:778899,223344",
            "看一下",
            { replyTo: 9001 },
        ]);

        assert.deepEqual(calls, [{
            action: "send_group_msg",
            params: {
                group_id: 42,
                message: [
                    { type: "reply", data: { id: "9001" } },
                    { type: "at", data: { qq: "778899" } },
                    { type: "text", data: { text: " " } },
                    { type: "at", data: { qq: "223344" } },
                    { type: "text", data: { text: " 看一下" } },
                ],
            },
        }]);

        nc.dispose();
    });

    it("should send structured OneBot messages and normalize mention targets", async () => {
        const nc = makeNC();
        const adapter = new OneBotAdapter(makeConfig(), nc);
        const calls: Array<{ action: string; params: Record<string, unknown> }> = [];

        // @ts-expect-error - fake connected websocket for handleCall guard
        adapter.ws = { readyState: 1 };
        // @ts-expect-error - override private method for payload inspection
        adapter.callAction = async (action: string, params: Record<string, unknown>) => {
            calls.push({ action, params });
            return { message_id: 4 };
        };

        await adapter.handleCall("onebot.sendMessage", [
            "onebot:group:42",
            [
                { type: "text", data: { text: "cc " } },
                { type: "at", data: { qq: "onebot:778899" } },
                { type: "text", data: { text: " 已处理" } },
            ],
        ]);

        assert.deepEqual(calls, [{
            action: "send_group_msg",
            params: {
                group_id: 42,
                message: [
                    { type: "text", data: { text: "cc " } },
                    { type: "at", data: { qq: "778899" } },
                    { type: "text", data: { text: " 已处理" } },
                ],
            },
        }]);

        nc.dispose();
    });

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

    for (const extension of ["png", "jpg"]) {
        it(`keeps GIF frames when a cached sticker is named .${extension}`, {
            skip: !(hasCommand("ffmpeg") && hasCommand("ffprobe")),
        }, async () => {
            const dir = mkdtempSync(join(tmpdir(), `onebot-sticker-${extension}-`));
            const nc = makeNC();
            const fixtureBase = `gif-as-${extension}-${randomUUID().slice(0, 8)}`;
            try {
                const source = join(dir, `${fixtureBase}.${extension}`);
                writeAnimatedGif(source);
                const calls: Array<{ action: string; params: Record<string, unknown> }> = [];
                const mediaDownloader = {
                    getExistingPath: (key: string) => key === "gif-sticker" ? source : null,
                } as unknown as MediaDownloader;
                const adapter = new OneBotAdapter(makeConfig({ sendFileAsDataUrl: true }), nc, mediaDownloader);
                // @ts-expect-error - override private method for payload inspection
                adapter.callAction = async (action: string, params: Record<string, unknown>) => {
                    calls.push({ action, params });
                    return { message_id: 1 };
                };

                // @ts-expect-error - invoke private sticker send path
                await adapter.sendSticker("onebot:group:42", "gif-sticker", {});

                const payload = decodeOutgoingImage(calls);
                assert.match(payload.subarray(0, 6).toString("latin1"), /^GIF8[79]a$/);
                const outPath = join(dir, "outgoing.gif");
                writeFileSync(outPath, payload);
                assert.ok(countVideoFrames(outPath) > 1, "animated GIF must keep more than one frame");
            } finally {
                cleanConvertedArtifacts(fixtureBase);
                nc.dispose();
                rmSync(dir, { recursive: true, force: true });
            }
        });
    }

    it("keeps GIF frames when sendMedia sends a .jpg-named GIF as a photo", {
        skip: !(hasCommand("ffmpeg") && hasCommand("ffprobe")),
    }, async () => {
        const dir = mkdtempSync(join(tmpdir(), "onebot-photo-gif-"));
        const nc = makeNC();
        const fixtureBase = `photo-as-jpg-${randomUUID().slice(0, 8)}`;
        try {
            const source = join(dir, `${fixtureBase}.jpg`);
            writeAnimatedGif(source);
            const calls: Array<{ action: string; params: Record<string, unknown> }> = [];
            const adapter = new OneBotAdapter(makeConfig({ sendFileAsDataUrl: true }), nc);
            // @ts-expect-error - override private method for payload inspection
            adapter.callAction = async (action: string, params: Record<string, unknown>) => {
                calls.push({ action, params });
                return { message_id: 4 };
            };

            // @ts-expect-error - invoke private media send path
            await adapter.sendMedia("onebot:group:42", { type: "photo", file: source }, {});

            const payload = decodeOutgoingImage(calls);
            assert.match(payload.subarray(0, 6).toString("latin1"), /^GIF8[79]a$/);
            const outPath = join(dir, "outgoing.gif");
            writeFileSync(outPath, payload);
            assert.ok(countVideoFrames(outPath) > 1, "photo path must not flatten a GIF");
        } finally {
            cleanConvertedArtifacts(fixtureBase);
            nc.dispose();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("keeps APNG frames when a cached sticker is a .png", {
        skip: !(hasCommand("ffmpeg") && hasCommand("ffprobe")),
    }, async () => {
        const dir = mkdtempSync(join(tmpdir(), "onebot-sticker-apng-"));
        const nc = makeNC();
        const fixtureBase = `apng-${randomUUID().slice(0, 8)}`;
        try {
            const source = join(dir, `${fixtureBase}.png`);
            writeApng(source);
            const calls: Array<{ action: string; params: Record<string, unknown> }> = [];
            const mediaDownloader = {
                getExistingPath: (key: string) => key === "apng-sticker" ? source : null,
            } as unknown as MediaDownloader;
            const adapter = new OneBotAdapter(makeConfig({ sendFileAsDataUrl: true }), nc, mediaDownloader);
            // @ts-expect-error - override private method for payload inspection
            adapter.callAction = async (action: string, params: Record<string, unknown>) => {
                calls.push({ action, params });
                return { message_id: 3 };
            };

            // @ts-expect-error - invoke private sticker send path
            await adapter.sendSticker("onebot:group:42", "apng-sticker", {});

            const payload = decodeOutgoingImage(calls);
            assert.match(payload.subarray(0, 6).toString("latin1"), /^GIF8[79]a$/);
            const outPath = join(dir, "outgoing.gif");
            writeFileSync(outPath, payload);
            assert.ok(countVideoFrames(outPath) > 1, "APNG must be converted to a multi-frame GIF");
        } finally {
            cleanConvertedArtifacts(fixtureBase);
            nc.dispose();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("still detects APNG when acTL sits behind a >64KB ancillary chunk", {
        skip: !hasCommand("ffmpeg"),
    }, async () => {
        const dir = mkdtempSync(join(tmpdir(), "onebot-sticker-apng-bigtext-"));
        const nc = makeNC();
        const fixtureBase = `apng-bigtext-${randomUUID().slice(0, 8)}`;
        try {
            const source = join(dir, `${fixtureBase}.png`);
            writeApngWithOversizedTextChunk(source);
            assert.ok(readFileSync(source).length > 64 * 1024, "fixture must push acTL beyond the sniff prefix");
            const calls: Array<{ action: string; params: Record<string, unknown> }> = [];
            const mediaDownloader = {
                getExistingPath: (key: string) => key === "apng-bigtext-sticker" ? source : null,
            } as unknown as MediaDownloader;
            const adapter = new OneBotAdapter(makeConfig({ sendFileAsDataUrl: true }), nc, mediaDownloader);
            // @ts-expect-error - override private method for payload inspection
            adapter.callAction = async (action: string, params: Record<string, unknown>) => {
                calls.push({ action, params });
                return { message_id: 5 };
            };

            // @ts-expect-error - invoke private sticker send path
            await adapter.sendSticker("onebot:group:42", "apng-bigtext-sticker", {});

            // 分类为 APNG 时走动画缩放分支（palettegen 输出 .gif）；误判为静态则输出 .png。
            // 本环境的 ffmpeg 8.0.1 把 tEXt 在 acTL 之前的布局按单帧处理，故只断言分支/格式，不断言帧数。
            const payload = decodeOutgoingImage(calls);
            assert.match(payload.subarray(0, 6).toString("latin1"), /^GIF8[79]a$/);
        } finally {
            cleanConvertedArtifacts(fixtureBase);
            nc.dispose();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("still emits a single-frame PNG for a genuinely static sticker", {
        skip: !(hasCommand("ffmpeg") && hasCommand("ffprobe")),
    }, async () => {
        const dir = mkdtempSync(join(tmpdir(), "onebot-sticker-static-"));
        const nc = makeNC();
        const fixtureBase = `static-${randomUUID().slice(0, 8)}`;
        try {
            const source = join(dir, `${fixtureBase}.png`);
            writeStaticPng(source);
            const calls: Array<{ action: string; params: Record<string, unknown> }> = [];
            const mediaDownloader = {
                getExistingPath: (key: string) => key === "static-sticker" ? source : null,
            } as unknown as MediaDownloader;
            const adapter = new OneBotAdapter(makeConfig({ sendFileAsDataUrl: true }), nc, mediaDownloader);
            // @ts-expect-error - override private method for payload inspection
            adapter.callAction = async (action: string, params: Record<string, unknown>) => {
                calls.push({ action, params });
                return { message_id: 2 };
            };

            // @ts-expect-error - invoke private sticker send path
            await adapter.sendSticker("onebot:group:42", "static-sticker", {});

            const payload = decodeOutgoingImage(calls);
            assert.equal(payload.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
            const outPath = join(dir, "outgoing.png");
            writeFileSync(outPath, payload);
            assert.equal(countVideoFrames(outPath), 1);
        } finally {
            cleanConvertedArtifacts(fixtureBase);
            nc.dispose();
            rmSync(dir, { recursive: true, force: true });
        }
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

    it("applyHumanizedDelay is a no-op (delay moved to sandbox host-call handling)", async () => {
        const nc = makeNC();
        const adapter = new OneBotAdapter(makeConfig({
            humanizedDelay: { enabled: true, msPerChar: 50, minDelay: 200, maxDelay: 1000 },
        }), nc);

        const t0 = Date.now();
        // @ts-expect-error - invoke private method directly
        await adapter.applyHumanizedDelay("onebot:group:1", 100);
        const elapsed = Date.now() - t0;
        assert.ok(elapsed < 50, `no-op delay should return immediately (was ${elapsed}ms)`);

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

    it("extractText renders mentions as @rawUserId when no mentionLabels provided", () => {
        const nc = makeNC();
        const adapter = new OneBotAdapter(makeConfig(), nc);
        // @ts-expect-error - 私有方法，验证渲染逻辑
        const out = adapter["extractText"]([
            { type: "at", data: { qq: "123456789" } },
            { type: "text", data: { text: " 在吗，告诉 " } },
            { type: "at", data: { qq: "999" } },
            { type: "text", data: { text: " 和 " } },
            { type: "at", data: { qq: "777" } },
            { type: "text", data: { text: " 一声" } },
        ]);
        assert.equal(out, "@123456789 在吗，告诉 @999 和 @777 一声");
        nc.dispose();
    });

    it("getMessage enriches result via enrichOneBotMessageRecord", async () => {
        const nc = makeNC();
        const adapter = new OneBotAdapter(makeConfig(), nc);

        // callAction 返回 OneBot 原始响应（message 字段包含消息内容）
        // @ts-expect-error - override private method
        adapter.callAction = async () => ({
            message_id: 123,
            message: [{ type: "text", data: { text: "hello" } }],
        });

        // @ts-expect-error - invoke private method for focused test
        const result = await adapter.getMessage("123") as Record<string, unknown>;
        // enrichOneBotMessageRecord 展开原始字段 + 附加 text/mentions/messageSegments 等
        assert.equal(result.message_id, 123);
        assert.equal(result.text, "hello");
        assert.ok(Array.isArray(result.messageSegments));

        nc.dispose();
    });

    it("should preserve fileName as OneBot file segment name", async () => {
        const nc = makeNC();
        const adapter = new OneBotAdapter(makeConfig(), nc);
        const calls: Array<{ action: string; params: Record<string, unknown> }> = [];

        // @ts-expect-error - override private method for payload inspection
        adapter.callAction = async (action: string, params: Record<string, unknown>) => {
            calls.push({ action, params });
            return { message_id: 3 };
        };

        // @ts-expect-error - invoke private method for focused transport test
        await adapter.sendMedia(
            "onebot:group:979200391",
            { type: "document", file: "media/report.pdf", fileName: "report.pdf" },
            {},
        );

        assert.equal(calls.length, 1);
        assert.equal(calls[0].action, "send_group_msg");
        assert.equal(calls[0].params.group_id, 979200391);
        assert.deepEqual(calls[0].params.message, [
            { type: "file", data: { file: `file://${pathResolve(process.cwd(), "workspace", "media/report.pdf")}`, name: "report.pdf" } },
        ]);

        nc.dispose();
    });

    it("should fall back to file basename when fileName is omitted", async () => {
        const nc = makeNC();
        const adapter = new OneBotAdapter(makeConfig(), nc);
        const calls: Array<{ action: string; params: Record<string, unknown> }> = [];

        // @ts-expect-error - override private method for payload inspection
        adapter.callAction = async (action: string, params: Record<string, unknown>) => {
            calls.push({ action, params });
            return { message_id: 4 };
        };

        // Mirrors how the agent actually sends files: sendMedia with a bare
        // { type: "file", file } and no fileName. Without the basename fallback,
        // NapCat drops the name and shows a UUID.
        // @ts-expect-error - invoke private method for focused transport test
        await adapter.sendMedia(
            "onebot:private:1751431516",
            { type: "file", file: "media/Hello World.txt" },
            {},
        );

        assert.equal(calls.length, 1);
        assert.equal(calls[0].action, "send_private_msg");
        assert.deepEqual(calls[0].params.message, [
            { type: "file", data: { file: `file://${pathResolve(process.cwd(), "workspace", "media/Hello World.txt")}`, name: "Hello World.txt" } },
        ]);

        nc.dispose();
    });

    it("should synthesize urgent nc.message when the bot is poked in a group", async () => {
        const nc = makeNC();
        const events = captureEvents(nc);
        const adapter = new OneBotAdapter(makeConfig(), nc);

        // @ts-expect-error - override private method for focused ingress test
        adapter.callAction = async (action: string, params: Record<string, unknown>) => {
            if (action === "get_group_member_info") {
                return { user_id: params.user_id, card: "", nickname: `User${params.user_id}` };
            }
            if (action === "get_group_info") return { group_id: 42, group_name: "Test QQ Group" };
            throw new Error(`unexpected action: ${action}`);
        };

        // @ts-expect-error - invoke private websocket handler for ingress normalization
        adapter.handleWsMessage(JSON.stringify({
            post_type: "notice",
            notice_type: "notify",
            sub_type: "poke",
            self_id: "123456789",
            group_id: 42,
            user_id: 777,
            target_id: 123456789,
            time: 1770000000,
        }));
        await waitForAsyncHandlers();

        assert.equal(events.length, 1);
        assert.equal(events[0].type, "nc.message");
        assert.equal(events[0].scene, "onebot");
        assert.equal(events[0].chatId, "onebot:group:42");
        assert.equal(events[0].userId, "onebot:777");
        assert.equal(events[0].displayName, "User777");
        assert.equal(events[0].text, "[👉 戳一戳] User777 戳了你");
        assert.equal(events[0].chatTitle, "Test QQ Group");
        assert.equal(events[0].chatType, "group");
        assert.equal(events[0].isDirectMessage, false);
        assert.equal(events[0].mentionsAgent, true);
        assert.equal(events[0]._urgent, true);
        assert.equal(
            String(events[0].messageId).startsWith("poke_1770000000_777_123456789_"),
            true,
            `messageId should be synthetic poke id, got ${String(events[0].messageId)}`,
        );
        assert.equal(events[0].payload.platformData.originalType, "notice.notify.poke");
        assert.equal(events[0].payload.platformData.pokedSelf, true);

        nc.dispose();
    });

    it("should synthesize non-urgent context when a group member pokes another member", async () => {
        const nc = makeNC();
        const events = captureEvents(nc);
        const adapter = new OneBotAdapter(makeConfig(), nc);

        // @ts-expect-error - override private method for focused ingress test
        adapter.callAction = async (action: string, params: Record<string, unknown>) => {
            if (action === "get_group_member_info") {
                return { user_id: params.user_id, card: "", nickname: `User${params.user_id}` };
            }
            if (action === "get_group_info") return { group_id: 42, group_name: "Test QQ Group" };
            throw new Error(`unexpected action: ${action}`);
        };

        // @ts-expect-error - invoke private websocket handler for ingress normalization
        adapter.handleWsMessage(JSON.stringify({
            post_type: "notice",
            notice_type: "notify",
            sub_type: "poke",
            self_id: "123456789",
            group_id: 42,
            user_id: 777,
            target_id: 888,
            time: 1770000100,
        }));
        await waitForAsyncHandlers();

        assert.equal(events.length, 1);
        assert.equal(events[0].chatId, "onebot:group:42");
        assert.equal(events[0].text, "[👉 戳一戳] User777 戳了 User888");
        assert.equal(events[0].mentionsAgent, false);
        assert.equal(events[0]._urgent, false);
        assert.equal(events[0].payload.platformData.pokedSelf, false);

        nc.dispose();
    });

    it("should synthesize direct-message event for private poke", async () => {
        const nc = makeNC();
        const events = captureEvents(nc);
        const adapter = new OneBotAdapter(makeConfig(), nc);

        // @ts-expect-error - override private method for focused ingress test
        adapter.callAction = async (action: string, params: Record<string, unknown>) => {
            if (action === "get_stranger_info") {
                return { user_id: params.user_id, nickname: "PrivateFriend" };
            }
            throw new Error(`unexpected action: ${action}`);
        };

        // 好友戳一戳没有 group_id；部分实现不带 target_id
        // @ts-expect-error - invoke private websocket handler for ingress normalization
        adapter.handleWsMessage(JSON.stringify({
            post_type: "notice",
            notice_type: "notify",
            sub_type: "poke",
            self_id: "123456789",
            user_id: 777,
            time: 1770000200,
        }));
        await waitForAsyncHandlers();

        assert.equal(events.length, 1);
        assert.equal(events[0].chatId, "onebot:private:777");
        assert.equal(events[0].chatType, "private");
        assert.equal(events[0].isDirectMessage, true);
        assert.equal(events[0].text, "[👉 戳一戳] PrivateFriend 发起戳一戳");
        assert.equal(events[0]._urgent, true);

        nc.dispose();
    });

    it("should ignore pokes initiated by the bot or for another account", async () => {
        const nc = makeNC();
        const events = captureEvents(nc);
        const adapter = new OneBotAdapter(makeConfig(), nc);

        // @ts-expect-error - override private method; should not be called
        adapter.callAction = async (action: string) => {
            throw new Error(`unexpected action: ${action}`);
        };

        // bot 自己发起的戳一戳（NapCat 回显）
        // @ts-expect-error - invoke private websocket handler for ingress normalization
        adapter.handleWsMessage(JSON.stringify({
            post_type: "notice",
            notice_type: "notify",
            sub_type: "poke",
            self_id: "123456789",
            group_id: 42,
            user_id: 123456789,
            target_id: 777,
            time: 1770000300,
        }));
        // 另一个账号的戳一戳（多账号场景）
        // @ts-expect-error - invoke private websocket handler for ingress normalization
        adapter.handleWsMessage(JSON.stringify({
            post_type: "notice",
            notice_type: "notify",
            sub_type: "poke",
            self_id: "999999999",
            group_id: 42,
            user_id: 777,
            target_id: 123456789,
            time: 1770000301,
        }));
        await waitForAsyncHandlers();

        assert.equal(events.length, 0);

        nc.dispose();
    });
});
