import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServerDeps } from "../types.js";

export function registerConversationTools(mcp: McpServer, deps: McpServerDeps): void {
    mcp.tool(
        "conversation_inbox",
        "List all chats with their latest message, unread status, and queue info. Use to get an overview of recent activity across all groups and DMs.",
        {
            limit: z.number().optional().describe("Max items to return (default 20, max 100)"),
            unreadFirst: z.boolean().optional().describe("Pin unread chats to top (default true)"),
            chatIds: z.array(z.string()).optional().describe("Filter to specific chat IDs"),
            cursor: z.string().optional().describe("Pagination cursor from previous call"),
        },
        async ({ limit, unreadFirst, chatIds, cursor }) => {
            const result = await deps.metaApi.conversations.inbox({
                limit, unreadFirst, chatIds, cursor,
            });
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    mcp.tool(
        "conversation_messages",
        "Get recent messages from a specific chat. Use to read conversation history for a group or DM.",
        {
            chatId: z.string().describe("Chat ID (e.g. telegram:-1002450361141 or telegram:682932098)"),
            limit: z.number().optional().describe("Max messages to return (default 50, max 99)"),
            cursor: z.string().optional().describe("Pagination cursor for older messages"),
            before: z.string().optional().describe("ISO timestamp or epoch ms — get messages before this time"),
            after: z.string().optional().describe("ISO timestamp or epoch ms — get messages after this time"),
        },
        async ({ chatId, limit, cursor, before, after }) => {
            const result = await deps.metaApi.conversations.messages(chatId, {
                limit, cursor, before, after,
            });
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    mcp.tool(
        "conversation_query",
        "Search conversations by user, keyword, time range, or chat. Returns matching messages and topics.",
        {
            chatIds: z.array(z.string()).optional().describe("Filter to specific chats"),
            user: z.string().optional().describe("Person name, alias, or username to search for"),
            userId: z.string().optional().describe("Exact user ID filter"),
            keyword: z.string().optional().describe("Text content keyword search"),
            after: z.string().optional().describe("ISO timestamp — search after this time"),
            before: z.string().optional().describe("ISO timestamp — search before this time"),
            limit: z.number().optional().describe("Max results (default 20, max 100)"),
        },
        async ({ chatIds, user, userId, keyword, after, before, limit }) => {
            const result = await deps.metaApi.conversations.query({
                chatIds, user, userId, keyword, after, before, limit,
            });
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
    );
}
