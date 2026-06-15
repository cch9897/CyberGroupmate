import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDispatchApi } from "../src/meta-sandbox/meta-api/dispatch.js";
import { collectQuoteRefs, resolveQuoteRefs } from "../src/meta-sandbox/meta-api/quotes.js";

describe("quote refs", () => {
    it("parses framework-owned refs and keeps external refs as literal strings", async () => {
        const refs = collectQuoteRefs({
            contentDirection: "搬运 @telegram:-1001[10-12] 给 @person[阿喵 in telegram:-1001]",
            quotes: [
                "@[workspace/notes.md]",
                "@[https://example.com/page]",
                "人工整理：外部网页需要 agent 自己抓取。",
                "manual note around @telegram:-1002",
            ],
        });

        assert.deepEqual(refs.map(ref => ref.kind), [
            "chat_range",
            "person",
            "workspace_file",
            "literal",
            "literal",
            "literal",
        ]);
        assert.equal(refs[3]?.raw, "@[https://example.com/page]");
        assert.equal((refs[3] as any).text, "https://example.com/page");
        assert.equal((refs[5] as any).text, "manual note around @telegram:-1002");

        const resolved = await resolveQuoteRefs([
            { kind: "output", raw: "@output[0]", index: 0, source: "test" },
            refs[3]!,
        ], {
            memory: {} as any,
            getOutput: () => ({
                index: 0,
                output: "上一步执行结果",
                timestamp: "2026-05-21T00:00:00.000Z",
                source: "meta.execute",
            }),
        });

        assert.match(resolved.renderedMarkdown ?? "", /Execution Output #0/);
        assert.match(resolved.renderedMarkdown ?? "", /上一步执行结果/);
        assert.match(resolved.renderedMarkdown ?? "", /https:\/\/example\.com\/page/);
    });
});

describe("createDispatchApi", () => {
    it("rejects the removed legacy context field", async () => {
        const api = createDispatchApi({
            memory: {} as any,
            subagentManager: {} as any,
            accumulator: {} as any,
        });

        await assert.rejects(
            () => api.taskToGroup("telegram:1", {
                contentDirection: "reply",
                context: { facts: ["legacy"] },
            } as any),
            /已移除 taskSpec\.context/,
        );
    });

    it("records subagent dispatch source metadata and a global digest", async () => {
        const enqueued: any[] = [];
        const records: any[] = [];
        const digests: string[] = [];
        const api = createDispatchApi({
            memory: {} as any,
            subagentManager: {
                getOrCreate: () => ({
                    chatId: "telegram:target",
                    codeActExecutor: {
                        enqueue: (task: unknown) => enqueued.push(task),
                        getSessionFilePath: () => "workspace/sessions/telegram/target.json",
                    },
                }),
                getSessionFilePath: () => "workspace/sessions/telegram/target.json",
            } as any,
            accumulator: { markActioned: () => undefined } as any,
            globalState: {
                recordDispatchedSubagentTask: (record: unknown) => records.push(record),
                addSessionDigest: (content: string) => digests.push(content),
                getSessionDigests: () => [],
            } as any,
            taskIdFactory: () => "task-from-source",
        });

        await api.taskToGroup(
            "telegram:target",
            { contentDirection: "ask target to verify" },
            { source: { type: "subagent", chatId: "telegram:source" } },
        );

        assert.equal(enqueued.length, 1);
        assert.equal(records[0].sourceType, "subagent");
        assert.equal(records[0].sourceChatId, "telegram:source");
        assert.match(digests[0], /Subagent telegram:source -> telegram:target/);
    });

    it("builds and enqueues a CodeActReplyTask with quoted context and grounding", async () => {
        const enqueued: any[] = [];
        const marked: string[] = [];
        const dispatched: string[] = [];
        const subagent = {
            chatId: "telegram:1",
            codeActExecutor: {
                enqueue: (task: unknown) => {
                    enqueued.push(task);
                },
                getSessionFilePath: () => "workspace/sessions/telegram/1.json",
            },
        };

        const api = createDispatchApi({
            memory: {} as any,
            subagentManager: {
                getOrCreate: () => subagent as any,
                getSessionFilePath: () => "workspace/sessions/telegram/1.json",
            },
            accumulator: {
                markActioned: (chatId: string) => {
                    marked.push(chatId);
                },
            } as any,
            onTaskDispatched: (task) => {
                dispatched.push(`${task.chatId}:${task.decisions[0]?.action}`);
            },
            groundingConfig: {
                provider: "google",
                apiKey: "test",
                baseUrl: "https://example.invalid",
            },
            groundingRunner: async () => "grounded",
            taskIdFactory: () => "task-meta-1",
            getActiveUserProfilesForChat: (chatId) => chatId === "telegram:1"
                ? [{
                    userId: "telegram:u1",
                    displayName: "阿喵",
                    aliases: [],
                    currentChatLabel: "快乐摸鱼群(telegram:1)",
                    messageCount: 1,
                }]
                : undefined,
            getQuoteOutput: (index) => index === 0
                ? { index, output: "facts: x", timestamp: "2026-05-21T00:00:00.000Z" }
                : undefined,
        });

        const result = await api.taskToGroup("telegram:1", {
            contentDirection: "reply with a concise answer",
            toneGuidance: "calm",
            quotes: ["@output[0]"],
            useSkills: ["memory", "telegram"],
        });

        assert.equal(result.taskId, "task-meta-1");
        assert.equal(enqueued.length, 1);
        assert.deepEqual(marked, ["telegram:1"]);
        assert.deepEqual(dispatched, ["telegram:1:REPLY"]);
        assert.equal(enqueued[0].taskId, "task-meta-1");
        assert.equal(enqueued[0].decisions[0].action, "REPLY");
        assert.equal(enqueued[0].contextSnapshot.contentDirection, "reply with a concise answer");
        assert.equal(enqueued[0].contextSnapshot.toneGuidance, "calm");
        assert.equal(enqueued[0].contextSnapshot.groundingContext, "grounded");
        assert.equal(enqueued[0].contextSnapshot.personContext, undefined);
        assert.match(enqueued[0].contextSnapshot.quotedContext, /Execution Output #0/);
        assert.match(enqueued[0].contextSnapshot.quotedContext, /facts: x/);
        assert.equal(enqueued[0].contextSnapshot.dispatchContext, undefined);
        assert.equal(enqueued[0].contextSnapshot.activeUserProfiles[0].userId, "telegram:u1");
        assert.deepEqual(enqueued[0].useSkills, ["memory", "telegram"]);
    });

    it("creates and initializes an executor when the subagent has none", async () => {
        const events: string[] = [];
        const createdExecutors: any[] = [];
        const subagent = {
            chatId: "telegram:2",
            codeActExecutor: null as any,
        };

        const api = createDispatchApi({
            memory: {} as any,
            subagentManager: {
                getOrCreate: () => subagent as any,
                getSessionFilePath: () => "workspace/sessions/telegram/2.json",
            },
            accumulator: {
                markActioned: () => {
                    events.push("markActioned");
                },
            } as any,
            executorFactory: () => {
                const executor = {
                    sessionFilePath: null as string | null,
                    setSessionFilePath(filePath: string) {
                        this.sessionFilePath = filePath;
                        events.push(`setSessionFilePath:${filePath}`);
                    },
                    getSessionFilePath() {
                        return this.sessionFilePath;
                    },
                    loadSession() {
                        events.push("loadSession");
                    },
                    enqueue(task: unknown) {
                        createdExecutors.push(task);
                        events.push("enqueue");
                    },
                };
                return executor as any;
            },
            initializeExecutor: async () => {
                events.push("initializeExecutor");
            },
            taskIdFactory: () => "task-meta-2",
        });

        await api.taskToGroup("telegram:2", {
            contentDirection: "say hi",
        });

        assert.ok(subagent.codeActExecutor);
        assert.deepEqual(events, [
            "setSessionFilePath:workspace/sessions/telegram/2.json",
            "loadSession",
            "initializeExecutor",
            "enqueue",
            "markActioned",
        ]);
        assert.equal(createdExecutors.length, 1);
    });

    it("uses short task ids by default", async () => {
        const enqueued: any[] = [];
        const subagent = {
            chatId: "telegram:short",
            codeActExecutor: {
                enqueue: (task: unknown) => enqueued.push(task),
                getSessionFilePath: () => "workspace/sessions/telegram/short.json",
            },
        };

        const api = createDispatchApi({
            memory: {} as any,
            subagentManager: {
                getOrCreate: () => subagent as any,
                getSessionFilePath: () => "workspace/sessions/telegram/short.json",
            },
            accumulator: {
                markActioned: () => undefined,
            } as any,
        });

        const result = await api.taskToGroup("telegram:short", {
            contentDirection: "say hi",
        });

        assert.match(result.taskId, /^[0-9a-f]{8}$/);
        assert.equal(enqueued[0].taskId, result.taskId);
    });

    it("records dispatch tracking into todo and optional reminder", async () => {
        const enqueued: any[] = [];
        const todos: any[] = [];
        const reminders: any[] = [];
        const subagent = {
            chatId: "telegram:3",
            codeActExecutor: {
                enqueue: (task: unknown) => enqueued.push(task),
                getSessionFilePath: () => "workspace/sessions/telegram/3.json",
            },
        };

        const api = createDispatchApi({
            memory: {
                todoUpsert: (bindingId: string, key: string, content: string, dueAt: string | null) => {
                    todos.push({ bindingId, key, content: JSON.parse(content), dueAt });
                    return { key, content, dueAt, createdAt: "now", updatedAt: "now", expired: false };
                },
            } as any,
            globalState: {
                addReminder: (chatId: string, description: string, triggerAt: string, requestedBy: string, options: any) => {
                    const reminder = { id: "reminder-1", chatId, description, triggerAt, requestedBy, ...options };
                    reminders.push(reminder);
                    return reminder;
                },
            } as any,
            subagentManager: {
                getOrCreate: () => subagent as any,
                getSessionFilePath: () => "workspace/sessions/telegram/3.json",
            },
            accumulator: {
                markActioned: () => undefined,
            } as any,
            taskIdFactory: () => "task-meta-3",
        });

        const result = await api.taskToGroup("telegram:3", {
            contentDirection: "ask for clarification",
            tracking: {
                content: "等对方回复后确认细节",
                remindAfterMinutes: 15,
                callback: "检查 telegram:3 是否有回复，并决定是否继续跟进",
                data: { topicId: "topic-3" },
            },
        });

        assert.deepEqual(result, {
            taskId: "task-meta-3",
            trackingKey: "dispatch:task-meta-3",
            reminderId: "reminder-1",
        });
        assert.equal(enqueued.length, 1);
        assert.equal(todos[0].bindingId, "telegram:3");
        assert.equal(todos[0].key, "dispatch:task-meta-3");
        assert.equal(todos[0].content.taskId, "task-meta-3");
        assert.equal(todos[0].content.bindingId, "telegram:3");
        assert.deepEqual(todos[0].content.data, { topicId: "topic-3" });
        assert.equal(reminders[0].bindingId, "telegram:3");
        assert.equal(reminders[0].callback, "检查 telegram:3 是否有回复，并决定是否继续跟进");
        assert.equal(reminders[0].data.trackingKey, "dispatch:task-meta-3");
    });
});
