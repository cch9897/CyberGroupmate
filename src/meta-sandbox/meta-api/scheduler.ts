import { validateCronMinInterval } from "../../core/cron-matcher.js";
import { timestampInputToIso } from "../../core/timezone.js";
import type { GlobalState } from "../../main-agent/global-state.js";
import type { SchedulerEvent } from "../../subagent/types.js";

type SchedulerState = Pick<GlobalState,
    "addReminder" |
    "addCron" |
    "getSchedulerEvents" |
    "cancelSchedulerEvent" |
    "updateSchedulerEvent"
>;

export interface ReminderSetInput {
    name: string;
    callback: string;
    bindingId?: string;
    triggerAt?: string | number | Date;
    delayMinutes?: number;
    data?: unknown;
}

export interface ReminderUpdateInput {
    name?: string;
    callback?: string;
    bindingId?: string;
    triggerAt?: string | number | Date;
    delayMinutes?: number;
    data?: unknown;
}

export interface CronSetInput {
    name: string;
    cronExpr: string;
    callback: string;
    bindingId?: string;
    data?: unknown;
}

export interface CronUpdateInput {
    name?: string;
    cronExpr?: string;
    callback?: string;
    bindingId?: string;
    data?: unknown;
}

export interface SchedulerListInput {
    bindingId?: string;
    includeTriggered?: boolean;
}

export function createReminderApi(globalState: SchedulerState) {
    return {
        get: async (id: string) => findEvent(globalState, id, "reminder"),
        list: async (options: SchedulerListInput = {}) =>
            listEvents(globalState, "reminder", options),
        set: async (input: ReminderSetInput) => {
            const bindingId = normalizeBindingId(input.bindingId);
            const callback = requireCallback(input.callback);
            const name = normalizeName(input.name, callback);
            const triggerAt = resolveTriggerAt(input);
            const event = globalState.addReminder(
                "__meta__",
                callback,
                triggerAt,
                "scheduler-api",
                {
                    bindingId,
                    name,
                    callback,
                    data: input.data,
                },
            );
            return normalizeEvent(event);
        },
        update: async (id: string, input: ReminderUpdateInput) => {
            const existing = globalState.getSchedulerEvents().find((event) => event.id === id && event.type === "reminder");
            if (!existing) return null;

            const patch: Partial<Omit<SchedulerEvent, "id" | "type" | "createdAt">> = {};
            if (input.bindingId != null) patch.bindingId = normalizeBindingId(input.bindingId);
            if (input.name != null) patch.name = normalizeName(input.name, existing.name ?? existing.description);
            if (input.callback != null) {
                const callback = requireCallback(input.callback);
                patch.description = callback;
                if (usesMetaSchedulerPath(existing)) {
                    patch.callback = callback;
                }
            }
            const triggerAt = resolveOptionalTriggerAt(input);
            if (triggerAt !== undefined) {
                patch.triggerAt = triggerAt;
                patch.triggered = false;
            }
            if (Object.prototype.hasOwnProperty.call(input, "data")) {
                patch.data = input.data;
            }

            const updated = globalState.updateSchedulerEvent(id, patch);
            return updated ? normalizeEvent(updated) : null;
        },
        delete: async (id: string) => {
            return globalState.cancelSchedulerEvent(id);
        },
    };
}

export function createCronApi(globalState: SchedulerState) {
    return {
        get: async (id: string) => findEvent(globalState, id, "cron"),
        list: async (options: SchedulerListInput = {}) =>
            listEvents(globalState, "cron", options),
        set: async (input: CronSetInput) => {
            const bindingId = normalizeBindingId(input.bindingId);
            const callback = requireCallback(input.callback);
            const name = normalizeName(input.name, callback);
            if (!validateCronMinInterval(input.cronExpr, 60)) {
                throw new Error("cron 最短触发间隔为 1 小时");
            }
            const duplicate = globalState.getSchedulerEvents()
                .find((event) =>
                    event.type === "cron"
                    && (event.bindingId ?? event.chatId) === bindingId
                    && event.cronExpr === input.cronExpr
                    && (event.callback ?? event.taskTemplate ?? event.description) === callback
                );
            if (duplicate) {
                throw new Error(`已存在完全相同的 cron: ${duplicate.id}`);
            }
            const event = globalState.addCron(
                "__meta__",
                name,
                input.cronExpr,
                callback,
                {
                    bindingId,
                    name,
                    callback,
                    data: input.data,
                },
            );
            return normalizeEvent(event);
        },
        update: async (id: string, input: CronUpdateInput) => {
            const existing = globalState.getSchedulerEvents().find((event) => event.id === id && event.type === "cron");
            if (!existing) return null;

            const nextBindingId = input.bindingId != null
                ? normalizeBindingId(input.bindingId)
                : normalizeBindingId(existing.bindingId ?? (existing.chatId === "__meta__" ? "meta" : existing.chatId));
            const nextCronExpr = input.cronExpr != null ? input.cronExpr.trim() : existing.cronExpr;
            const nextCallback = input.callback != null
                ? requireCallback(input.callback)
                : (existing.callback ?? existing.taskTemplate ?? existing.description);
            if (input.cronExpr != null && (!nextCronExpr || !validateCronMinInterval(nextCronExpr, 60))) {
                throw new Error("cron 最短触发间隔为 1 小时");
            }

            if (nextCronExpr && (input.bindingId != null || input.cronExpr != null || input.callback != null)) {
                const duplicate = globalState.getSchedulerEvents()
                    .find((event) =>
                        event.id !== id
                        && event.type === "cron"
                        && (event.bindingId ?? event.chatId) === nextBindingId
                        && event.cronExpr === nextCronExpr
                        && (event.callback ?? event.taskTemplate ?? event.description) === nextCallback
                    );
                if (duplicate) {
                    throw new Error(`已存在完全相同的 cron: ${duplicate.id}`);
                }
            }

            const patch: Partial<Omit<SchedulerEvent, "id" | "type" | "createdAt">> = {};
            if (input.bindingId != null) patch.bindingId = nextBindingId;
            if (input.cronExpr != null) patch.cronExpr = nextCronExpr;
            if (input.name != null) {
                const name = normalizeName(input.name, existing.name ?? existing.description);
                patch.name = name;
                patch.description = name;
            }
            if (input.callback != null) {
                patch.taskTemplate = nextCallback;
                if (usesMetaSchedulerPath(existing)) {
                    patch.callback = nextCallback;
                }
            }
            if (input.cronExpr != null && input.cronExpr.trim() !== existing.cronExpr) {
                patch.lastTriggeredAt = undefined;
            }
            if (Object.prototype.hasOwnProperty.call(input, "data")) {
                patch.data = input.data;
            }

            const updated = globalState.updateSchedulerEvent(id, patch);
            return updated ? normalizeEvent(updated) : null;
        },
        delete: async (id: string) => {
            return globalState.cancelSchedulerEvent(id);
        },
    };
}

function resolveTriggerAt(input: ReminderSetInput): string {
    if (input.triggerAt) {
        const triggerAt = timestampInputToIso(input.triggerAt);
        if (!triggerAt) {
            throw new Error(`Invalid triggerAt: ${input.triggerAt}`);
        }
        return triggerAt;
    }
    if (typeof input.delayMinutes !== "number") {
        throw new Error("remind.set 需要 triggerAt 或 delayMinutes");
    }
    if (input.delayMinutes < 1) {
        throw new Error("remind 最短 1 分钟");
    }
    if (input.delayMinutes > 525600) {
        throw new Error("remind 最长 365 天（525600 分钟）");
    }
    return new Date(Date.now() + input.delayMinutes * 60_000).toISOString();
}

function resolveOptionalTriggerAt(input: ReminderUpdateInput): string | undefined {
    if (Object.prototype.hasOwnProperty.call(input, "triggerAt")) {
        const triggerAt = timestampInputToIso(input.triggerAt);
        if (!triggerAt) {
            throw new Error(`Invalid triggerAt: ${input.triggerAt}`);
        }
        return triggerAt;
    }
    if (Object.prototype.hasOwnProperty.call(input, "delayMinutes")) {
        if (typeof input.delayMinutes !== "number") {
            throw new Error("delayMinutes 必须是数字");
        }
        if (input.delayMinutes < 1) {
            throw new Error("remind 最短 1 分钟");
        }
        if (input.delayMinutes > 525600) {
            throw new Error("remind 最长 365 天（525600 分钟）");
        }
        return new Date(Date.now() + input.delayMinutes * 60_000).toISOString();
    }
    return undefined;
}

function requireCallback(callback: string): string {
    const trimmed = String(callback ?? "").trim();
    if (!trimmed) {
        throw new Error("callback 不能为空：必须写清楚被唤醒后要做什么");
    }
    return trimmed;
}

function normalizeName(name: string, fallback: string): string {
    const trimmed = String(name ?? "").trim();
    return trimmed || fallback.slice(0, 60);
}

function usesMetaSchedulerPath(event: SchedulerEvent): boolean {
    return event.chatId === "__meta__" || !!event.bindingId || event.callback != null;
}

function findEvent(globalState: SchedulerState, id: string, type: SchedulerEvent["type"]) {
    const event = globalState.getSchedulerEvents().find((item) => item.id === id && item.type === type);
    return event ? normalizeEvent(event) : null;
}

function listEvents(globalState: SchedulerState, type: SchedulerEvent["type"], options: SchedulerListInput) {
    return globalState.getSchedulerEvents()
        .filter((event) => event.type === type)
        .filter((event) => !options.bindingId || (event.bindingId ?? event.chatId) === normalizeBindingId(options.bindingId))
        .filter((event) => options.includeTriggered || !event.triggered)
        .map(normalizeEvent);
}

function normalizeEvent(event: SchedulerEvent) {
    const callback = event.callback ?? event.taskTemplate ?? event.description;
    const bindingId = normalizeBindingId(event.bindingId ?? (event.chatId === "__meta__" ? "meta" : event.chatId));
    return {
        id: event.id,
        type: event.type,
        bindingId,
        name: event.name ?? event.description,
        callback,
        data: event.data,
        triggerAt: event.triggerAt,
        cronExpr: event.cronExpr,
        createdAt: event.createdAt,
        triggered: event.triggered,
        lastTriggeredAt: event.lastTriggeredAt,
    };
}

function normalizeBindingId(bindingId?: string): string {
    const value = bindingId?.trim();
    return value && value.length > 0 ? value : "meta";
}
