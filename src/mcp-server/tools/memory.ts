import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServerDeps } from "../types.js";

export function registerMemoryTools(mcp: McpServer, deps: McpServerDeps): void {
    mcp.tool(
        "memory_resolvePerson",
        "Resolve a person by name, alias, username, or userId. Returns matching identity profiles with confidence scores.",
        {
            query: z.string().describe("Person name, alias, username, or userId"),
            chatId: z.string().optional().describe("Scope search to a specific chat"),
            limit: z.number().optional().describe("Max matches to return"),
        },
        async ({ query, chatId, limit }) => {
            const result = await deps.metaApi.memory.resolvePerson(query, { chatId, limit });
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    mcp.tool(
        "memory_getPersonDossier",
        "Get comprehensive info about a person: profile, group memberships, facts, recent interactions, topics, and messages.",
        {
            queryOrUserId: z.string().describe("Person name/alias or exact userId"),
            chatId: z.string().optional().describe("Scope to a specific chat"),
            limit: z.number().optional().describe("Max dossiers to return"),
            factsLimit: z.number().optional().describe("Max facts per person"),
            interactionsLimit: z.number().optional().describe("Max recent interactions"),
            topicsLimit: z.number().optional().describe("Max recent topics"),
            messagesLimit: z.number().optional().describe("Max recent messages"),
        },
        async ({ queryOrUserId, chatId, limit, factsLimit, interactionsLimit, topicsLimit, messagesLimit }) => {
            const result = await deps.metaApi.memory.getPersonDossier(queryOrUserId, {
                chatId, limit, factsLimit, interactionsLimit, topicsLimit, messagesLimit,
            });
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    mcp.tool(
        "memory_searchEntities",
        "Search memory for entities matching a query. Returns identities, recent sessions, session digests, core facts, and topic keywords.",
        {
            query: z.string().describe("Search query"),
            chatId: z.string().optional().describe("Scope to a specific chat"),
            after: z.string().optional().describe("ISO timestamp — search after this time"),
            before: z.string().optional().describe("ISO timestamp — search before this time"),
            limit: z.number().optional().describe("Max results"),
        },
        async ({ query, chatId, after, before, limit }) => {
            const result = await deps.metaApi.memory.searchEntities(query, {
                chatId, after, before, limit,
            });
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    mcp.tool(
        "memory_searchAgentMemory",
        "Search permanent agent session digests / consciousness memory: Meta intentions, subagent callbacks, harness dream results, dispatches, and follow-up thoughts.",
        {
            query: z.string().describe("Search query"),
            chatId: z.string().optional().describe("Scope to a source/target chat ID"),
            actorType: z.enum(["meta", "subagent", "harness", "system"]).optional().describe("Filter by actor type"),
            kind: z.string().optional().describe("Filter by digest kind, e.g. meta_turn, dispatch_done, harness_callback"),
            after: z.string().optional().describe("ISO timestamp — search after this time"),
            before: z.string().optional().describe("ISO timestamp — search before this time"),
            limit: z.number().optional().describe("Max results"),
        },
        async ({ query, chatId, actorType, kind, after, before, limit }) => {
            const result = await deps.metaApi.memory.searchAgentMemory(query, {
                chatId,
                actorType,
                kind: kind as any,
                after,
                before,
                limit,
            });
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    mcp.tool(
        "memory_timeline",
        "Get a recent timeline combining permanent session digests and topic summaries. Use this to understand what recently happened and what agents intended to do.",
        {
            chatId: z.string().optional().describe("Scope to a chat ID"),
            after: z.string().optional().describe("ISO timestamp — include entries after this time"),
            before: z.string().optional().describe("ISO timestamp — include entries before this time"),
            limit: z.number().optional().describe("Max entries"),
            includeTopics: z.boolean().optional().describe("Include topic summaries (default true)"),
            includeDigests: z.boolean().optional().describe("Include session digests (default true)"),
        },
        async ({ chatId, after, before, limit, includeTopics, includeDigests }) => {
            const result = await deps.metaApi.memory.getTimeline({
                chatId,
                after,
                before,
                limit,
                includeTopics,
                includeDigests,
            });
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
    );
}
