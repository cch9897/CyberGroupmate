import express from "express";
import { randomUUID } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createLogger } from "../core/logger.js";
import { registerConversationTools } from "./tools/conversation.js";
import { registerMemoryTools } from "./tools/memory.js";
import { registerAgentsTools } from "./tools/agents.js";
import { registerSkillsTools } from "./tools/skills.js";
import { registerTodoTools } from "./tools/todo.js";
import { registerSchedulerTools } from "./tools/scheduler.js";
import { registerDigestTools } from "./tools/digest.js";
import { registerNotifyTools } from "./tools/notify.js";
import { registerPlatformTools } from "./tools/platform.js";
import type { McpServerDeps } from "./types.js";

const log = createLogger("mcp-server");

export interface McpServerConfig {
    port: number;
    authToken: string;
}

export function generateAuthToken(): string {
    return randomUUID().replace(/-/g, "");
}

function createMcpInstance(deps: McpServerDeps): McpServer {
    const mcp = new McpServer(
        { name: "cybergroupmate", version: "1.0.0" },
        { capabilities: { tools: {} } },
    );
    registerConversationTools(mcp, deps);
    registerMemoryTools(mcp, deps);
    registerAgentsTools(mcp, deps);
    registerSkillsTools(mcp, deps);
    registerTodoTools(mcp, deps);
    registerSchedulerTools(mcp, deps);
    registerDigestTools(mcp, deps);
    registerNotifyTools(mcp, deps);
    registerPlatformTools(mcp, deps);
    return mcp;
}

export async function startMcpServer(
    deps: McpServerDeps,
    config: McpServerConfig,
): Promise<{ httpServer: HttpServer; config: McpServerConfig } | null> {
    const app = express();
    app.use(express.json());

    log.info("MCP tools registered");

    const sessions = new Map<string, { transport: StreamableHTTPServerTransport; mcp: McpServer }>();

    app.post("/mcp", async (req, res) => {
        const token = (req.query.token as string)
            || req.headers.authorization?.replace("Bearer ", "");
        if (token !== config.authToken) {
            res.status(401).json({ error: "unauthorized" });
            return;
        }

        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        if (sessionId && sessions.has(sessionId)) {
            const session = sessions.get(sessionId)!;
            await session.transport.handleRequest(req, res, req.body);
            return;
        }

        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
        });
        const mcp = createMcpInstance(deps);

        transport.onclose = () => {
            const sid = res.getHeader("mcp-session-id") as string | undefined
                ?? sessionId;
            if (sid) {
                sessions.delete(sid);
                log.info("MCP session closed", { sessionId: sid });
            }
        };

        await mcp.connect(transport);
        await transport.handleRequest(req, res, req.body);

        const sid = res.getHeader("mcp-session-id") as string | undefined;
        if (sid) {
            sessions.set(sid, { transport, mcp });
            log.info("New MCP session", { sessionId: sid });
        }
    });

    app.get("/mcp", async (req, res) => {
        const token = (req.query.token as string)
            || req.headers.authorization?.replace("Bearer ", "");
        if (token !== config.authToken) {
            res.status(401).json({ error: "unauthorized" });
            return;
        }

        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        if (!sessionId || !sessions.has(sessionId)) {
            res.status(400).json({ error: "no session" });
            return;
        }

        await sessions.get(sessionId)!.transport.handleRequest(req, res);
    });

    app.delete("/mcp", async (req, res) => {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        if (sessionId && sessions.has(sessionId)) {
            const session = sessions.get(sessionId)!;
            await session.transport.handleRequest(req, res);
            sessions.delete(sessionId);
        } else {
            res.status(404).json({ error: "session not found" });
        }
    });

    app.get("/health", (_req, res) => {
        res.json({ status: "ok", sessions: sessions.size });
    });

    const httpServer = createServer(app);

    return new Promise((resolve, reject) => {
        httpServer.once("error", (err: NodeJS.ErrnoException) => {
            if (err.code === "EADDRINUSE") {
                log.warn(`MCP server port ${config.port} already in use, skipping`);
                resolve(null);
            } else {
                reject(err);
            }
        });
        httpServer.listen(config.port, "127.0.0.1", () => {
            log.info(`MCP server listening on http://127.0.0.1:${config.port}/mcp (token: ${config.authToken.slice(0, 8)}...)`);
            resolve({ httpServer, config });
        });
    });
}
