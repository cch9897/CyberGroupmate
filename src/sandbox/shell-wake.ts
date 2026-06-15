/**
 * shell-wake.ts — 后台 shell.runBackground 命令的唤醒任务描述构建
 *
 * Sandbox 在后台命令完成 / 空闲 / 硬超时时 emit "shell_wake"，
 * main 侧据此派发一个新的唤醒任务。此处把"原因 → 自然语言任务描述"
 * 抽成纯函数，便于测试与复用。
 */
import type { ShellWakeEvent } from "./sandbox.js";

/**
 * 根据 shell_wake 事件构建给 agent 的唤醒任务描述。
 * 纯函数：不含 id / 时间戳，便于单测。
 */
export function buildShellWakeDescription(event: ShellWakeEvent): string {
    const tail = event.recentOutput && event.recentOutput.trim()
        ? `\n最近输出：\n${event.recentOutput.trim()}`
        : "";
    switch (event.reason) {
        case "exit":
            return (
                `你之前用 shell.runBackground 在后台 tab "${event.tabId}" 启动的命令已结束` +
                `（退出码 ${event.exitCode ?? "未知"}）：\`${event.command}\`。` +
                `用 shell.read("${event.tabId}") 查看完整输出并决定下一步。${tail}`
            );
        case "idle":
            return (
                `你在后台 tab "${event.tabId}" 跑的命令 \`${event.command}\` 已经一段时间没有新输出，` +
                `可能卡住或在等待输入（进程仍在运行，未被 kill）。` +
                `用 shell.read("${event.tabId}") 看看，然后决定：继续等 / shell.sendInput 喂输入 / shell.kill 终止。${tail}`
            );
        case "hard":
            return (
                `你在后台 tab "${event.tabId}" 跑的命令 \`${event.command}\` 已达到运行时长上限但仍未结束` +
                `（进程仍在运行，未被 kill）。` +
                `用 shell.read("${event.tabId}") 看看进度，决定继续等还是 shell.kill 终止。${tail}`
            );
    }
}
