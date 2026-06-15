import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "../../core/logger.js";
import { buildHarnessEnv, getHarnessHome, writeHarnessInstructionsWithRestore } from "../home.js";
import { serializeClaudeMcpConfig } from "../mcp-config.js";
import type { HarnessLaunchOptions, HarnessLauncher } from "../types.js";

const log = createLogger("harness-claude-code");

export class ClaudeCodeLauncher implements HarnessLauncher {
    readonly name = "claude-code";
    private claudePath: string;

    constructor(claudePath?: string) {
        this.claudePath = claudePath ?? "claude";
    }

    async start(options: HarnessLaunchOptions): Promise<ChildProcess> {
        const mcpConfigPath = join(options.workDir, "workspace", ".background-mcp-config.json");
        const homeDir = getHarnessHome();
        mkdirSync(join(options.workDir, "workspace"), { recursive: true });
        writeFileSync(mcpConfigPath, serializeClaudeMcpConfig(options.mcpConfig), "utf-8");
        // 做梦前写入共享 CLAUDE.md，做完梦后由 restore 还原，避免污染其它 claude 实例
        const { instructionPath, restore } = writeHarnessInstructionsWithRestore(homeDir, this.name, options.systemPrompt);

        const args = [
            "-p", options.prompt,
            "--verbose",
            "--output-format", "stream-json",
            "--dangerously-skip-permissions",
            "--mcp-config", mcpConfigPath,
            "--strict-mcp-config",
        ];

        if (options.model) {
            args.push("--model", options.model);
        }

        if (options.maxBudgetUsd) {
            args.push("--max-budget-usd", String(options.maxBudgetUsd));
        }

        if (options.extraArgs) {
            args.push(...options.extraArgs);
        }

        log.info("launching claude code", {
            claude: this.claudePath,
            model: options.model ?? "(default)",
            maxBudget: options.maxBudgetUsd ?? "(none)",
            home: homeDir,
            instructionPath,
        });

        const child = spawn(this.claudePath, args, {
            cwd: options.workDir,
            stdio: ["ignore", "pipe", "pipe"],
            env: buildHarnessEnv(process.env, { CLAUDE_CODE_ENTRYPOINT: "background-agent" }),
        });

        const cleanup = () => { try { unlinkSync(mcpConfigPath); } catch {} restore(); };
        child.once("exit", cleanup);
        child.once("error", cleanup);

        return child;
    }
}
