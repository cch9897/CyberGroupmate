/**
 * modules/dispatch.ts — Subagent 任务派发模块
 *
 * 通过 Host 侧 dispatch API 给其他 Subagent 派任务。quote 解析由 Host 统一处理；
 * sandbox 只负责把本地 @output[n] 引用展开成 literal quote。
 */

export interface DispatchCallbacks {
    callHost: (method: string, args?: unknown[]) => Promise<unknown>;
    getOutput: (index: number) => SandboxQuoteOutput | null;
}

export interface SandboxQuoteOutput {
    index: number;
    output: string;
    error: boolean;
    timestamp: string;
    source: "subagent";
}

export interface DispatchTrackingSpec {
    key?: string;
    content: string;
    remindAfterMinutes?: number;
    callback?: string;
    data?: unknown;
}

export interface DispatchTaskSpec {
    contentDirection: string;
    toneGuidance?: string;
    suggestedEmojis?: string[];
    quotes?: string[];
    useSkills?: string[];
    tracking?: DispatchTrackingSpec;
}

let _callbacks: DispatchCallbacks | null = null;

export function setDispatchCallbacks(callbacks: DispatchCallbacks): void {
    _callbacks = callbacks;
}

const OUTPUT_REF_RE = /@output\[(\d+)\]/g;

export const dispatchModule = {
    taskToGroup: async (chatId: string, taskSpec: DispatchTaskSpec): Promise<{
        taskId: string;
        trackingKey?: string;
        reminderId?: string;
    }> => {
        if (!_callbacks) throw new Error("Dispatch module not initialized");
        const result = await _callbacks.callHost("dispatch.taskToGroup", [
            chatId,
            hydrateOutputQuotes(taskSpec),
        ]);
        return result as { taskId: string; trackingKey?: string; reminderId?: string };
    },

    getTask: async (taskId: string): Promise<Record<string, unknown> | null> => {
        if (!_callbacks) throw new Error("Dispatch module not initialized");
        const result = await _callbacks.callHost("dispatch.getTask", [taskId]);
        return (result as Record<string, unknown> | null) ?? null;
    },

    listTasks: async (options?: {
        chatId?: string;
        status?: string;
        limit?: number;
        offset?: number;
    }): Promise<{ tasks: Array<Record<string, unknown>>; total: number; hasMore: boolean }> => {
        if (!_callbacks) throw new Error("Dispatch module not initialized");
        const result = await _callbacks.callHost("dispatch.listTasks", [options]);
        return result as { tasks: Array<Record<string, unknown>>; total: number; hasMore: boolean };
    },
};

function hydrateOutputQuotes(taskSpec: DispatchTaskSpec): DispatchTaskSpec {
    if (!taskSpec || typeof taskSpec !== "object") {
        return taskSpec;
    }

    const extraQuotes: string[] = [];
    const clone: DispatchTaskSpec = {
        ...taskSpec,
        quotes: taskSpec.quotes ? [...taskSpec.quotes] : undefined,
    };

    clone.contentDirection = replaceOutputRefs(clone.contentDirection, extraQuotes);
    if (clone.toneGuidance) {
        clone.toneGuidance = replaceOutputRefs(clone.toneGuidance, extraQuotes);
    }

    if (clone.quotes?.length) {
        const rewrittenQuotes: string[] = [];
        for (const quote of clone.quotes) {
            const stripped = quote.replace(OUTPUT_REF_RE, "").trim();
            const rewritten = replaceOutputRefs(quote, extraQuotes).trim();
            if (stripped.length > 0 && rewritten.length > 0) {
                rewrittenQuotes.push(rewritten);
            }
        }
        clone.quotes = rewrittenQuotes;
    }

    if (extraQuotes.length > 0) {
        clone.quotes = [...(clone.quotes ?? []), ...extraQuotes];
    }

    return clone;
}

function replaceOutputRefs(text: string, extraQuotes: string[]): string {
    if (!text) return text;
    return text.replace(OUTPUT_REF_RE, (_raw, indexText: string) => {
        const index = Number.parseInt(indexText, 10);
        const quote = buildOutputLiteralQuote(index);
        if (quote) {
            extraQuotes.push(quote);
            return `[output#${index} 已作为 quote 附带]`;
        }
        return `[output#${index} 不可用]`;
    });
}

function buildOutputLiteralQuote(index: number): string | null {
    const output = _callbacks?.getOutput(index);
    if (!output) return null;
    return [
        `Execution Output #${index}${output.error ? " (error)" : ""}`,
        `timestamp: ${output.timestamp}`,
        `source: ${output.source}`,
        "```text",
        output.output,
        "```",
    ].join("\n");
}
