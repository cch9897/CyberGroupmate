/**
 * dispatch.d.ts — Subagent 任务派发 API
 *
 * 当前 Subagent 可以把任务派发给另一个群/私聊绑定的 Subagent。
 * 派发后目标 Subagent 会收到同一套 quote 解析后的任务上下文。
 */

interface DispatchTrackingSpec {
    /** 默认 dispatch:<taskId>。 */
    key?: string;
    /** 待跟进内容。 */
    content: string;
    /** 若设置，则自动注册一次性唤醒给 Meta 做后续检查。 */
    remindAfterMinutes?: number;
    /** reminder 唤醒后给 Meta 的明确动作。 */
    callback?: string;
    /** 附带结构化数据。 */
    data?: unknown;
}

interface DispatchTaskSpec {
    /** 必填：行动方向，告诉目标 Subagent 往哪个方向回复或互动。 */
    contentDirection: string;
    /** 语气指导，如轻松、正式、简短等。 */
    toneGuidance?: string;
    /** 建议用于召回可发送贴纸的 emoji 候选，如 ["😂", "🤣", "😅"]。 */
    suggestedEmojis?: string[];
    /**
     * 需要随任务携带的 quote 引用。也可以直接写在 contentDirection / toneGuidance 中。
     *
     * 框架会解析内部 quote：
     * - @telegram:-100123[10-20] / @discord:guild:channel[10-20] / @onebot:group:123[10-20]
     * - @telegram:-100123 / @discord:guild:channel / @onebot:group:123
     * - @person[张三] 或 @person[张三 in telegram:-100123]
     * - @history[关键词] / @topic[topicId]
     * - @output[0]（Subagent 侧会展开为本 session 之前的执行结果 literal quote）
     * - @[workspace/xxx.md]
     *
     * 其他 @[...] 会作为 literal string 传递，不抓取、不清洗、不联网。
     */
    quotes?: string[];
    /** 需要目标 Subagent 额外加载的 Skill 模块名。基础模块不需要重复填写。 */
    useSkills?: string[];
    /** 派发后自动记录待跟进 todo / remind。 */
    tracking?: DispatchTrackingSpec;
}

interface DispatchTaskResult {
    taskId: string;
    trackingKey?: string;
    reminderId?: string;
}

interface DispatchedTaskStatus {
    taskId: string;
    chatId: string;
    contentDirection: string;
    toneGuidance?: string;
    quotes?: string[];
    quoteWarnings?: string[];
    status: "PENDING" | "RUNNING" | "COMPLETED" | "ERROR" | "SKIPPED" | "TIMEOUT";
    /** Unix epoch milliseconds. */
    createdAt: number;
    /** Unix epoch milliseconds. */
    updatedAt: number;
    /** Unix epoch milliseconds. */
    completedAt?: number;
    sessionId?: string;
    summary?: string;
    sentMessages?: Array<{ messageId?: string; text: string; timestamp: number }>;
    error?: string;
}

declare const dispatch: {
    /**
     * 向指定群组派发一个任务，由目标群的 Subagent 执行回复、reaction 或其他群内行动。
     *
     * chatId 必须使用 composite chatId，例如 "telegram:-1001234567890"。
     * 当前 Subagent 不能用 dispatch 给自己派任务；当前群内行动直接调用平台 API。
     * 不要使用已废弃的 context 字段；需要搬运材料时写 quotes 或 inline quote。
     *
     * @param chatId 目标 composite chatId。
     * @param taskSpec 任务方向、语气、quote、技能和跟踪信息。
     * @returns 派发任务 ID，以及可选的 trackingKey / reminderId。
     * @example
     * const task = await dispatch.taskToGroup("telegram:-1001111111111", {
     *   contentDirection: "把当前群的问题带到目标群请他们确认，保留来源边界",
     *   toneGuidance: "简短、礼貌，不要泄露不必要的上下文",
     *   quotes: ["@telegram:-1002222222222[100-106]", "@output[0]"],
     *   tracking: {
     *     content: "等待目标群确认后回到当前群同步",
     *     remindAfterMinutes: 15,
     *     callback: "检查目标群是否已回复；如有结论，再派回来源群。"
     *   }
     * });
     * console.log(task.taskId);
     */
    taskToGroup(chatId: string, taskSpec: DispatchTaskSpec): Promise<DispatchTaskResult>;

    /** 查询已派发任务的状态与执行结果；不存在时返回 null。 */
    getTask(taskId: string): Promise<DispatchedTaskStatus | null>;

    /** 列出已派发任务，可按 chatId/status 分页过滤。 */
    listTasks(options?: { chatId?: string; status?: string; limit?: number; offset?: number }): Promise<{
        tasks: DispatchedTaskStatus[];
        total: number;
        hasMore: boolean;
    }>;
};
