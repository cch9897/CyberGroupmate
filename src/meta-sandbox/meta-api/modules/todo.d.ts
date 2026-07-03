/**
 * todo — Meta 跨会话/跨绑定 Todo API。
 *
 * 可用于记录跨群跟进事项。bindingId 必填：可以是 composite chatId，也可以是 "meta"。
 * 只有真正全局编排事项才使用 "meta"；群规/子 agent 规则应绑定到对应 chatId。
 * 未传 dueAt 时默认 30 天后过期；每次 set/update 都会刷新默认过期时间。
 * 永久规则必须显式设置 forever: true。
 */

interface MetaTodoSetInput {
    key: string;
    content: string;
    bindingId: string;
    /** Unix epoch milliseconds. Omit for the default 30-day rolling expiry. */
    dueAt?: number;
    /** Explicitly make this todo permanent. */
    forever?: boolean;
}

interface MetaTodoUpdateInput {
    key?: string;
    content?: string;
    bindingId?: string;
    /** Unix epoch milliseconds. Omit for the default 30-day rolling expiry. */
    dueAt?: number;
    /** Explicitly make this todo permanent. */
    forever?: boolean;
}

interface MetaTodoListInput {
    bindingId?: string;
    includeExpired?: boolean;
}

interface MetaTodoItem {
    bindingId: string;
    key: string;
    content: string;
    /** Unix epoch milliseconds. */
    dueAt?: number | null;
    /** Unix epoch milliseconds. */
    createdAt: number;
    /** Unix epoch milliseconds. */
    updatedAt: number;
    expired: boolean;
}

declare const todo: {
    /**
     * 新增或更新一个 Meta Todo。
     *
     * @param input Todo key、content、必填 bindingId 和可选 dueAt/forever。
     * @returns 写入后的 Todo。
     * @example
     * await todo.set({
     *   key: "pending_crossgroup_reply",
     *   content: "检查 C 群 API 网关跨群回复是否需要继续跟进",
     *   bindingId: "telegram:-1001111111111"
     * });
     */
    set(input: MetaTodoSetInput): Promise<MetaTodoItem>;

    /**
     * 编辑一个已有 Todo；可同时改 key、content、bindingId 和 dueAt/forever。
     * 未传 dueAt 且 forever 不为 true 时，会刷新为 30 天后过期。
     *
     * @param key 当前 Todo key。
     * @param input 要修改的字段。
     * @param bindingId 当前 composite chatId 或 "meta"。
     * @returns 更新后的 Todo；不存在时返回 null。
     */
    update(key: string, input: MetaTodoUpdateInput, bindingId: string): Promise<MetaTodoItem | null>;

    /**
     * 获取一个 Todo。
     *
     * @param key Todo key。
     * @param bindingId composite chatId 或 "meta"，默认 "meta"。
     * @returns 找到的 Todo；不存在时返回 null。
     */
    get(key: string, bindingId?: string): Promise<Omit<MetaTodoItem, "bindingId"> | null>;

    /**
     * 列出 Todo。未传 bindingId 时会列出 meta 和所有群绑定的 Todo。
     *
     * @param options 可选 bindingId 和 includeExpired。
     * @returns Todo 列表。
     */
    list(options?: MetaTodoListInput): Promise<MetaTodoItem[]>;

    /**
     * 删除一个 Todo。
     *
     * @param key Todo key。
     * @param bindingId composite chatId 或 "meta"，默认 "meta"。
     */
    delete(key: string, bindingId?: string): Promise<void>;
};
