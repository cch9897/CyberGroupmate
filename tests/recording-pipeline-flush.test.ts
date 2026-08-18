import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RecordingPipeline } from "../src/pipeline/recording-pipeline.js";
import { TopicRegistry } from "../src/pipeline/topic-registry.js";
import type { Message, TopicClusteringResult } from "../src/pipeline/types.js";

function makeMessages(n: number, chatId = "telegram:-100"): Message[] {
    const base = 1_700_000_000_000;
    return Array.from({ length: n }, (_, i) => ({
        id: String(1000 + i),
        chatId,
        senderId: `u${i % 3}`,
        senderName: `user${i % 3}`,
        text: `msg ${i}`,
        timestamp: base + i * 1000,
    })) as Message[];
}

/** 让 cluster 步骤返回「单话题归类」（模拟保底降级或正常成功），三态不触网。 */
function stubSuccess(pipeline: RecordingPipeline): void {
    (pipeline as any).llmTopicClustering = async (msgs: Message[]): Promise<TopicClusteringResult> => ({
        assignments: msgs.map(m => ({ messageId: m.id, topicId: "NEW_1", topicLabel: "对话讨论", keywords: [] })),
        evolutions: [],
    });
    (pipeline as any).llmTopicSummaryTriage = async () => ({ topics: [] });
}

describe("recording pipeline flush batching + safety floor", () => {
    it("caps a flush to maxFlushBatch, leaving the remainder buffered", async () => {
        // memory 省略 → flush 的 Step4 落盘被 `if (this.memory)` 跳过，只跑聚类/triage/registry
        const pipeline = new RecordingPipeline(new TopicRegistry(), "Miu", "Miu", undefined, undefined, {
            maxFlushBatch: 5,
            minFlushSize: 1,
        });
        stubSuccess(pipeline);
        (pipeline as any).buffer = makeMessages(12);

        await (pipeline as any).flush();

        // 只处理 5 条，其余 7 条留 buffer 下轮排空（输出体积被锁死）
        assert.equal((pipeline as any).buffer.length, 7);
    });

    it("drains a backlog across repeated flushes", async () => {
        const pipeline = new RecordingPipeline(new TopicRegistry(), "Miu", "Miu", undefined, undefined, {
            maxFlushBatch: 5,
            minFlushSize: 1,
        });
        stubSuccess(pipeline);
        (pipeline as any).buffer = makeMessages(12);

        await (pipeline as any).flush();
        assert.equal((pipeline as any).buffer.length, 7);
        await (pipeline as any).flush();
        assert.equal((pipeline as any).buffer.length, 2);
        await (pipeline as any).flush();
        assert.equal((pipeline as any).buffer.length, 0);
    });

    it("caps the buffer on repeated failure instead of growing unbounded (no death spiral)", async () => {
        const pipeline = new RecordingPipeline(new TopicRegistry(), "Miu", "Miu", undefined, undefined, {
            maxFlushBatch: 5,
            maxBufferSize: 10,
            minFlushSize: 1,
        });
        // 模拟持续失败（非 LLM 错误逃逸到 flush catch）
        (pipeline as any).llmTopicClustering = async () => { throw new Error("boom"); };
        (pipeline as any).buffer = makeMessages(12);

        await (pipeline as any).flush();

        // 失败批次 unshift 回去后总量 12 > cap 10 → 丢最旧、封顶在 10，绝不越滚越大
        assert.equal((pipeline as any).buffer.length, 10);
        assert.ok((pipeline as any).buffer.length <= 10);
    });

    it("fallbackClustering assigns every message to a single topic (drains, no re-buffer)", () => {
        const pipeline = new RecordingPipeline(new TopicRegistry(), "Miu", "Miu");
        const msgs = makeMessages(37);

        const result: TopicClusteringResult = (pipeline as any).fallbackClustering(msgs);

        assert.equal(result.assignments.length, 37);
        assert.ok(result.assignments.every(a => a.topicId === "NEW_1"));
        assert.deepEqual(result.evolutions, []);
    });

    it("clamps out-of-range maxFlushBatch/maxBufferSize (0/负/小数/Infinity) to safe values", () => {
        // 非法值回退默认（maxFlushBatch=120 / maxBufferSize=1000）：
        // 0 → slice(0,0) 空批 + 每 3s 空转；负/-0 → slice(-0)===slice(0) 保留整个 buffer、封顶失效
        const bad = new RecordingPipeline(new TopicRegistry(), "Miu", "Miu", undefined, undefined, {
            maxFlushBatch: 0,
            maxBufferSize: -5,
        });
        assert.equal((bad as any).maxFlushBatch, 120);
        assert.equal((bad as any).maxBufferSize, 1000);

        // Infinity 也视为非法（等于不封顶＝重新引入死亡螺旋）→ 回退默认
        const infinite = new RecordingPipeline(new TopicRegistry(), "Miu", "Miu", undefined, undefined, {
            maxFlushBatch: Infinity,
        });
        assert.equal((infinite as any).maxFlushBatch, 120);

        // 合法值原样透传，小数向下取整为整数（7.9 → 7）
        const ok = new RecordingPipeline(new TopicRegistry(), "Miu", "Miu", undefined, undefined, {
            maxFlushBatch: 7.9,
            maxBufferSize: 42,
        });
        assert.equal((ok as any).maxFlushBatch, 7);
        assert.equal((ok as any).maxBufferSize, 42);
    });

    it("re-arms drain for a sub-minFlushSize tail on success, but throttles it on error", () => {
        const pipeline = new RecordingPipeline(new TopicRegistry(), "Miu", "Miu", undefined, undefined, {
            minFlushSize: 10,
        });
        // 成功路径：批次上限切剩的 3 条尾巴（< minFlushSize 10）仍要排空，否则滞留到下次活跃/静默才落盘
        (pipeline as any).buffer = makeMessages(3);
        assert.equal((pipeline as any).shouldRearmDrain(false), true);
        // 失败路径：同样 3 条不排空——避免对持续失败的小批次每 3s 热重试刷屏
        assert.equal((pipeline as any).shouldRearmDrain(true), false);
        // 失败路径：积压 >= minFlushSize 仍排空以追赶
        (pipeline as any).buffer = makeMessages(10);
        assert.equal((pipeline as any).shouldRearmDrain(true), true);
        // buffer 空：任何路径都不排空
        (pipeline as any).buffer = [];
        assert.equal((pipeline as any).shouldRearmDrain(false), false);
    });
});

/**
 * 回归：cluster LLM 返回「合法 JSON、语义为空/无效」的软失败。
 * 修复前——空 assignments 被当成功、消息 unshift 回 buffer、finally re-arm 无限重跑同批（死亡螺旋）。
 * 修复后——normalizeClusteringResult 永不返回空 assignments，flush 正常排空。
 */
describe("recording pipeline clustering output validation", () => {
    function normalize(pipeline: RecordingPipeline, raw: string, msgs: Message[]): TopicClusteringResult {
        return (pipeline as any).normalizeClusteringResult(raw, msgs) as TopicClusteringResult;
    }

    it("合法空结果 → 本地 fallback（每条消息归到 NEW_1，绝不返回空）", () => {
        const pipeline = new RecordingPipeline(new TopicRegistry(), "Miu", "Miu");
        const msgs = makeMessages(5);

        const result = normalize(pipeline, JSON.stringify({ assignments: [], evolutions: [] }), msgs);

        assert.equal(result.assignments.length, 5);
        assert.ok(result.assignments.every(a => a.topicId === "NEW_1"));
        assert.deepEqual(result.evolutions, []);
    });

    it("缺失 assignments 字段 → fallback，不抛异常", () => {
        const pipeline = new RecordingPipeline(new TopicRegistry(), "Miu", "Miu");
        const msgs = makeMessages(4);

        const result = normalize(pipeline, JSON.stringify({ evolutions: [] }), msgs);

        assert.equal(result.assignments.length, 4);
        assert.ok(result.assignments.every(a => a.topicId === "NEW_1"));
    });

    it("JSON 解析失败 → fallback", () => {
        const pipeline = new RecordingPipeline(new TopicRegistry(), "Miu", "Miu");
        const msgs = makeMessages(3);

        const result = normalize(pipeline, "这不是 JSON {", msgs);

        assert.equal(result.assignments.length, 3);
        assert.ok(result.assignments.every(a => a.topicId === "NEW_1"));
    });

    it("assignments 全部引用不存在的 messageId → fallback", () => {
        const pipeline = new RecordingPipeline(new TopicRegistry(), "Miu", "Miu");
        const msgs = makeMessages(3);
        const raw = JSON.stringify({
            assignments: [{ messageId: "unknown", topicId: "NEW_1", topicLabel: "test", keywords: [] }],
            evolutions: [],
        });

        const result = normalize(pipeline, raw, msgs);

        assert.equal(result.assignments.length, 3);
        assert.ok(result.assignments.every(a => a.topicId === "NEW_1"));
    });

    it("evolutions 缺失但 assignments 有效 → 接受并把 evolutions 规范化为 []", () => {
        const pipeline = new RecordingPipeline(new TopicRegistry(), "Miu", "Miu");
        const msgs = makeMessages(3);
        const raw = JSON.stringify({
            assignments: msgs.map(m => ({ messageId: m.id, topicId: "NEW_1", topicLabel: "话题", keywords: [] })),
            // 无 evolutions 字段
        });

        const result = normalize(pipeline, raw, msgs);

        assert.equal(result.assignments.length, 3);
        assert.ok(result.assignments.every(a => a.topicId === "NEW_1"));
        assert.deepEqual(result.evolutions, []);
    });

    it("部分 assignments 有效 → 保留有效项 + 未覆盖消息补 fallback（绝不丢消息）", () => {
        const pipeline = new RecordingPipeline(new TopicRegistry(), "Miu", "Miu");
        const msgs = makeMessages(4); // ids: 1000..1003
        const raw = JSON.stringify({
            assignments: [
                { messageId: "1000", topicId: "NEW_1", topicLabel: "有效", keywords: [] }, // 有效
                { messageId: "1001", topicId: "NEW_1", topicLabel: "有效", keywords: [] }, // 有效
                { messageId: "unknown", topicId: "NEW_1", topicLabel: "坏", keywords: [] }, // 无效: 假 messageId
                { messageId: "1002", topicId: "", topicLabel: "坏", keywords: [] },        // 无效: 空 topicId
                // "1003" 完全未被提及
            ],
            evolutions: [],
        });

        const result = normalize(pipeline, raw, msgs);

        // 覆盖完整：每条消息恰好一个 assignment，无丢失、无重复
        assert.equal(result.assignments.length, 4);
        const coveredIds = new Set(result.assignments.map(a => a.messageId));
        assert.deepEqual([...coveredIds].sort(), ["1000", "1001", "1002", "1003"]);
        // 有效项保留原 topicId；补齐项走 NEW_FALLBACK
        const byId = new Map(result.assignments.map(a => [a.messageId, a]));
        assert.equal(byId.get("1000")?.topicId, "NEW_1");
        assert.equal(byId.get("1001")?.topicId, "NEW_1");
        assert.equal(byId.get("1002")?.topicId, "NEW_FALLBACK");
        assert.equal(byId.get("1003")?.topicId, "NEW_FALLBACK");
    });

    it("flush 遇到空聚类结果时正常排空 buffer（不回退、不无限重跑）", async () => {
        const pipeline = new RecordingPipeline(new TopicRegistry(), "Miu", "Miu", undefined, undefined, {
            maxFlushBatch: 50,
            minFlushSize: 1,
        });
        // 模拟 cluster LLM 返回合法但语义为空的软失败（修复前会触发死亡螺旋）
        (pipeline as any).llmTopicClustering = async (): Promise<TopicClusteringResult> => ({
            assignments: [],
            evolutions: [],
        });
        (pipeline as any).llmTopicSummaryTriage = async () => ({ topics: [] });
        const registry: TopicRegistry = (pipeline as any).registry;
        (pipeline as any).buffer = makeMessages(12);

        await (pipeline as any).flush();

        // buffer 完全排空（buffer < minFlushSize → finally 不会 re-arm drain，无限循环被切断）
        assert.equal((pipeline as any).buffer.length, 0);
        // 整批 fallback 落到单一新话题，12 条消息全部被记录、无丢失
        const topics = registry.getAll();
        assert.equal(topics.length, 1);
        assert.equal(topics[0].messageCount, 12);
    });
});
