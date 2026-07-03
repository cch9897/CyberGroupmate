import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTodoApi } from "../src/meta-sandbox/meta-api/todo.js";
import { createCronApi, createReminderApi } from "../src/meta-sandbox/meta-api/scheduler.js";
import { buildMetaApiContext } from "../src/meta-sandbox/meta-api/index.js";

describe("createTodoApi", () => {
    it("stores todo items by explicit binding id", async () => {
        const store = new Map<string, any>();
        const api = createTodoApi({
            listGroupModels: () => [{ chatId: "chat-1" }],
            todoList: (bindingId: string) => [...store.values()].filter((row) => row.bindingId === bindingId),
            todoGet: (bindingId: string, key: string) => store.get(`${bindingId}:${key}`) ?? null,
            todoUpsert: (bindingId: string, key: string, content: string, dueAt?: string | null) => {
                const row = { bindingId, key, content, dueAt: dueAt ?? null, createdAt: "now", updatedAt: "now", expired: false };
                store.set(`${bindingId}:${key}`, row);
                return row;
            },
            todoRemove: (bindingId: string, key: string) => {
                store.delete(`${bindingId}:${key}`);
            },
        } as any);

        const item = await api.set({ bindingId: "chat-1", key: "follow", content: "检查回复" });
        assert.equal(item.bindingId, "chat-1");
        assert.equal(typeof item.dueAt, "string");
        assert.equal((await api.get("follow", "chat-1"))?.content, "检查回复");
        assert.equal((await api.list({ bindingId: "chat-1" })).length, 1);
        const dated = await api.set({ bindingId: "chat-1", key: "dated", content: "有时限", dueAt: "2026-01-01T00:00:00.000Z" });
        const refreshed = await api.update("dated", { content: "改内容" }, "chat-1");
        assert.notEqual(refreshed?.dueAt, dated.dueAt);
        assert.equal((await api.set({ bindingId: "chat-1", key: "forever", content: "永久规则", forever: true })).dueAt, null);
        await assert.rejects(() => api.set({ key: "bad", content: "缺 binding" } as any), /bindingId/);
        await assert.rejects(() => api.update("follow", { bindingId: "" }, "chat-1"), /bindingId/);
        const updated = await api.update("follow", {
            bindingId: "meta",
            key: "global-rule",
            content: "全局规则",
            dueAt: null,
        }, "chat-1");
        assert.equal(updated?.bindingId, "meta");
        assert.equal(updated?.key, "global-rule");
        assert.equal(await api.get("follow", "chat-1"), null);
        assert.equal((await api.get("global-rule"))?.content, "全局规则");
        await api.delete("follow", "chat-1");
        await api.delete("global-rule");
        assert.equal(await api.get("global-rule"), null);
    });
});

describe("scheduler APIs", () => {
    it("creates reminder with required callback and binding data", async () => {
        const events: any[] = [];
        const api = createReminderApi({
            addReminder: (chatId: string, description: string, triggerAt: string, requestedBy: string, options: any) => {
                const event = { id: "rem-1", type: "reminder", chatId, description, triggerAt, requestedBy, createdAt: "now", ...options };
                events.push(event);
                return event;
            },
            addCron: () => { throw new Error("unused"); },
            getSchedulerEvents: () => events,
            cancelSchedulerEvent: (id: string) => id === "rem-1",
            updateSchedulerEvent: (id: string, patch: any) => {
                const idx = events.findIndex((event) => event.id === id);
                if (idx < 0) return null;
                events[idx] = { ...events[idx], ...patch };
                return events[idx];
            },
        } as any);

        const event = await api.set({
            name: "回看",
            bindingId: "telegram:1",
            delayMinutes: 5,
            callback: "检查后续回复",
            data: { taskId: "t1" },
        });

        assert.equal(event.id, "rem-1");
        assert.equal(event.bindingId, "telegram:1");
        assert.equal(event.callback, "检查后续回复");
        assert.deepEqual(event.data, { taskId: "t1" });
        const updated = await api.update("rem-1", {
            name: "改期回看",
            triggerAt: Date.now() + 10 * 60_000,
            callback: "检查改期后的后续回复",
        });
        assert.equal(updated?.name, "改期回看");
        assert.equal(updated?.callback, "检查改期后的后续回复");
        assert.equal(updated?.triggered, false);
        const callbackOnly = await api.update("rem-1", { callback: "只改唤醒正文" });
        assert.equal(callbackOnly?.callback, "只改唤醒正文");
        await assert.rejects(() => api.set({ name: "bad", delayMinutes: 1, callback: "" }), /callback/);
    });

    it("creates cron with required callback", async () => {
        const events: any[] = [];
        const api = createCronApi({
            addReminder: () => { throw new Error("unused"); },
            addCron: (chatId: string, description: string, cronExpr: string, taskTemplate: string, options: any) => {
                const event = { id: "cron-1", type: "cron", chatId, description, cronExpr, taskTemplate, createdAt: "now", ...options };
                events.push(event);
                return event;
            },
            getSchedulerEvents: () => events,
            cancelSchedulerEvent: (id: string) => id === "cron-1",
            updateSchedulerEvent: (id: string, patch: any) => {
                const idx = events.findIndex((event) => event.id === id);
                if (idx < 0) return null;
                events[idx] = { ...events[idx], ...patch };
                return events[idx];
            },
        } as any);

        const event = await api.set({
            name: "日报",
            bindingId: "meta",
            cronExpr: "0 9 * * *",
            callback: "整理昨日 digest",
        });

        assert.equal(event.id, "cron-1");
        assert.equal(event.bindingId, "meta");
        assert.equal(event.callback, "整理昨日 digest");

        const updated = await api.update("cron-1", {
            name: "周报",
            cronExpr: "0 10 * * 1",
            callback: "整理上周 digest",
        });
        assert.equal(updated?.name, "周报");
        assert.equal(updated?.cronExpr, "0 10 * * 1");
        assert.equal(updated?.callback, "整理上周 digest");
    });
});

describe("buildMetaApiContext", () => {
    it("assembles meta api modules", () => {
        const context = buildMetaApiContext({
            memory: {} as any,
            subagentManager: {} as any,
            globalState: {} as any,
            accumulator: {} as any,
        });

        assert.equal(typeof context.conversations.query, "function");
        assert.equal(typeof context.conversations.inbox, "function");
        assert.equal(typeof context.conversations.messages, "function");
        assert.equal(typeof context.memory.searchEntities, "function");
        assert.equal(typeof context.memory.resolvePerson, "function");
        assert.equal(typeof context.memory.getPersonDossier, "function");
        assert.equal(typeof context.agents.listStatus, "function");
        assert.equal(typeof context.dispatch.taskToGroup, "function");
        assert.equal(typeof context.todo.set, "function");
        assert.equal(typeof context.todo.update, "function");
        assert.equal(typeof context.remind.set, "function");
        assert.equal(typeof context.remind.update, "function");
        assert.equal(typeof context.cron.set, "function");
        assert.equal(typeof context.cron.update, "function");
    });
});
