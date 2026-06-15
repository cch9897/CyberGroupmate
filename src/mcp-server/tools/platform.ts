import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServerDeps } from "../types.js";

const SANDBOX_CALL_TIMEOUT = 120_000;
let executing: Promise<unknown> = Promise.resolve();

export function registerPlatformTools(mcp: McpServer, deps: McpServerDeps): void {

    mcp.tool(
        "sandbox_call",
        "Execute JavaScript code in a sandbox with access to platform modules (telegram, discord, qq, etc.), skills, fs, runtime, memory, and other sandbox APIs. Use this for platform self-operations (changing avatar/bio, posting stories), running skills, file operations, and any multi-step platform workflow. Read src/sandbox/modules/brief-overview.md for available APIs, and .d.ts files for detailed signatures.",
        {
            code: z.string().describe("JavaScript code to execute. All sandbox globals are available: telegram, fs, runtime, skills, memory, todo, mcp, vision, shell, etc."),
        },
        async ({ code }) => {
            const job = executing.then(() => runSandboxCall(deps, code));
            executing = job.catch(() => {});
            return job;
        },
    );
}

async function runSandboxCall(deps: McpServerDeps, code: string) {
    const sandbox = await deps.sandboxPool.acquire("__background__");
    try {
        const wrapped = `const __result__ = await (async () => {\n${code}\n})();\nif (__result__ !== undefined) console.log(typeof __result__ === "string" ? __result__ : JSON.stringify(__result__, null, 2));`;
        const result = await sandbox.execute(wrapped, SANDBOX_CALL_TIMEOUT);
        return {
            content: [{ type: "text" as const, text: result.error ? `Error:\n${result.output}` : (result.output || "(no output)") }],
            isError: result.error,
        };
    } catch (err) {
        return {
            content: [{ type: "text" as const, text: `Sandbox execution failed: ${err}` }],
            isError: true,
        };
    } finally {
        deps.sandboxPool.release("__background__");
    }
}
