/**
 * shell-wake.test.ts — shell.runBackground 唤醒任务描述构建
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildShellWakeDescription } from "../src/sandbox/shell-wake.js";

describe("buildShellWakeDescription", () => {
    it("exit: 提及退出码、tabId、命令，并引导 shell.read", () => {
        const d = buildShellWakeDescription({
            tabId: "bg-1",
            reason: "exit",
            command: "npm run build",
            exitCode: 0,
            recentOutput: "Build complete",
        });
        assert.ok(d.includes("已结束"));
        assert.ok(d.includes("退出码 0"));
        assert.ok(d.includes("bg-1"));
        assert.ok(d.includes("npm run build"));
        assert.ok(d.includes(`shell.read("bg-1")`));
        assert.ok(d.includes("Build complete"));
    });

    it("idle: 强调未被 kill，并给出 等/喂输入/kill 三个选项", () => {
        const d = buildShellWakeDescription({
            tabId: "dev",
            reason: "idle",
            command: "npm run dev",
            recentOutput: "Listening on :3000",
        });
        assert.ok(d.includes("没有新输出"));
        assert.ok(d.includes("未被 kill"));
        assert.ok(d.includes("shell.sendInput"));
        assert.ok(d.includes("shell.kill"));
        assert.ok(d.includes("Listening on :3000"));
    });

    it("hard: 提及运行时长上限且未被 kill", () => {
        const d = buildShellWakeDescription({
            tabId: "job",
            reason: "hard",
            command: "ffmpeg ...",
            recentOutput: "",
        });
        assert.ok(d.includes("运行时长上限"));
        assert.ok(d.includes("未被 kill"));
        assert.ok(d.includes(`shell.read("job")`));
    });

    it("无 recentOutput 时不追加 '最近输出' 段", () => {
        const d = buildShellWakeDescription({
            tabId: "bg-1",
            reason: "exit",
            command: "true",
            exitCode: 0,
            recentOutput: "   ",
        });
        assert.ok(!d.includes("最近输出"));
    });
});
