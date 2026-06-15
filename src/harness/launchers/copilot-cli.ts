import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "../../core/logger.js";
import { buildHarnessEnv, getHarnessHome, writeHarnessInstructionsWithRestore } from "../home.js";
import { serializeCopilotMcpConfig } from "../mcp-config.js";
import type { HarnessLaunchOptions, HarnessLauncher } from "../types.js";

const log = createLogger("harness-copilot-cli");

export class CopilotCliLauncher implements HarnessLauncher {
    readonly name = "copilot";
    private copilotPath: string;

    constructor(copilotPath?: string) {
        this.copilotPath = copilotPath ?? "copilot";
    }

    async start(options: HarnessLaunchOptions): Promise<ChildProcess> {
        const mcpConfigPath = join(options.workDir, "workspace", ".background-mcp-config.json");
        const homeDir = getHarnessHome();
        mkdirSync(join(options.workDir, "workspace"), { recursive: true });
        writeFileSync(mcpConfigPath, serializeCopilotMcpConfig(options.mcpConfig), "utf-8");
        // 做梦前写入共享 copilot-instructions.md，做完梦后由 restore 还原，避免污染其它实例
        const { instructionPath, restore } = writeHarnessInstructionsWithRestore(homeDir, this.name, options.systemPrompt);

        const args = [
            "-p", options.prompt,
            "--output-format", "json",
            "--yolo",
            "--additional-mcp-config", `@${mcpConfigPath}`,
        ];

        if (options.model) {
            args.push("--model", options.model);
        }

        if (options.extraArgs) {
            args.push(...options.extraArgs);
        }

        log.info("launching copilot cli", {
            copilot: this.copilotPath,
            model: options.model ?? "(default)",
            home: homeDir,
            instructionPath,
        });

        const child = spawn(this.copilotPath, args, {
            cwd: options.workDir,
            stdio: ["ignore", "pipe", "pipe"],
            env: buildHarnessEnv(process.env),
        });

        const cleanup = () => { try { unlinkSync(mcpConfigPath); } catch {} restore(); };
        child.once("exit", cleanup);
        child.once("error", cleanup);

        return child;
    }
}
