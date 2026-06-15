import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServerDeps } from "../types.js";

export function registerSchedulerTools(mcp: McpServer, deps: McpServerDeps): void {
    mcp.tool(
        "reminder_list",
        "List all reminders, optionally filtered by binding ID.",
        {
            bindingId: z.string().optional().describe("Filter by binding ID"),
            includeTriggered: z.boolean().optional().describe("Include already-triggered reminders"),
        },
        async ({ bindingId, includeTriggered }) => {
            const result = await deps.metaApi.remind.list({ bindingId, includeTriggered });
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    mcp.tool(
        "reminder_set",
        "Create a one-time reminder.",
        {
            name: z.string().describe("Reminder name/description"),
            callback: z.string().describe("Callback text — what to do when the reminder fires"),
            bindingId: z.string().optional().describe("Binding ID"),
            triggerAt: z.string().optional().describe("ISO timestamp to trigger at"),
            delayMinutes: z.number().optional().describe("Minutes from now to trigger (alternative to triggerAt)"),
        },
        async ({ name, callback, bindingId, triggerAt, delayMinutes }) => {
            const result = await deps.metaApi.remind.set({ name, callback, bindingId, triggerAt, delayMinutes });
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    mcp.tool(
        "reminder_delete",
        "Delete a reminder by ID.",
        {
            id: z.string().describe("Reminder ID to delete"),
        },
        async ({ id }) => {
            const result = await deps.metaApi.remind.delete(id);
            return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: result, id }) }] };
        },
    );

    mcp.tool(
        "cron_list",
        "List all cron jobs, optionally filtered by binding ID.",
        {
            bindingId: z.string().optional().describe("Filter by binding ID"),
        },
        async ({ bindingId }) => {
            const result = await deps.metaApi.cron.list({ bindingId });
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    mcp.tool(
        "cron_set",
        "Create a recurring cron job. Minimum interval is 1 hour.",
        {
            name: z.string().describe("Cron job name/description"),
            cronExpr: z.string().describe("Cron expression (e.g. '0 3 * * *' for daily at 3am)"),
            callback: z.string().describe("Callback text — what to do when the cron fires"),
            bindingId: z.string().optional().describe("Binding ID"),
        },
        async ({ name, cronExpr, callback, bindingId }) => {
            const result = await deps.metaApi.cron.set({ name, cronExpr, callback, bindingId });
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    mcp.tool(
        "cron_delete",
        "Delete a cron job by ID.",
        {
            id: z.string().describe("Cron job ID to delete"),
        },
        async ({ id }) => {
            const result = await deps.metaApi.cron.delete(id);
            return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: result, id }) }] };
        },
    );
}
