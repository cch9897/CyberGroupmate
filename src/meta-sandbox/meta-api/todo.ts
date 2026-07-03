import type { MemoryStoreV2 } from "../../memory-v2/index.js";
import { resolveTodoDueAt } from "../../core/todo-expiry.js";

type TodoMemory = Pick<MemoryStoreV2,
    "todoList" |
    "todoGet" |
    "todoUpsert" |
    "todoRemove" |
    "listGroupModels"
>;

export interface TodoSetInput {
    key: string;
    content: string;
    bindingId: string;
    dueAt?: string | number | Date | null;
    forever?: boolean;
}

export interface TodoUpdateInput {
    key?: string;
    content?: string;
    bindingId?: string;
    dueAt?: string | number | Date | null;
    forever?: boolean;
}

export interface TodoListInput {
    bindingId?: string;
    includeExpired?: boolean;
}

export function createTodoApi(memory: TodoMemory) {
    return {
        get: async (key: string, bindingId = "meta") => {
            return memory.todoGet(normalizeBindingId(bindingId), key);
        },
        list: async (options: TodoListInput = {}) => {
            const bindingIds = options.bindingId
                ? [normalizeBindingId(options.bindingId)]
                : uniqueStrings(["meta", ...memory.listGroupModels().map((group) => group.chatId)]);
            return bindingIds.flatMap((bindingId) =>
                memory.todoList(bindingId, { includeExpired: options.includeExpired })
                    .map((item) => ({ ...item, bindingId }))
            );
        },
        set: async (input: TodoSetInput) => {
            const bindingId = requireBindingId(input.bindingId);
            const key = requireNonEmpty(input.key, "key");
            const content = requireNonEmpty(input.content, "content");
            return {
                bindingId,
                ...memory.todoUpsert(bindingId, key, content, resolveTodoDueAt(input)),
            };
        },
        update: async (key: string, input: TodoUpdateInput, bindingId: string) => {
            const currentBindingId = requireBindingId(bindingId);
            const currentKey = requireNonEmpty(key, "key");
            const existing = memory.todoGet(currentBindingId, currentKey);
            if (!existing) return null;

            const nextBindingId = input.bindingId != null
                ? requireBindingId(input.bindingId)
                : currentBindingId;
            const nextKey = input.key != null
                ? requireNonEmpty(input.key, "key")
                : currentKey;
            const nextContent = input.content != null
                ? requireNonEmpty(input.content, "content")
                : existing.content;
            const nextDueAt = resolveTodoDueAt(input);

            if (nextBindingId !== currentBindingId || nextKey !== currentKey) {
                memory.todoRemove(currentBindingId, currentKey);
            }

            return {
                bindingId: nextBindingId,
                ...memory.todoUpsert(nextBindingId, nextKey, nextContent, nextDueAt),
            };
        },
        delete: async (key: string, bindingId = "meta") => {
            memory.todoRemove(normalizeBindingId(bindingId), key);
        },
    };
}

function normalizeBindingId(bindingId?: string): string {
    const value = bindingId?.trim();
    return value && value.length > 0 ? value : "meta";
}

function requireBindingId(bindingId?: string): string {
    const value = bindingId?.trim();
    if (!value) {
        throw new Error("bindingId 不能为空：只有真正全局事项才显式使用 bindingId='meta'，群/子 agent 规则必须绑定到对应 chatId");
    }
    return value;
}

function requireNonEmpty(value: string, fieldName: string): string {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) {
        throw new Error(`${fieldName} 不能为空`);
    }
    return trimmed;
}

function uniqueStrings(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
