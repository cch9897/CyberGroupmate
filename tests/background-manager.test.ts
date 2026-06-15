/**
 * background-manager.test.ts — BackgroundManager 单元测试
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BackgroundManager } from "../src/sandbox/background-manager.js";

/** 辅助：等待若干毫秒 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("BackgroundManager", () => {
    it("should spawn and list a running task", () => {
        const events: Record<string, unknown>[] = [];
        const bg = new BackgroundManager({ notifyCallback: (e) => events.push(e), printCallback: () => { } });

        bg.spawn("test-task", async (signal) => {
            // 长期运行的任务
            await new Promise((_, reject) => {
                signal.addEventListener("abort", () => reject(new Error("aborted")));
            });
        });

        const tasks = bg.ps();
        assert.equal(tasks.length, 1);
        assert.equal(tasks[0].name, "test-task");
        assert.equal(tasks[0].status, "running");
        assert.ok(tasks[0].startedAt);
        assert.equal(tasks[0].endedAt, null);

        bg.killAll();
    });

    it("should replace a running task when spawning the same name", async () => {
        const bg = new BackgroundManager({ notifyCallback: () => { }, printCallback: () => { } });

        let firstAborted = false;
        let firstSignal: AbortSignal | undefined;
        bg.spawn("task-a", async (signal) => {
            firstSignal = signal;
            await new Promise((_, reject) => {
                signal.addEventListener("abort", () => {
                    firstAborted = true;
                    reject(new Error("aborted"));
                });
            });
        });
        assert.equal(bg.runningCount, 1);

        // Re-spawning a running task aborts the existing one and starts the new one
        bg.spawn("task-a", async (signal) => {
            await new Promise((_, reject) => {
                signal.addEventListener("abort", () => reject(new Error("aborted")));
            });
        });

        await sleep(20);
        // The first task's signal was aborted as part of the replacement
        assert.equal(firstAborted, true);
        assert.equal(firstSignal?.aborted, true);
        // Only a single task record remains under that name and it is running
        const tasks = bg.ps();
        assert.equal(tasks.length, 1);
        assert.equal(tasks[0].name, "task-a");
        assert.equal(tasks[0].status, "running");
        assert.equal(bg.runningCount, 1);

        bg.killAll();
    });

    it("should kill a running task", async () => {
        const bg = new BackgroundManager({ notifyCallback: () => { }, printCallback: () => { } });

        bg.spawn("task-b", async (signal) => {
            await new Promise((_, reject) => {
                signal.addEventListener("abort", () => reject(new Error("aborted")));
            });
        });

        const killed = bg.kill("task-b");
        assert.equal(killed, true);

        // Wait for status to update
        await sleep(50);

        const tasks = bg.ps();
        assert.equal(tasks[0].status, "cancelled");
        assert.ok(tasks[0].endedAt);
    });

    it("should return false when killing non-existent task", () => {
        const bg = new BackgroundManager({ notifyCallback: () => { }, printCallback: () => { } });
        const killed = bg.kill("nonexistent");
        assert.equal(killed, false);
    });

    it("should track task that completes normally", async () => {
        const bg = new BackgroundManager({ notifyCallback: () => { }, printCallback: () => { } });

        bg.spawn("quick-task", async () => {
            // 快速完成的任务
            await sleep(10);
        });

        await sleep(50);

        const tasks = bg.ps();
        assert.equal(tasks[0].status, "done");
        assert.ok(tasks[0].endedAt);
    });

    it("should report errors via notifyCallback for crashed tasks", async () => {
        const events: Record<string, unknown>[] = [];
        const bg = new BackgroundManager({ notifyCallback: (e) => events.push(e), printCallback: () => { } });

        bg.spawn("crashing-task", async () => {
            await sleep(10);
            throw new Error("something went wrong");
        });

        await sleep(100);

        const tasks = bg.ps();
        assert.equal(tasks[0].status, "error");
        assert.ok(tasks[0].error?.includes("something went wrong"));

        assert.equal(events.length, 1);
        assert.equal(events[0].type, "system.background_error");
        assert.equal(events[0].taskName, "crashing-task");
        assert.ok((events[0].error as string).includes("something went wrong"));
        assert.ok(events[0].stack);
    });

    it("should allow re-spawning after task completes", async () => {
        const bg = new BackgroundManager({ notifyCallback: () => { }, printCallback: () => { } });

        bg.spawn("reusable", async () => {
            await sleep(10);
        });

        await sleep(50);

        // Task is done, should be able to re-spawn with same name
        bg.spawn("reusable", async () => {
            await sleep(10);
        });

        const tasks = bg.ps();
        const reusable = tasks.find((t) => t.name === "reusable");
        assert.ok(reusable);
        assert.equal(reusable!.status, "running");

        bg.killAll();
    });

    it("should track runningCount correctly", async () => {
        const bg = new BackgroundManager({ notifyCallback: () => { }, printCallback: () => { } });

        assert.equal(bg.runningCount, 0);

        bg.spawn("t1", async (signal) => {
            await new Promise((_, reject) => {
                signal.addEventListener("abort", () => reject(new Error("aborted")));
            });
        });
        assert.equal(bg.runningCount, 1);

        bg.spawn("t2", async () => {
            await sleep(10);
        });
        assert.equal(bg.runningCount, 2);

        await sleep(50);
        assert.equal(bg.runningCount, 1); // t2 finished

        bg.killAll();
        await sleep(50);
        assert.equal(bg.runningCount, 0);
    });

    it("should killAll running tasks", async () => {
        const bg = new BackgroundManager({ notifyCallback: () => { }, printCallback: () => { } });

        for (let i = 0; i < 3; i++) {
            bg.spawn(`task-${i}`, async (signal) => {
                await new Promise((_, reject) => {
                    signal.addEventListener("abort", () =>
                        reject(new Error("aborted"))
                    );
                });
            });
        }

        assert.equal(bg.runningCount, 3);
        bg.killAll();
        await sleep(50);
        assert.equal(bg.runningCount, 0);
    });
});
