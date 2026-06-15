/**
 * pool-lifecycle.test.ts — SandboxPool 回收路径对"后台 shell.runBackground 命令"的保护（非 PTY）
 *
 * 用 mock sandbox 注入 pool 内部，覆盖所有静默 kill 路径：
 * cleanupIdle / evictLRU / evictIdle / invalidateSkills / acquire(stale skills)。
 * 不 spawn 真实 PTY，因此进默认测试套件，在任何环境都能跑。
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SandboxPool } from "../src/sandbox/sandbox-pool.js";

interface MockSandbox {
    _bg: boolean;
    stopped: boolean;
    hasActiveBackgroundTasks(): boolean;
    isAlive(): boolean;
    stop(): Promise<void>;
}

function mockSandbox(bg = false): MockSandbox {
    return {
        _bg: bg,
        stopped: false,
        hasActiveBackgroundTasks() { return this._bg; },
        isAlive() { return !this.stopped; },
        async stop() { this.stopped = true; },
    };
}

let pools: SandboxPool[] = [];
function makePool(opts?: { idleTimeout?: number; maxInstances?: number }): SandboxPool {
    const pool = new SandboxPool({ idleTimeout: opts?.idleTimeout ?? 1, maxInstances: opts?.maxInstances ?? 5 });
    pools.push(pool);
    return pool;
}
function inject(
    pool: SandboxPool,
    chatId: string,
    sandbox: MockSandbox,
    opts?: { inUse?: boolean; ageMs?: number; skillGeneration?: number },
): void {
    const internal = pool as unknown as { pool: Map<string, unknown> };
    internal.pool.set(chatId, {
        sandbox,
        chatId,
        lastUsedAt: Date.now() - (opts?.ageMs ?? 1000),
        inUse: opts?.inUse ?? false,
        skillGeneration: opts?.skillGeneration ?? 0,
    });
}
const callPrivate = (pool: SandboxPool, name: "cleanupIdle" | "evictLRU"): void =>
    (pool as unknown as Record<string, () => void>)[name]();

afterEach(() => {
    for (const p of pools) {
        // 清掉 cleanup 定时器，避免泄漏；不 await（mock stop 同步完成）
        void p.dispose().catch(() => {});
    }
    pools = [];
});

describe("SandboxPool reclaim paths protect background shell.runBackground", () => {
    it("cleanupIdle skips a bg-active idle sandbox but reclaims a plain idle one", () => {
        const pool = makePool({ idleTimeout: 1 });
        const bg = mockSandbox(true);
        const plain = mockSandbox(false);
        inject(pool, "bg", bg);
        inject(pool, "plain", plain);

        callPrivate(pool, "cleanupIdle");

        assert.equal(bg.stopped, false, "bg-active 不应被 cleanupIdle 杀掉");
        assert.equal(pool.has("bg"), true);
        assert.equal(plain.stopped, true, "无后台任务的空闲实例应被回收");
        assert.equal(pool.has("plain"), false);
    });

    it("cleanupIdle reclaims the sandbox once its background command finishes", () => {
        const pool = makePool({ idleTimeout: 1 });
        const bg = mockSandbox(true);
        inject(pool, "bg", bg);

        callPrivate(pool, "cleanupIdle");
        assert.equal(pool.has("bg"), true);

        bg._bg = false; // 后台命令结束
        callPrivate(pool, "cleanupIdle");
        assert.equal(bg.stopped, true);
        assert.equal(pool.has("bg"), false);
    });

    it("evictLRU throws (backpressure) when every instance has background work", () => {
        const pool = makePool({ maxInstances: 2 });
        const a = mockSandbox(true);
        const b = mockSandbox(true);
        inject(pool, "a", a, { ageMs: 5000 });
        inject(pool, "b", b, { ageMs: 1000 });

        assert.throws(() => callPrivate(pool, "evictLRU"), /都有后台 shell\.run/);
        assert.equal(a.stopped, false);
        assert.equal(b.stopped, false);
        assert.equal(pool.size, 2);
    });

    it("evictLRU evicts the plain idle instance and never the bg-active one", () => {
        const pool = makePool({ maxInstances: 2 });
        const bg = mockSandbox(true);
        const plain = mockSandbox(false);
        inject(pool, "bg", bg, { ageMs: 9999 });   // 更老，但有后台任务
        inject(pool, "plain", plain, { ageMs: 1000 });

        callPrivate(pool, "evictLRU");

        assert.equal(bg.stopped, false, "更老但 bg-active 不应被淘汰");
        assert.equal(plain.stopped, true);
        assert.equal(pool.has("plain"), false);
    });

    it("evictLRU falls back to an in-use (non-bg) instance but still spares bg-active", () => {
        const pool = makePool({ maxInstances: 2 });
        const bg = mockSandbox(true);
        const busy = mockSandbox(false);
        inject(pool, "bg", bg, { ageMs: 9999 });
        inject(pool, "busy", busy, { inUse: true, ageMs: 1000 });

        callPrivate(pool, "evictLRU"); // 无空闲非 bg → 退而淘汰使用中的 non-bg

        assert.equal(bg.stopped, false);
        assert.equal(busy.stopped, true);
    });

    it("evictIdle skips bg-active instances", () => {
        const pool = makePool();
        const bg = mockSandbox(true);
        const plain = mockSandbox(false);
        inject(pool, "bg", bg);
        inject(pool, "plain", plain);

        const n = pool.evictIdle();

        assert.equal(n, 1);
        assert.equal(bg.stopped, false, "技能热重载也不能 kill 后台命令实例");
        assert.equal(pool.has("bg"), true);
        assert.equal(plain.stopped, true);
    });

    it("invalidateSkills spares bg-active instances and marks them stale for later replacement", () => {
        const pool = makePool();
        const bg = mockSandbox(true);
        const plain = mockSandbox(false);
        inject(pool, "bg", bg, { skillGeneration: 0 });
        inject(pool, "plain", plain, { skillGeneration: 0 });

        pool.invalidateSkills();

        assert.equal(plain.stopped, true, "空闲非 bg 实例应在热重载时回收");
        assert.equal(bg.stopped, false, "有后台命令的实例不能被热重载杀掉");
        assert.equal(pool.has("bg"), true);
        // generation 已自增，bg 实例标记为过期（skillGen 0 < 1），待后台结束后下次 acquire 替换
        const gen = (pool as unknown as { _skillGeneration: number })._skillGeneration;
        assert.equal(gen, 1);
    });

    it("acquire reuses a stale-skill sandbox instead of stopping it while bg work runs", async () => {
        const pool = makePool();
        const bg = mockSandbox(true);
        // skillGeneration -1 < 默认 _skillGeneration 0 → 视为过期
        inject(pool, "chat", bg, { skillGeneration: -1 });

        const got = await pool.acquire("chat");

        assert.equal(got as unknown as MockSandbox, bg, "应复用而非重建");
        assert.equal(bg.stopped, false, "skill 过期但有后台命令在跑时不得 stop");
        assert.equal(pool.has("chat"), true);
    });
});
