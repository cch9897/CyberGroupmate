import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type HarnessInstructionTarget = "claude-code" | "copilot" | string;

export function getHarnessHome(env: NodeJS.ProcessEnv = process.env): string {
    return env.HOME || env.USERPROFILE || homedir();
}

export function getHarnessInstructionPath(homeDir: string, launcherName: HarnessInstructionTarget): string {
    if (launcherName === "copilot") {
        return join(homeDir, ".copilot", "copilot-instructions.md");
    }
    return join(homeDir, ".claude", "CLAUDE.md");
}

export function writeHarnessInstructions(homeDir: string, launcherName: HarnessInstructionTarget, systemPrompt: string): string {
    const instructionPath = getHarnessInstructionPath(homeDir, launcherName);
    mkdirSync(dirname(instructionPath), { recursive: true });
    writeFileSync(instructionPath, systemPrompt.trim() + "\n", "utf-8");
    return instructionPath;
}

/**
 * 做梦前写入 harness 指令（CLAUDE.md / copilot-instructions.md），并返回一个 restore 函数，
 * 用于做梦结束后把这个共享文件还原成做梦前的样子——避免污染同机器上其它 claude 实例。
 *
 * 做梦前如果文件已存在，记下原内容并在 restore 时写回；如果原本不存在，restore 时删除我们写的文件。
 */
export function writeHarnessInstructionsWithRestore(
    homeDir: string,
    launcherName: HarnessInstructionTarget,
    systemPrompt: string,
): { instructionPath: string; restore: () => void } {
    const instructionPath = getHarnessInstructionPath(homeDir, launcherName);
    const existedBefore = existsSync(instructionPath);
    const previousContent = existedBefore ? readFileSync(instructionPath, "utf-8") : null;

    writeHarnessInstructions(homeDir, launcherName, systemPrompt);

    let restored = false;
    const restore = () => {
        if (restored) return;
        restored = true;
        try {
            if (existedBefore && previousContent !== null) {
                writeFileSync(instructionPath, previousContent, "utf-8");
            } else {
                rmSync(instructionPath, { force: true });
            }
        } catch {
            /* 还原失败不应影响主流程；下次做梦前会重新备份当时的内容 */
        }
    };

    return { instructionPath, restore };
}

export function buildHarnessEnv(
    baseEnv: NodeJS.ProcessEnv,
    overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
    return {
        ...baseEnv,
        ...overrides,
    };
}
