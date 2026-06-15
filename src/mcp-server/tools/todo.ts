import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServerDeps } from "../types.js";

export function registerTodoTools(mcp: McpServer, deps: McpServerDeps): void {
    mcp.tool(
        "todo_list",
        "List all todo items, optionally filtered by binding ID (chat/agent). Shows key, content, due date, and binding.",
        {
            bindingId: z.string().optional().describe("Filter by binding ID (e.g. 'meta', 'telegram:xxx'). Omit for all."),
            includeExpired: z.boolean().optional().describe("Include expired items (default false)"),
        },
        async ({ bindingId, includeExpired }) => {
            const result = await deps.metaApi.todo.list({ bindingId, includeExpired });
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    mcp.tool(
        "todo_get",
        "Get a specific todo item by key.",
        {
            key: z.string().describe("Todo item key"),
            bindingId: z.string().optional().describe("Binding ID (default 'meta')"),
        },
        async ({ key, bindingId }) => {
            const result = await deps.metaApi.todo.get(key, bindingId);
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    mcp.tool(
        "todo_set",
        "Create or update a todo item.",
        {
            key: z.string().describe("Unique key for this todo item"),
            content: z.string().describe("Todo item content/description"),
            bindingId: z.string().optional().describe("Binding ID (default 'meta')"),
            dueAt: z.string().optional().describe("Due date/time (ISO timestamp or epoch ms). Null to clear."),
        },
        async ({ key, content, bindingId, dueAt }) => {
            const result = await deps.metaApi.todo.set({ key, content, bindingId, dueAt });
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    mcp.tool(
        "todo_delete",
        "Delete a todo item by key.",
        {
            key: z.string().describe("Todo item key to delete"),
            bindingId: z.string().optional().describe("Binding ID (default 'meta')"),
        },
        async ({ key, bindingId }) => {
            await deps.metaApi.todo.delete(key, bindingId);
            return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: true, key }) }] };
        },
    );
}
