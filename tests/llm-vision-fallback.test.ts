/**
 * tests/llm-vision-fallback.test.ts — 多模态 fallback 降级
 *
 * 场景：Path A（configs[0] 支持 vision）给消息塞了 imageParts，
 * 但 configs[0] 调用失败后 fallback 到的 profile 不支持 vision。
 * 带着图片打过去必然继续失败，fallback 形同虚设。
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import {
    callLLMWithFallback,
    stripImagePartsForNonVisionModel,
    setVisionDegradeConfigProvider,
    clearVisionDegradeCache,
    type ChatMessage,
} from "../src/core/llm.js";
import type { LLMConfig } from "../src/core/config.js";

const IMAGE_DATA_URI = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

interface RecordedRequest {
    model: string;
    body: Record<string, any>;
}

const FAKE_DESCRIPTION = "一只戴墨镜的柴犬";

/**
 * 起一个假的 OpenAI 兼容 endpoint。
 * - model 名里带 "boom" → 400（不可重试 → 立即 fallback，测试不会卡在退避上）
 * - 请求里带图片 → 返回一段固定"图片描述"（模拟视觉模型）
 * - 其余 → "ok"
 */
async function startFakeApi(recorded: RecordedRequest[]): Promise<{ server: Server; port: number }> {
    const server = createServer((req, res) => {
        let raw = "";
        req.on("data", (chunk) => { raw += chunk; });
        req.on("end", () => {
            let body: Record<string, any> = {};
            try { body = JSON.parse(raw); } catch { /* ignore */ }
            const model = String(body.model ?? "");
            recorded.push({ model, body });

            if (model.includes("boom")) {
                res.writeHead(400, { "content-type": "application/json" });
                res.end(JSON.stringify({ error: { message: "vision model exploded" } }));
                return;
            }
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({
                choices: [{ message: { content: hasImageParts(body) ? FAKE_DESCRIPTION : "ok" } }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }));
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { server, port: (server.address() as { port: number }).port };
}

function makeProfile(port: number, model: string, vision?: boolean): LLMConfig {
    return {
        provider: "openai",
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: "test",
        model,
        temperature: 0,
        maxTokens: 64,
        ...(vision ? { vision: true } : {}),
    };
}

function messagesWithImage(): ChatMessage[] {
    return [
        { role: "system", content: "你是助手" },
        { role: "user", content: "看看这张图", imageParts: [{ url: IMAGE_DATA_URI }] },
    ];
}

/** 请求体里是否含多模态 image_url part */
function hasImageParts(body: Record<string, any>): boolean {
    return (body.messages ?? []).some((m: any) =>
        Array.isArray(m.content) && m.content.some((p: any) => p?.type === "image_url")
    );
}

function userText(body: Record<string, any>): string {
    const user = (body.messages ?? []).find((m: any) => m.role === "user");
    if (!user) return "";
    return typeof user.content === "string"
        ? user.content
        : (user.content ?? []).filter((p: any) => p?.type === "text").map((p: any) => p.text).join("\n");
}

describe("stripImagePartsForNonVisionModel", () => {
    it("移除 imageParts 并留下带数量的文字占位", () => {
        const stripped = stripImagePartsForNonVisionModel([
            { role: "user", content: "两张图", imageParts: [{ url: "a" }, { url: "b" }] },
        ]);
        assert.equal(stripped[0].imageParts, undefined);
        assert.match(stripped[0].content, /两张图/);
        assert.match(stripped[0].content, /图片 ×2/);
        assert.match(stripped[0].content, /不支持图片输入/);
    });

    it("没有图片的消息原样返回（保持引用）", () => {
        const input: ChatMessage[] = [{ role: "user", content: "纯文本" }];
        const stripped = stripImagePartsForNonVisionModel(input);
        assert.equal(stripped[0], input[0]);
    });

    it("content 为空时占位文字仍然存在", () => {
        const stripped = stripImagePartsForNonVisionModel([
            { role: "user", content: "", imageParts: [{ url: "a" }] },
        ]);
        assert.match(stripped[0].content, /图片 ×1/);
    });
});

describe("callLLMWithFallback 多模态降级", () => {
    // 默认不注入 vision profile：走"转述不可用 → 纯占位"的二级兜底，
    // 避免测试依赖真实 config.yaml 的 vision 路由（会打真实 API）。
    beforeEach(() => {
        setVisionDegradeConfigProvider(() => []);
        clearVisionDegradeCache();
    });
    afterEach(() => {
        setVisionDegradeConfigProvider(null);
        clearVisionDegradeCache();
    });

    it("一级降级：用 vision 模型把图片转述成文字后交给非 vision profile", async () => {
        const recorded: RecordedRequest[] = [];
        const { server, port } = await startFakeApi(recorded);
        try {
            // 注入一个"视觉转述"专用 profile（同一个假 server）
            setVisionDegradeConfigProvider(() => [makeProfile(port, "describer", true)]);

            const response = await callLLMWithFallback(
                messagesWithImage(),
                [makeProfile(port, "vision-boom", true), makeProfile(port, "text-only")],
                { caller: "test", maxRetries: 0 },
            );

            assert.equal(response.content, "ok", "应由第二个 profile 成功返回");

            const models = recorded.map((r) => r.model);
            assert.deepEqual(models, ["vision-boom", "describer", "text-only"],
                "应依次是：vision profile 失败 → 转述 → 非 vision profile");

            assert.equal(hasImageParts(recorded[0].body), true, "vision profile 应照常收到图片");
            assert.equal(hasImageParts(recorded[1].body), true, "转述调用必须带图片");

            const final = recorded[2];
            assert.equal(hasImageParts(final.body), false, "非 vision profile 不应收到图片");
            assert.match(userText(final.body), /视觉模型对原图的转述/, "应说明这是转述");
            assert.match(userText(final.body), new RegExp(FAKE_DESCRIPTION), "应带上真实描述内容");
            assert.match(userText(final.body), /看看这张图/, "原文应保留");
        } finally {
            setVisionDegradeConfigProvider(() => []);
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    it("二级兜底：没有可用 vision profile 时退回纯文字占位", async () => {
        const recorded: RecordedRequest[] = [];
        const { server, port } = await startFakeApi(recorded);
        try {
            const response = await callLLMWithFallback(
                messagesWithImage(),
                [makeProfile(port, "vision-boom", true), makeProfile(port, "text-only")],
                { caller: "test", maxRetries: 0 },
            );

            assert.equal(response.content, "ok");
            assert.deepEqual(recorded.map((r) => r.model), ["vision-boom", "text-only"], "不应有转述调用");

            const last = recorded[1];
            assert.equal(hasImageParts(last.body), false, "非 vision profile 不应收到图片");
            assert.match(userText(last.body), /图片 ×1/, "应说明原本有几张图");
            assert.match(userText(last.body), /图片已省略/);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    it("noVisionDegrade 完全关闭降级（视觉描述自身路径）", async () => {
        const recorded: RecordedRequest[] = [];
        const { server, port } = await startFakeApi(recorded);
        try {
            setVisionDegradeConfigProvider(() => [makeProfile(port, "describer", true)]);
            await callLLMWithFallback(
                messagesWithImage(),
                [makeProfile(port, "vision-boom", true), makeProfile(port, "text-only")],
                { caller: "vision", maxRetries: 0, noVisionDegrade: true },
            );

            assert.deepEqual(recorded.map((r) => r.model), ["vision-boom", "text-only"], "不应触发转述");
            assert.equal(hasImageParts(recorded[1].body), true, "关闭降级后图片应原样发出");
        } finally {
            setVisionDegradeConfigProvider(() => []);
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    it("原始 messages 不被修改（降级只作用于本次请求）", async () => {
        const recorded: RecordedRequest[] = [];
        const { server, port } = await startFakeApi(recorded);
        try {
            const messages = messagesWithImage();
            await callLLMWithFallback(
                messages,
                [makeProfile(port, "vision-boom", true), makeProfile(port, "text-only")],
                { caller: "test", maxRetries: 0 },
            );
            assert.equal(messages[1].imageParts?.length, 1, "调用方持有的 messages 不应被就地改动");
            assert.equal(messages[1].content, "看看这张图");
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    it("fallback 目标也支持 vision 时保留图片", async () => {
        const recorded: RecordedRequest[] = [];
        const { server, port } = await startFakeApi(recorded);
        try {
            await callLLMWithFallback(
                messagesWithImage(),
                [makeProfile(port, "vision-boom", true), makeProfile(port, "vision-backup", true)],
                { caller: "test", maxRetries: 0 },
            );
            assert.equal(recorded.length, 2);
            assert.equal(hasImageParts(recorded[1].body), true, "备用 vision profile 应仍收到图片");
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    it("整条 chain 都没声明 vision 时不降级（避免误伤没写 vision:true 的视觉 profile）", async () => {
        const recorded: RecordedRequest[] = [];
        const { server, port } = await startFakeApi(recorded);
        try {
            // 模拟 vision 路由的 profile 忘了写 vision: true
            await callLLMWithFallback(
                messagesWithImage(),
                [makeProfile(port, "describer-boom"), makeProfile(port, "describer-backup")],
                { caller: "test", maxRetries: 0 },
            );
            assert.equal(recorded.length, 2);
            assert.equal(hasImageParts(recorded[1].body), true, "标记未维护时应保持原行为，仍然发图");
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    it("chain 首个 profile 没写 vision:true 时照常发图（真实 vision 路由形状）", async () => {
        // 线上实测配置：vision 路由第一个 describer 是没写 vision:true 的通用模型
        // （claude-opus 其实完全支持图片），后面才跟着一串写了标记的。
        // 按"chain 里有人声明过"判断会把主 describer 的图剥掉，直接废掉图片描述。
        const recorded: RecordedRequest[] = [];
        const { server, port } = await startFakeApi(recorded);
        try {
            await callLLMWithFallback(
                messagesWithImage(),
                [
                    makeProfile(port, "claude-like-describer"),
                    makeProfile(port, "flagged-backup", true),
                ],
                { caller: "vision", maxRetries: 0 },
            );
            assert.equal(recorded.length, 1, "第一个就该成功");
            assert.equal(
                hasImageParts(recorded[0].body),
                true,
                "首个 describer 未声明 vision 也必须收到图片，否则图片描述功能被废掉",
            );
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    it("非 vision profile 排在 vision profile 之前时不降级，之后才降级", async () => {
        const recorded: RecordedRequest[] = [];
        const { server, port } = await startFakeApi(recorded);
        try {
            await callLLMWithFallback(
                messagesWithImage(),
                [
                    makeProfile(port, "plain-boom"),          // 无标记，排在前 → 保留图片
                    makeProfile(port, "vision-boom", true),   // 有标记 → 保留图片
                    makeProfile(port, "text-only"),           // 前面有 vision → 降级
                ],
                { caller: "test", maxRetries: 0 },
            );
            assert.equal(recorded.length, 3);
            assert.equal(hasImageParts(recorded[0].body), true, "vision profile 之前不降级");
            assert.equal(hasImageParts(recorded[1].body), true, "vision profile 本身不降级");
            assert.equal(hasImageParts(recorded[2].body), false, "vision profile 之后才降级");
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    it("单个非 vision profile 也不降级（无 chain 信息可依据）", async () => {
        const recorded: RecordedRequest[] = [];
        const { server, port } = await startFakeApi(recorded);
        try {
            await callLLMWithFallback(
                messagesWithImage(),
                [makeProfile(port, "solo")],
                { caller: "test", maxRetries: 0 },
            );
            assert.equal(recorded.length, 1);
            assert.equal(hasImageParts(recorded[0].body), true);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    it("无图片时 fallback 行为不变", async () => {
        const recorded: RecordedRequest[] = [];
        const { server, port } = await startFakeApi(recorded);
        try {
            const response = await callLLMWithFallback(
                [{ role: "user", content: "纯文本" }],
                [makeProfile(port, "vision-boom", true), makeProfile(port, "text-only")],
                { caller: "test", maxRetries: 0 },
            );
            assert.equal(response.content, "ok");
            assert.equal(userText(recorded[1].body), "纯文本", "不应插入任何图片占位");
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});
