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
                deps.globalState.addSessionDigest(`[Background Agent → Meta] ${content}`);
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
            }, { source: { type: "meta", chatId: "__background__" } });

            return { content: [{ type: "text" as const, text: JSON.stringify({ delivered: true, to, taskId: result.taskId }) }] };
        },
    );
}
