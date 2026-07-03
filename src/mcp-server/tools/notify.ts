import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServerDeps } from "../types.js";

export function registerNotifyTools(mcp: McpServer, deps: McpServerDeps): void {
    mcp.tool(
        "notify",
        "Send a notification to Meta Agent or any subagent (group/DM). This is the unified communication tool — use it to deliver research results, request help from the owner, or inform Meta about completed work. The target subagent will receive the content as a task and act on it.",
        {
            to: z.string().describe("Target: 'meta' for Meta Agent, or a bindingId like 'telegram:682932098' for a specific subagent"),
            content: z.string().describe("The message/task content to send"),
            useSkills: z.array(z.string()).optional().describe("Suggest specific skills for the subagent to use"),
        },
        async ({ to, content, useSkills }) => {
            if (to === "meta") {
                deps.globalState.addSessionDigest(`[Background Agent → Meta] ${content}`, {
                    kind: "background_notify",
                    actorType: "harness",
                    actorId: "__background__",
                    sourceChatId: "__background__",
                    targetChatId: "__meta__",
                    tags: ["background", "notify"],
                });
                const now = Date.now();
                deps.accumulator.ingest(1, {
                    chatId: "__meta__",
                    source: "BACKGROUND_AGENT",
                    enqueuedAt: now,
                    payload: {
                        type: "background_notify",
                        id: `bg:${now}`,
                        description: content,
                    },
                });
                return { content: [{ type: "text" as const, text: JSON.stringify({ delivered: true, to: "meta", method: "attention_item" }) }] };
            }

            const result = await deps.metaApi.dispatch.taskToGroup(to, {
                contentDirection: content,
                useSkills,
            }, { source: { type: "harness", chatId: "__background__" } });

            return { content: [{ type: "text" as const, text: JSON.stringify({ delivered: true, to, taskId: result.taskId }) }] };
        },
    );

    mcp.tool(
        "attention_enqueue",
        "Enqueue structured attention for Meta or a subagent. Third-party harnesses must include enough context for Meta to understand the trigger, observed refs, and requested action.",
        {
            target: z.string().default("meta").describe("'meta' or a bindingId/chatId"),
            runId: z.string().optional().describe("Harness run id"),
            actorId: z.string().describe("Harness/actor identifier"),
            triggerReason: z.string().describe("Why this attention is being enqueued"),
            summary: z.string().describe("Concise summary for the target"),
            requestedAction: z.string().optional().describe("What Meta/subagent should do next"),
            sourceChatId: z.string().optional().describe("Source chat/context id, if any"),
            sourceChatTitle: z.string().optional().describe("Human-readable source chat title"),
            taskId: z.string().optional().describe("Related task id"),
            priority: z.number().optional().describe("Attention pressure/priority 0-100"),
            observedContextRefs: z.array(z.string()).optional().describe("Message/task/file refs inspected by the harness"),
            metadata: z.record(z.unknown()).optional().describe("Additional structured context"),
        },
        async (input) => {
            const target = input.target || "meta";
            if (target === "meta") {
                const now = Date.now();
                const content = input.requestedAction
                    ? `${input.summary}\nrequestedAction: ${input.requestedAction}`
                    : input.summary;
                deps.globalState.addSessionDigest(content, {
                    kind: "attention_enqueue",
                    actorType: "harness",
                    actorId: input.actorId,
                    sourceChatId: input.sourceChatId ?? "__background__",
                    sourceChatTitle: input.sourceChatTitle,
                    targetChatId: "__meta__",
                    taskId: input.taskId,
                    runId: input.runId,
                    tags: ["attention"],
                    metadata: {
                        triggerReason: input.triggerReason,
                        requestedAction: input.requestedAction,
                        observedContextRefs: input.observedContextRefs ?? [],
                        ...(input.metadata ?? {}),
                    },
                });
                deps.accumulator.ingest(1, {
                    chatId: "__meta__",
                    source: "BACKGROUND_AGENT",
                    enqueuedAt: now,
                    pressure: input.priority,
                    payload: {
                        type: "attention_enqueue",
                        id: `attention:${now}`,
                        description: input.summary,
                        actorId: input.actorId,
                        triggerReason: input.triggerReason,
                        requestedAction: input.requestedAction,
                        sourceChatId: input.sourceChatId,
                        taskId: input.taskId,
                        runId: input.runId,
                        priority: input.priority,
                    },
                });
                return { content: [{ type: "text" as const, text: JSON.stringify({ delivered: true, target: "meta", method: "attention_item" }) }] };
            }

            const result = await deps.metaApi.dispatch.taskToGroup(target, {
                contentDirection: [
                    input.summary,
                    input.requestedAction ? `requestedAction: ${input.requestedAction}` : "",
                    input.observedContextRefs?.length ? `observedContextRefs: ${input.observedContextRefs.join(", ")}` : "",
                ].filter(Boolean).join("\n"),
            }, {
                source: {
                    type: "harness",
                    chatId: input.sourceChatId ?? input.actorId,
                    taskId: input.taskId,
                    runId: input.runId,
                },
            });
            return { content: [{ type: "text" as const, text: JSON.stringify({ delivered: true, target, taskId: result.taskId }) }] };
        },
    );

    mcp.tool(
        "attention_callback",
        "Report a structured harness callback. This permanently records the digest and can wake Meta when a decision or follow-up is needed.",
        {
            runId: z.string().describe("Harness run id"),
            actorId: z.string().describe("Harness/actor identifier"),
            status: z.string().describe("Callback status, e.g. completed, blocked, needs_meta"),
            triggerReason: z.string().describe("Original trigger reason"),
            summary: z.string().describe("What happened and what remains"),
            requestedMetaAction: z.string().optional().describe("Specific decision/action requested from Meta"),
            sourceChatId: z.string().optional(),
            sourceChatTitle: z.string().optional(),
            taskId: z.string().optional(),
            observedContextRefs: z.array(z.string()).optional(),
            wakeMeta: z.boolean().optional().describe("Set true to enqueue attention for Meta"),
            metadata: z.record(z.unknown()).optional(),
        },
        async (input) => {
            deps.globalState.addSessionDigest(input.summary, {
                kind: "harness_callback",
                actorType: "harness",
                actorId: input.actorId,
                sourceChatId: input.sourceChatId ?? "__background__",
                sourceChatTitle: input.sourceChatTitle,
                targetChatId: input.wakeMeta ? "__meta__" : undefined,
                taskId: input.taskId,
                runId: input.runId,
                tags: ["harness", "callback", input.status].filter(Boolean),
                metadata: {
                    status: input.status,
                    triggerReason: input.triggerReason,
                    requestedMetaAction: input.requestedMetaAction,
                    observedContextRefs: input.observedContextRefs ?? [],
                    ...(input.metadata ?? {}),
                },
            });

            if (input.wakeMeta) {
                const now = Date.now();
                deps.accumulator.ingest(1, {
                    chatId: "__meta__",
                    source: "BACKGROUND_AGENT",
                    enqueuedAt: now,
                    payload: {
                        type: "attention_callback",
                        id: `callback:${input.runId}:${now}`,
                        description: input.requestedMetaAction ?? input.summary,
                        ...input,
                    },
                });
            }

            return { content: [{ type: "text" as const, text: JSON.stringify({ recorded: true, wokeMeta: !!input.wakeMeta }) }] };
        },
    );

    mcp.tool(
        "harness_enqueue",
        "Enqueue work to the consciousness/background harness with structured metadata.",
        {
            content: z.string().describe("Task content for the harness"),
            source: z.string().optional().describe("Source identifier"),
            actorId: z.string().optional().describe("Harness/actor identifier"),
            runId: z.string().optional().describe("Harness run id"),
            triggerReason: z.string().optional().describe("Why this work is being enqueued"),
            sourceChatId: z.string().optional().describe("Source chat/context id"),
            sourceChatTitle: z.string().optional().describe("Human-readable source chat title"),
            taskId: z.string().optional().describe("Related task id"),
            metadata: z.record(z.unknown()).optional().describe("Additional structured context"),
        },
        async (input) => {
            deps.globalState.addSessionDigest(`[harness_enqueue] ${input.content}`, {
                kind: "consciousness_tick",
                actorType: "harness",
                actorId: input.actorId ?? input.source ?? "mcp",
                sourceChatId: input.sourceChatId,
                sourceChatTitle: input.sourceChatTitle,
                targetChatId: "__harness__",
                taskId: input.taskId,
                runId: input.runId,
                tags: ["harness", "enqueue"],
                metadata: {
                    triggerReason: input.triggerReason,
                    ...(input.metadata ?? {}),
                },
            });
            const result = await deps.metaApi.background.enqueue(input.content, input.source ?? "mcp", {
                actorId: input.actorId,
                runId: input.runId,
                triggerReason: input.triggerReason,
                sourceChatId: input.sourceChatId,
                sourceChatTitle: input.sourceChatTitle,
                taskId: input.taskId,
                metadata: input.metadata,
            });
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    mcp.tool(
        "harness_status",
        "Get consciousness/background harness status.",
        async () => {
            const result = await deps.metaApi.background.getStatus();
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
    );
}
