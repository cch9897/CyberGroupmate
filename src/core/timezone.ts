/**
 * timezone.ts — 全局时区工具
 *
 * 存储层始终使用 UTC（Date.toISOString()）。
 * 本模块仅在"渲染给 LLM 看"的 prompt 拼接处提供本地化时间格式。
 */

let _globalTimezone: string | undefined;

/**
 * 设置全局时区（启动时由 main.ts 调用一次）。
 * 同时设置 process.env.TZ，使 Date 的本地时间方法（getHours 等）
 * 统一使用配置时区，确保 cron 匹配、remind 触发等均基于该时区。
 * @param tz - IANA 时区标识符，例如 "Asia/Shanghai"
 */
export function setGlobalTimezone(tz: string | undefined): void {
    _globalTimezone = tz;
    if (tz) {
        process.env.TZ = tz;
    }
}

/**
 * 获取全局时区
 * @returns IANA 时区标识符，未设置时返回 undefined（将 fallback 到系统时区）
 */
export function getGlobalTimezone(): string | undefined {
    return _globalTimezone;
}

/**
 * 将 UTC ISO 时间戳格式化为带时区偏移的人类可读字符串
 *
 * 用于拼入 LLM prompt，让模型看到的时间与 agent "生活"的时区一致。
 *
 * @param isoUtc - UTC ISO 8601 时间戳，如 "2026-03-18T01:05:13.000Z"
 * @param tz - 可选，覆盖全局时区
 * @returns 格式如 "2026-03-18 09:05:13 +08:00"，输入为空/无效时原样返回
 */
export function formatTsForDisplay(isoUtc: string | undefined | null, tz?: string): string {
    if (!isoUtc) return "";
    try {
        const date = new Date(isoUtc);
        if (isNaN(date.getTime())) return isoUtc;

        const timezone = tz ?? _globalTimezone;
        // 使用 Intl.DateTimeFormat 获取各字段
        const fmt = new Intl.DateTimeFormat("sv-SE", {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        });
        const parts = fmt.formatToParts(date);
        const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
        const dateStr = `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;

        // 计算 UTC 偏移
        const offset = getUtcOffset(date, timezone);

        return `${dateStr} ${offset}`;
    } catch {
        // 解析失败时原样返回
        return isoUtc;
    }
}

/**
 * 返回配置时区下「现在」是星期几，如 "星期五"。
 * @param tz - 可选，覆盖全局时区；缺省用全局时区，再缺省 fallback 到系统时区
 * @param reference - 可选，覆盖参考时刻（默认当前时间），便于测试
 */
export function getWeekdayLabel(tz?: string, reference: Date = new Date()): string {
    try {
        return new Intl.DateTimeFormat("zh-CN", {
            timeZone: tz ?? _globalTimezone,
            weekday: "long",
        }).format(reference);
    } catch {
        return "";
    }
}

/**
 * Convert any supported timestamp value to Unix epoch milliseconds.
 */
export function toUnixTimestampMs(value: string | number | Date | null | undefined): number | null {
    if (value == null || value === "") return null;
    if (typeof value === "number") {
        return Number.isFinite(value) ? Math.trunc(value) : null;
    }
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isNaN(time) ? null : time;
    }

    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
        const numeric = Number(trimmed);
        return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
    }

    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
}

/** Format a timestamp for programmatic prompt/API fields as Unix epoch milliseconds. */
export function formatTsForTimestamp(value: string | number | Date | null | undefined): string {
    const ts = toUnixTimestampMs(value);
    return ts == null ? "" : String(ts);
}

/** Format a timestamp for narrative prompt text in the configured timezone. */
export function formatTsForPrompt(
    value: string | number | Date | null | undefined,
    reference: string | number | Date = new Date(),
    tz?: string,
): string {
    const targetMs = toUnixTimestampMs(value);
    if (targetMs == null) return "";
    const referenceMs = toUnixTimestampMs(reference) ?? Date.now();
    const timezone = tz ?? _globalTimezone;
    const target = getLocalParts(new Date(targetMs), timezone);
    const ref = getLocalParts(new Date(referenceMs), timezone);
    if (!target || !ref) {
        return formatTsForTimestamp(targetMs);
    }

    const time = `${target.hour}:${target.minute}`;
    if (target.year === ref.year && target.month === ref.month && target.day === ref.day) {
        return time;
    }
    if (target.year === ref.year) {
        return `${Number(target.month)}月${Number(target.day)}日 ${time}`;
    }
    return `${target.year}年${Number(target.month)}月${Number(target.day)}日 ${time}`;
}

const ISO_TIMESTAMP_RE = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})\b/g;
const OFFSET_TIMESTAMP_RE = /\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}\s+[+-]\d{2}:?\d{2}\b/g;
const PROGRAMMATIC_TIME_FIELD_RE = /((?:["']?(?:createdAt|updatedAt|completedAt|timestamp|dueAt|observedAt|startedAt|endedAt|lastActiveAt|lastAttendedAt|snapshotTimestamp|triggerAt|expiresAt|registeredAt|lastTriggeredAt|savedAt|enqueuedAt|mtime|created_at|updated_at|completed_at|observed_at|started_at|ended_at|last_seen_at|first_seen_at)["']?)\s*:\s*)["'](\d{4}-\d{2}-\d{2}(?:T| )\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2}|\s+[+-]\d{2}:?\d{2}))["']/g;
const PROGRAMMATIC_TIME_KEYS = new Set([
    "createdAt",
    "updatedAt",
    "completedAt",
    "timestamp",
    "dueAt",
    "observedAt",
    "startedAt",
    "endedAt",
    "lastActiveAt",
    "lastAttendedAt",
    "snapshotTimestamp",
    "triggerAt",
    "expiresAt",
    "registeredAt",
    "lastTriggeredAt",
    "savedAt",
    "enqueuedAt",
    "mtime",
    "created_at",
    "updated_at",
    "completed_at",
    "observed_at",
    "started_at",
    "ended_at",
    "last_seen_at",
    "first_seen_at",
]);

export type PromptTimestampSanitizeMode = "natural" | "timestamp";

/**
 * Best-effort sanitizer for old session history that may already contain ISO
 * timestamps. Programmatic-looking time fields are normalized to epoch ms;
 * remaining prose timestamps are rendered as local natural-language time.
 */
export function sanitizePromptTimestamps(text: string, mode: PromptTimestampSanitizeMode = "natural"): string {
    const format = mode === "timestamp" ? formatTsForTimestamp : formatTsForPrompt;
    return text
        .replace(PROGRAMMATIC_TIME_FIELD_RE, (match, prefix: string, timestamp: string) => {
            const formatted = formatTsForTimestamp(timestamp);
            return formatted ? `${prefix}${formatted}` : match;
        })
        .replace(ISO_TIMESTAMP_RE, (match) => format(match) || match)
        .replace(OFFSET_TIMESTAMP_RE, (match) => format(match) || match);
}

export function normalizeProgrammaticTimestamps<T>(value: T): T {
    return normalizeProgrammaticTimestampsInner(value, new WeakMap()) as T;
}

export function timestampInputToIso(value: string | number | Date | null | undefined): string | null | undefined {
    if (value == null || value === "") return value == null ? value : null;
    const ms = toUnixTimestampMs(value);
    return ms == null ? String(value) : new Date(ms).toISOString();
}

function normalizeProgrammaticTimestampsInner(value: unknown, seen: WeakMap<object, unknown>): unknown {
    if (value == null || typeof value !== "object") {
        return value;
    }
    if (value instanceof Date) {
        return value.getTime();
    }
    if (seen.has(value)) {
        return seen.get(value);
    }
    if (Array.isArray(value)) {
        const out: unknown[] = [];
        seen.set(value, out);
        for (const item of value) {
            out.push(normalizeProgrammaticTimestampsInner(item, seen));
        }
        return out;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        return value;
    }

    const out: Record<string, unknown> = {};
    seen.set(value, out);
    for (const [key, child] of Object.entries(value)) {
        if (PROGRAMMATIC_TIME_KEYS.has(key)) {
            const timestamp = toUnixTimestampMs(child as string | number | Date | null | undefined);
            out[key] = timestamp ?? child;
        } else {
            out[key] = normalizeProgrammaticTimestampsInner(child, seen);
        }
    }
    return out;
}

function getLocalParts(date: Date, tz?: string): {
    year: string;
    month: string;
    day: string;
    hour: string;
    minute: string;
} | null {
    try {
        const fmt = new Intl.DateTimeFormat("zh-CN", {
            timeZone: tz,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        });
        const parts = fmt.formatToParts(date);
        const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
        return {
            year: get("year"),
            month: get("month"),
            day: get("day"),
            hour: get("hour"),
            minute: get("minute"),
        };
    } catch {
        return null;
    }
}

/**
 * 计算指定时区在给定时刻的 UTC 偏移量字符串
 * @returns 如 "+08:00" 或 "-05:00"
 */
function getUtcOffset(date: Date, tz?: string): string {
    try {
        // 利用 Intl 格式化 UTC 和目标时区，算差值
        const utcParts = new Intl.DateTimeFormat("en-US", {
            timeZone: "UTC",
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit",
            hour12: false,
        }).formatToParts(date);
        const localParts = new Intl.DateTimeFormat("en-US", {
            timeZone: tz,
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit",
            hour12: false,
        }).formatToParts(date);

        const toMinutes = (p: Intl.DateTimeFormatPart[]) => {
            const get = (type: string) => parseInt(p.find(x => x.type === type)?.value ?? "0", 10);
            return get("day") * 1440 + get("hour") * 60 + get("minute");
        };

        let diffMin = toMinutes(localParts) - toMinutes(utcParts);
        // 处理跨日
        if (diffMin > 720) diffMin -= 1440;
        if (diffMin < -720) diffMin += 1440;

        const sign = diffMin >= 0 ? "+" : "-";
        const absDiff = Math.abs(diffMin);
        const h = String(Math.floor(absDiff / 60)).padStart(2, "0");
        const m = String(absDiff % 60).padStart(2, "0");
        return `${sign}${h}:${m}`;
    } catch {
        return "+00:00";
    }
}
