import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServerDeps } from "../types.js";

export function registerAgentsTools(mcp: McpServer, deps: McpServerDeps): void {
    mcp.tool(
        "agents_listStatus",
        "List all subagents with their current status: chat ID, title, queue size, processing state, last active time, and stickiness level.",
        async () => {
            const result = await deps.metaApi.agents.listStatus();
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        },
    );
}
