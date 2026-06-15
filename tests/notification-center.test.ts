/**
 * notification-center.test.ts — NotificationCenter 单元测试
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NotificationCenter } from "../src/event/notification-center.js";
import type { NotificationEvent } from "../src/event/notification-center.js";

describe("NotificationCenter", () => {
    function makeNC(): NotificationCenter {
        // logPath/enableWatch are deprecated no-ops; file persistence was removed.
        return new NotificationCenter();
    }

    describe("push", () => {
        it("should add _id and _ts to the event", () => {
            const nc = makeNC();
            const event = nc.push({ type: "test.event", data: "hello" });

            assert.ok(event._id, "_id should be set");
            assert.ok(event._ts, "_ts should be set");
            assert.equal(event.type, "test.event");
            assert.equal(event.data, "hello");
        });

        it("should generate monotonically increasing ULIDs", () => {
            const nc = makeNC();
            const e1 = nc.push({ type: "test.a" });
            const e2 = nc.push({ type: "test.b" });
            const e3 = nc.push({ type: "test.c" });

            assert.ok(e1._id < e2._id, "ULID should be monotonically increasing");
            assert.ok(e2._id < e3._id, "ULID should be monotonically increasing");
        });

        it("should increment pendingCount", () => {
            const nc = makeNC();
            assert.equal(nc.pendingCount, 0);
            nc.push({ type: "test.a" });
            assert.equal(nc.pendingCount, 1);
            nc.push({ type: "test.b" });
            assert.equal(nc.pendingCount, 2);
        });
    });

    describe("onPush", () => {
        it("should synchronously deliver pushed events to registered hooks", () => {
            const nc = makeNC();
            const received: NotificationEvent[] = [];
            nc.onPush((event) => received.push(event));

            nc.push({ type: "test.a", value: 1 });
            nc.push({ type: "test.b", value: 2 });

            assert.equal(received.length, 2);
            assert.equal(received[0].type, "test.a");
            assert.equal(received[0].value, 1);
            assert.equal(received[1].type, "test.b");
            assert.ok(received[0]._id);
            assert.ok(received[0]._ts);
        });

        it("should deliver to multiple hooks", () => {
            const nc = makeNC();
            const a: string[] = [];
            const b: string[] = [];
            nc.onPush((e) => a.push(e.type));
            nc.onPush((e) => b.push(e.type));

            nc.push({ type: "test.x" });

            assert.deepEqual(a, ["test.x"]);
            assert.deepEqual(b, ["test.x"]);
        });

        it("should stop delivering after the hook is unregistered", () => {
            const nc = makeNC();
            const received: string[] = [];
            const off = nc.onPush((e) => received.push(e.type));

            nc.push({ type: "test.before" });
            off();
            nc.push({ type: "test.after" });

            assert.deepEqual(received, ["test.before"]);
        });

        it("should isolate hook exceptions so other hooks still run", () => {
            const nc = makeNC();
            const received: string[] = [];
            nc.onPush(() => {
                throw new Error("boom");
            });
            nc.onPush((e) => received.push(e.type));

            // push must not throw even though the first hook fails.
            assert.doesNotThrow(() => nc.push({ type: "test.resilient" }));
            assert.deepEqual(received, ["test.resilient"]);
        });
    });
});
