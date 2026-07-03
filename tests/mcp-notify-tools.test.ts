import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { registerNotifyTools } from "../src/mcp-server/tools/notify.js";

type RegisteredTool = {
    description?: string;
    schema?: unknown;
    handler: (input: any) => Promise<unknown>;
};

function createToolHarness() {
    const tools = new Map<string, RegisteredTool>();
    const digests: Array<{ content: string; options: any }> = [];
    const attentionItems: any[] = [];
    const dispatched: any[] = [];
    const harnessTasks: any[] = [];

    const mcp = {
        tool: (name: string, ...args: any[]) => {
            const handler = args.at(-1);
            const description = typeof args[0] === "string" ? args[0] : undefined;
            const schema = typeof args[0] === "string" ? args[1] : args[0];
            tools.set(name, { description, schema, handler });
        },
    };
    const deps = {
        globalState: {
            addSessionDigest: (content: string, options?: any) => {
                digests.push({ content, options });
                return { content, createdAt: new Date(0).toISOString(), ...options };
            },
        },
        accumulator: {
            ingest: (_layer: number, item: any) => {
                attentionItems.push(item);
            },
        },
        metaApi: {
            dispatch: {
                taskToGroup: async (chatId: string, spec: unknown, options?: unknown) => {
                    dispatched.push({ chatId, spec, options });
                    return { taskId: "task-1" };
                },
            },
            background: {
                enqueue: async (content: string, source: string, options?: unknown) => {
                    harnessTasks.push({ content, source, options });
                    return { queued: true, id: "harness-1" };
                },
                getStatus: async () => ({ running: false, pending: harnessTasks.length }),
            },
        },
        sandboxPool: {},
        workspaceRoot: process.cwd(),
    };

    registerNotifyTools(mcp as any, deps as any);
    return { tools, digests, attentionItems, dispatched, harnessTasks };
}

describe("MCP notify/consciousness tools", () => {
    it("attention_enqueue records a structured digest and wakes Meta", async () => {
        const { tools, digests, attentionItems } = createToolHarness();

        const result = await tools.get("attention_enqueue")!.handler({
            actorId: "harness:test",
            runId: "run-1",
            triggerReason: "idle tick",
            summary: "Found a follow-up worth Meta review",
            requestedAction: "Decide whether to dispatch",
            sourceChatId: "telegram:g1",
            sourceChatTitle: "Group One",
            taskId: "task-x",
            observedContextRefs: ["message:1"],
            priority: 72,
        }) as { content: Array<{ text: string }> };

        assert.match(result.content[0]!.text, /"delivered":true/);
        assert.equal(digests.length, 1);
        assert.equal(digests[0]!.options.kind, "attention_enqueue");
        assert.equal(digests[0]!.options.actorType, "harness");
        assert.equal(digests[0]!.options.actorId, "harness:test");
        assert.equal(digests[0]!.options.sourceChatId, "telegram:g1");
        assert.equal(digests[0]!.options.targetChatId, "__meta__");
        assert.deepEqual(digests[0]!.options.metadata.observedContextRefs, ["message:1"]);
        assert.equal(attentionItems.length, 1);
        assert.equal(attentionItems[0]!.chatId, "__meta__");
        assert.equal(attentionItems[0]!.source, "BACKGROUND_AGENT");
        assert.equal(attentionItems[0]!.payload.type, "attention_enqueue");
        assert.equal(attentionItems[0]!.payload.runId, "run-1");
    });

    it("attention_callback records completion and optionally wakes Meta", async () => {
        const { tools, digests, attentionItems } = createToolHarness();

        await tools.get("attention_callback")!.handler({
            actorId: "harness:test",
            runId: "run-2",
            status: "needs_meta",
            triggerReason: "third-party monitor",
            summary: "The monitor found a stalled callback",
            requestedMetaAction: "Wake the owner-facing Meta loop",
            sourceChatId: "telegram:g2",
            wakeMeta: true,
            observedContextRefs: ["task:7"],
        });

        assert.equal(digests.length, 1);
        assert.equal(digests[0]!.content, "The monitor found a stalled callback");
        assert.equal(digests[0]!.options.runId, "run-2");
        assert.deepEqual(digests[0]!.options.tags, ["harness", "callback", "needs_meta"]);
        assert.equal(digests[0]!.options.metadata.requestedMetaAction, "Wake the owner-facing Meta loop");
        assert.equal(attentionItems.length, 1);
        assert.equal(attentionItems[0]!.payload.type, "attention_callback");
        assert.equal(attentionItems[0]!.payload.description, "Wake the owner-facing Meta loop");
    });

    it("harness_enqueue and harness_status forward to the background harness API", async () => {
        const { tools, harnessTasks } = createToolHarness();

        const enqueued = await tools.get("harness_enqueue")!.handler({
            content: "consciousness_tick: inspect pending thoughts",
            source: "test",
            actorId: "harness:test",
            runId: "run-h",
            triggerReason: "manual audit",
        }) as { content: Array<{ text: string }> };
        const status = await tools.get("harness_status")!.handler({}) as { content: Array<{ text: string }> };

        assert.deepEqual(harnessTasks, [{
            content: "consciousness_tick: inspect pending thoughts",
            source: "test",
            options: {
                actorId: "harness:test",
                runId: "run-h",
                triggerReason: "manual audit",
                sourceChatId: undefined,
                sourceChatTitle: undefined,
                taskId: undefined,
                metadata: undefined,
            },
        }]);
        assert.match(enqueued.content[0]!.text, /"queued": true/);
        assert.match(status.content[0]!.text, /"pending": 1/);
    });
});
