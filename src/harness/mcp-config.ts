import type { HarnessMcpConfig, HarnessMcpServerConfig } from "./types.js";

export function serializeClaudeMcpConfig(config: HarnessMcpConfig): string {
    return JSON.stringify(config, null, 2);
}

export function serializeCopilotMcpConfig(config: HarnessMcpConfig): string {
    return JSON.stringify({
        mcpServers: Object.fromEntries(
            Object.entries(config.mcpServers).map(([name, server]) => [
                name,
                toCopilotMcpServer(server),
            ]),
        ),
    }, null, 2);
}

function toCopilotMcpServer(server: HarnessMcpServerConfig): Record<string, unknown> {
    if (server.type === "streamable-http") {
        const entry: Record<string, unknown> = {
            type: "http",
            tools: ["*"],
        };
        if (server.url) entry.url = server.url;
        if (server.headers) entry.headers = server.headers;
        return entry;
    }

    const entry: Record<string, unknown> = {
        type: "local",
        tools: ["*"],
    };
    if (server.command) entry.command = server.command;
    if (server.args) entry.args = server.args;
    if (server.env) entry.env = server.env;
    return entry;
}
