import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { installCapabilityRegistry } from "../src/sandbox/capability-registry.js";

describe("installCapabilityRegistry", () => {
    it("should install runtime, skills and telegram", async () => {
        const outputs: string[] = [];
        const notifications: Array<Record<string, unknown>> = [];
        const hostCalls: Array<{ method: string; args?: unknown[] }> = [];
        const ctx: Record<string, unknown> = {};

        const capabilities = installCapabilityRegistry({
            ctx,
            emitOutput: (line) => outputs.push(line),
            notifyHost: (event) => notifications.push(event),
            requestInput: async (prompt) => `answer:${prompt}`,
            printToHost: (message) => outputs.push(`[print] ${message}`),
            spawnTask: () => {},
            killTask: () => {},
            listTasks: () => ["task-a"],
            callHost: async (method, args = []) => {
                hostCalls.push({ method, args });
                switch (method) {
                    case "telegram.sendText":
                        return {
                            id: "msg_1",
                            chat: { id: String(args[0]), type: "private" },
                            text: String(args[1]),
                            date: "2026-03-08T00:00:00.000Z",
                        };
                    case "telegram.getMe":
                        return { id: "42", firstName: "Cyber", isBot: true };
                    case "telegram.sendTyping":
                        return null;
                    default:
                        return null;
                }
            },
        }) as {
            runtime: Record<string, unknown>;
            skills: Record<string, unknown>;
            telegram: Record<string, unknown>;
        };

        assert.ok(capabilities.telegram);
        assert.equal(typeof capabilities.runtime.notify, "function");
        assert.equal(typeof capabilities.runtime.spawn, "function");
        assert.equal(typeof capabilities.skills.install, "function");
        assert.equal(typeof capabilities.skills.reload, "function");

        const tg = capabilities.telegram as { sendText: (chatId: string, text: string) => Promise<unknown>; sendTyping: (chatId: string) => Promise<void> };
        await tg.sendTyping("100");
        const sent = await tg.sendText("100", "hello");
        assert.equal((sent as { id: string }).id, "msg_1");
        assert.ok(outputs.some(line => line.includes("[Telegram] sendTyping ok chat=100")));
        assert.ok(outputs.some(line => line.includes("[Telegram] sendText ok chat=100 msg=msg_1 text=hello")));

        // sendText 直接发射 agent_message_sent 通知（供 SentMessageCollector 捕获）
        assert.ok(notifications.some(event => event.type === "system.agent_message_sent"));

        assert.ok(hostCalls.some(call => call.method === "telegram.sendText"));
    });

    it("should inject Telegram peer guidance when mtcute cannot resolve a peer", async () => {
        const outputs: string[] = [];
        const notifications: Array<Record<string, unknown>> = [];
        const capabilities = installCapabilityRegistry({
            ctx: {},
            emitOutput: (line) => outputs.push(line),
            notifyHost: (event) => notifications.push(event),
            requestInput: async () => "",
            printToHost: (message) => outputs.push(`[print] ${message}`),
            spawnTask: () => {},
            killTask: () => {},
            listTasks: () => [],
            callHost: async (method) => {
                if (method === "telegram.sendText") {
                    throw new Error("MtPeerNotFoundError: Peer 682932098 is not found in local cache");
                }
                return null;
            },
        }) as { telegram: { sendText: (chatId: string, text: string) => Promise<unknown>; meetPeer: unknown; findDialogs: unknown } };

        assert.equal(typeof capabilities.telegram.meetPeer, "function");
        assert.equal(typeof capabilities.telegram.findDialogs, "function");
        await assert.rejects(
            () => capabilities.telegram.sendText("682932098", "hello"),
            /telegram\.meetPeer/,
        );
        assert.ok(outputs.some(line => line.includes("[Telegram peer guardrail]")));
        assert.ok(notifications.some(event => event.type === "system.telegram_peer_guardrail"));
    });
});
