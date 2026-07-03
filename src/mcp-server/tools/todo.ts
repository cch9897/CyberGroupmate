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
        "Create or update a todo item. bindingId is required; use 'meta' only for truly global orchestration items. Defaults to a 30-day rolling expiry unless forever is true.",
        {
            key: z.string().describe("Unique key for this todo item"),
            content: z.string().describe("Todo item content/description"),
            bindingId: z.string().describe("Binding ID, e.g. 'meta' or 'telegram:xxx'. Required."),
            dueAt: z.string().optional().describe("Due date/time (ISO timestamp or epoch ms). Omit for the default 30-day rolling expiry."),
            forever: z.boolean().optional().describe("Set true only for explicitly permanent rules."),
        },
        async ({ key, content, bindingId, dueAt, forever }) => {
            const result = await deps.metaApi.todo.set({ key, content, bindingId, dueAt, forever });
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    mcp.tool(
        "todo_update",
        "Edit an existing todo item. Can rename/move it by changing key or bindingId.",
        {
            oldKey: z.string().describe("Current todo item key"),
            oldBindingId: z.string().describe("Current binding ID, e.g. 'meta' or 'telegram:xxx'. Required."),
            key: z.string().optional().describe("New key. Omit to keep the current key."),
            content: z.string().optional().describe("New content. Omit to keep the current content."),
            bindingId: z.string().optional().describe("New binding ID. Omit to keep the current binding."),
            dueAt: z.string().nullable().optional().describe("New due date/time (ISO timestamp or epoch ms). Omit/null for the default 30-day rolling expiry."),
            forever: z.boolean().optional().describe("Set true only for explicitly permanent rules."),
        },
        async ({ oldKey, oldBindingId, key, content, bindingId, dueAt, forever }) => {
            const patch: { key?: string; content?: string; bindingId?: string; dueAt?: string | null; forever?: boolean } = {};
            if (key !== undefined) patch.key = key;
            if (content !== undefined) patch.content = content;
            if (bindingId !== undefined) patch.bindingId = bindingId;
            if (dueAt !== undefined) patch.dueAt = dueAt;
            if (forever !== undefined) patch.forever = forever;
            const result = await deps.metaApi.todo.update(oldKey, patch, oldBindingId);
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
