import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServerDeps } from "../types.js";

export function registerDigestTools(mcp: McpServer, deps: McpServerDeps): void {
    mcp.tool(
        "session_digests",
        "Get recent session digests — summaries of recent agent sessions across all groups and DMs. Essential for understanding what happened recently.",
        async () => {
            const digests = deps.globalState.getSessionDigests();
            return { content: [{ type: "text" as const, text: JSON.stringify(digests, null, 2) }] };
        },
    );
}
