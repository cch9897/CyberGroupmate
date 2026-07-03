/**
 * shared/todo.d.ts — 不只是代办，可以当你的记事本用。
 *
 * 用于持久化当前群的待办、规则和长期约定（比如群规、话语风格、被教导的/发现的事实性记忆）。
 * 数据按群隔离，可选设置到期时间。“定期、到期提醒”类请使用 remind 或者 cron 模块。
 * 未传 dueAt 时默认 30 天后过期；每次 upsert 都会刷新默认过期时间。永久规则必须显式设置 forever: true。
 */

interface TodoItem {
    key: string;
    content: string;
    /** Unix epoch milliseconds. */
    dueAt: number | null;
    /** Unix epoch milliseconds. */
    createdAt: number;
    /** Unix epoch milliseconds. */
    updatedAt: number;
    expired: boolean;
}

declare const todo: {
    /**
     * 列出当前群的 todo。
     * @param options.includeExpired 设为 true 时包含已过期条目
     * @example
     * const items = await todo.list();
     */
    list(options?: { includeExpired?: boolean }): Promise<TodoItem[]>;

    /**
     * 获取单个 todo。
     * @example
     * const rule = await todo.get("群规");
     */
    get(key: string): Promise<TodoItem | null>;

    /**
     * 新增或更新 todo。
     * @param key 逻辑键，同群内唯一
     * @param content 内容
     * @param options.dueAt 可选到期时间，Unix epoch milliseconds；不传则默认 30 天后过期
     * @param options.forever 显式设置为 true 时永久保留
     * @example
     * await todo.upsert("周五提醒", "提醒大家周五 8 点开黑", {
     *   dueAt: 1777046400000,
     * }); // 有到期时间，一般是阶段性的安排/规则。
     * 
     * await todo.upsert("大A昵称", "大A指的是Arc", { forever: true }); // 永久事实性记忆/规则
     */
    upsert(key: string, content: string, options?: { dueAt?: number | null; forever?: boolean }): Promise<TodoItem>;

    /**
     * 删除 todo。
     * @example
     * await todo.remove("过期安排");
     */
    remove(key: string): Promise<void>;
};
