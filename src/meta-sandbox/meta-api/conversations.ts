import { getGroupModelKey, getPlatform } from "../../core/chat-id.js";
import { formatMessageBody } from "../../core/message-enricher.js";
import { loadConfig } from "../../core/config.js";
import { isChatBlockedByFilter } from "../../core/inbound-filter.js";
import { requireNonEmptyString } from "./params.js";
import type {
    GroupModel,
    IMemoryStoreV2,
    MessageSearchResult,
    RecentMessageEntry,
    PersonIdentity,
    TopicNode,
    TopicSearchResult,
} from "../../memory-v2/index.js";
import { timestampInputToIso } from "../../core/timezone.js";

export interface ConversationsQueryFilters {
    chatIds?: string[];
    /** 人名、别名、username 或 userId。 */
    user?: string;
    /** 精确 userId 过滤。自然语言调用优先用 user。 */
    userId?: string;
    /** 正文关键词。若 user 未传或未解析到，会先匹配 displayName，再匹配正文。 */
    keyword?: string;
    after?: string | number | Date;
    before?: string | number | Date;
    limit?: number;
}

export type ConversationMessageResult = MessageSearchResult & {
    chatTitle: string;
    /** 形如 "[早苗群(telegram:-100123)]"。 */
    chatLabel: string;
};

export type ConversationTopicResult = TopicSearchResult & {
    chatTitle: string;
    /** 形如 "[早苗群(telegram:-100123)]"。 */
    chatLabel: string;
};

export interface ResolvedConversationUser {
    userId: string;
    displayName: string;
    username?: string;
    aliases: string[];
}

export interface ConversationsQueryResult {
    messages: ConversationMessageResult[];
    topics: ConversationTopicResult[];
    resolvedUsers: ResolvedConversationUser[];
}

export interface ConversationsMessagesOptions {
    /** 返回条数，默认 50，最大 99。 */
    limit?: number;
    /** 上一页返回的游标；继续往更早消息滚动时原样传回。 */
    cursor?: string;
    /** Unix epoch milliseconds；cursor 未传时生效。 */
    before?: string | number | Date;
    /** Unix epoch milliseconds. */
    after?: string | number | Date;
}

export interface ConversationsMessagesResult {
    chatId: string;
    chatTitle: string;
    /** 形如 "[早苗群(telegram:-100123)]"。 */
    chatLabel: string;
    messages: ConversationMessageResult[];
    nextCursor?: string;
}

export interface ConversationsInboxOptions {
    /** 返回条数，默认 20，最大 100。 */
    limit?: number;
    /** 上一页返回的游标；不需要理解其内容，原样传回即可。 */
    cursor?: string;
    /** 未读聊天置顶，默认 true。 */
    unreadFirst?: boolean;
    /** 限定聊天 ID。 */
    chatIds?: string[];
    /** 是否包含没有消息的已知聊天，默认 false。 */
    includeEmpty?: boolean;
}

export interface ConversationInboxMessage {
    mentions?: MessageSearchResult["mentions"];
    replyToMessageId?: string;
    messageId: string;
    chatId: string;
    userId: string;
    displayName: string;
    content: string;
    timestamp: string;
}

export interface ConversationInboxItem {
    chatId: string;
    platform?: string;
    chatTitle: string;
    /** 形如 "[早苗群(telegram:-100123)]"。 */
    chatLabel: string;
    isDirectMessage?: boolean;
    latestMessage?: ConversationInboxMessage;
    /** latestMessage 晚于 lastAttendedAt，或从未 attend 但已有消息。 */
    unread: boolean;
    /** 最多精确到最近 100 条；运行中 observer buffer 可提供更即时的值。 */
    unreadCount: number;
    lastAttendedAt: string | null;
    lastActiveAt?: string;
    queueSize: number;
    isProcessing: boolean;
    stickinessLevel: string;
}

export interface ConversationsInboxResult {
    items: ConversationInboxItem[];
    total: number;
    unreadTotal: number;
    nextCursor?: string;
}

type ConversationsReader = Pick<IMemoryStoreV2,
    "queryMessages" |
    "searchTopics" |
    "getRecentMessages" |
    "getRecentTopics" |
    "getGroupModel" |
    "searchByAlias" |
    "getPersonIdentity" |
    "listGroupModels" |
    "getStickerDescription"
>;

type ExecutorReader = {
    getQueueSize?: () => number;
    isProcessing?: () => boolean;
};

type ObserverReader = {
    getBufferSize?: () => number;
};

type SubagentReader = {
    chatId: string;
    lastActivityAt?: number;
    lastAttendedAt?: string | null;
    stickiness?: {
        level?: string;
    };
    codeActExecutor?: unknown;
    observer?: ObserverReader;
};

type SubagentManagerReader = {
    getAllSubagents: () => unknown[];
};

export interface ConversationsApiOptions {
    /**
     * chat_filter 读侧闸口：返回 false 的会话整体隐藏（inbox 剔除、messages 拒绝、query 过滤）。
     * 默认每次调用读取 `loadConfig().chatFilter`，因此 Dashboard 放行并 saveConfig 后立即生效。
     * 单元测试可注入固定谓词，避免隐式依赖仓库 config.yaml。
     */
    isChatAllowed?: (chatId: string) => boolean;
}

export function createConversationsApi(
    memory: ConversationsReader,
    subagentManager?: SubagentManagerReader,
    apiOptions: ConversationsApiOptions = {},
) {
    const isChatAllowed = apiOptions.isChatAllowed
        ?? ((chatId: string) => !isChatBlockedByFilter(loadConfig().chatFilter, chatId));

    return {
        inbox: async (options: ConversationsInboxOptions = {}): Promise<ConversationsInboxResult> => {
            const limit = clampLimit(options.limit, 20, 100);
            const offset = decodeInboxCursor(options.cursor);
            const includeEmpty = options.includeEmpty ?? false;
            const unreadFirst = options.unreadFirst ?? true;
            const allowedChatIds = uniqueStrings(options.chatIds);
            const allowed = allowedChatIds.length > 0 ? new Set(allowedChatIds) : null;

            const subagents = getSubagents(subagentManager);
            const subagentByChatId = new Map(subagents.map((subagent) => [subagent.chatId, subagent]));
            // chat_filter 读侧闸口：subagent 与 group_models 两个来源都必须剔除。
            // 不能依赖「latestMessage 为空」——被过滤会话在过滤生效前可能已有历史消息。
            const chatIds = collectInboxChatIds(memory, subagents, allowed)
                .filter((chatId) => isChatAllowed(chatId));

            const allItems = chatIds
                .map((chatId) => buildInboxItem(memory, chatId, subagentByChatId.get(chatId)))
                .filter((item) => includeEmpty || item.latestMessage)
                .sort(compareInboxItems(unreadFirst));
            const items = allItems.slice(offset, offset + limit);
            const nextOffset = offset + items.length;

            return {
                items,
                total: allItems.length,
                unreadTotal: allItems.filter((item) => item.unread).length,
                nextCursor: nextOffset < allItems.length ? encodeInboxCursor(nextOffset) : undefined,
            };
        },
        messages: async (chatId: string, options: ConversationsMessagesOptions = {}): Promise<ConversationsMessagesResult> => {
            requireNonEmptyString(
                chatId,
                "chatId",
                "形如 telegram:-1001234567890 / telegram:92604174，可先用 conversations.inbox() 查",
            );
            if (!isChatAllowed(chatId)) {
                throw new Error(`[chat_filter] conversations.messages 拒绝读取：chat=${chatId} 被 chat_filter 拦截。`);
            }
            const limit = clampLimit(options.limit, 50, 99);
            const before = timestampInputToIso(decodeMessageCursor(options.cursor) ?? options.before) ?? undefined;
            const after = timestampInputToIso(options.after) ?? undefined;
            const rows = enrichMessages(memory, queryMessagesWith(memory, {
                chatIds: [chatId],
                after,
                before,
                limit: limit + 1,
                includeBlocked: false,
            }));
            const messages = rows.slice(0, limit);
            const chatTitle = resolveChatTitle(memory, chatId);

            return {
                chatId,
                chatTitle,
                chatLabel: formatChatLabel(chatTitle, chatId),
                messages,
                nextCursor: rows.length > limit ? makeBeforeCursor(messages[messages.length - 1]?.timestamp) : undefined,
            };
        },
        query: async (filters: ConversationsQueryFilters = {}): Promise<ConversationsQueryResult> => {
            const normalizedFilters = normalizeFilters(filters);
            const limit = clampLimit(filters.limit, 20, 100);
            const requestedChatIds = uniqueStrings(filters.chatIds);
            // chat_filter 读侧闸口：显式限定的 blocked 会话直接剔除；若全部被剔除，
            // 必须返回空结果，而不是退化成「全局搜索」把别的会话内容带回来。
            const chatIds = requestedChatIds.filter((chatId) => isChatAllowed(chatId));
            const keyword = filters.keyword?.trim();
            const resolvedUsers = resolveUsers(memory, normalizedFilters, limit);
            const userIds = resolvedUsers.map((user) => user.userId);
            const fallbackName = filters.user && userIds.length === 0 ? filters.user.trim() : undefined;

            if (requestedChatIds.length > 0 && chatIds.length === 0) {
                return { messages: [], topics: [], resolvedUsers };
            }

            const messages = enrichMessages(memory, queryMessages(memory, {
                filters: normalizedFilters,
                limit,
                chatIds,
                keyword,
                userIds,
                fallbackName,
                includeBlocked: false,
            })).filter((row) => isChatAllowed(row.chatId));
            const topics = enrichTopics(memory, queryTopics(memory, {
                filters: normalizedFilters,
                limit,
                chatIds,
                keyword,
                userIds,
            })).filter((row) => isChatAllowed(row.chatId));

            return { messages, topics, resolvedUsers };
        },
    };
}

function collectInboxChatIds(
    memory: ConversationsReader,
    subagents: SubagentReader[],
    allowed: Set<string> | null,
): string[] {
    const chatIds = new Set<string>();
    for (const subagent of subagents) {
        if (!allowed || allowed.has(subagent.chatId)) {
            chatIds.add(subagent.chatId);
        }
    }
    for (const group of memory.listGroupModels()) {
        if (!allowed || allowed.has(group.chatId)) {
            chatIds.add(group.chatId);
        }
    }
    return [...chatIds];
}

function getSubagents(subagentManager: SubagentManagerReader | undefined): SubagentReader[] {
    return (subagentManager?.getAllSubagents?.() ?? [])
        .filter((value): value is SubagentReader =>
            !!value
            && typeof value === "object"
            && typeof (value as { chatId?: unknown }).chatId === "string"
        );
}

function buildInboxItem(
    memory: ConversationsReader,
    chatId: string,
    subagent?: SubagentReader,
): ConversationInboxItem {
    const groupModel = resolveGroupModel(memory, chatId);
    const chatTitle = groupModel?.chatTitle || resolveChatTitle(memory, chatId);
    // 第二道防线：即使 chat 级过滤漏掉，blocked 行也不得进入 latestMessage / unread 统计。
    const latest = memory.getRecentMessages(chatId, 1, { includeBlocked: false })[0];
    const latestMessage = latest ? recentMessageToInboxMessage(memory, latest) : undefined;
    const lastAttendedAt = subagent?.lastAttendedAt ?? null;
    const observerUnreadCount = subagent?.observer?.getBufferSize?.() ?? 0;
    const unread = isUnread(latestMessage, lastAttendedAt, observerUnreadCount);
    const unreadCount = unread
        ? Math.max(observerUnreadCount, countUnreadMessages(memory, chatId, lastAttendedAt, latestMessage))
        : 0;

    return {
        chatId,
        platform: resolvePlatform(chatId),
        chatTitle,
        chatLabel: formatChatLabel(chatTitle, chatId),
        isDirectMessage: groupModel?.isDirectMessage,
        latestMessage,
        unread,
        unreadCount,
        lastAttendedAt,
        lastActiveAt: latestMessage?.timestamp ?? formatActivityTime(subagent?.lastActivityAt),
        queueSize: asExecutorReader(subagent?.codeActExecutor)?.getQueueSize?.() ?? 0,
        isProcessing: asExecutorReader(subagent?.codeActExecutor)?.isProcessing?.() ?? false,
        stickinessLevel: subagent?.stickiness?.level ?? "STRANGER",
    };
}

function resolveGroupModel(memory: ConversationsReader, chatId: string): GroupModel | null {
    const direct = memory.getGroupModel(chatId);
    if (direct) {
        return direct;
    }

    try {
        const groupKey = getGroupModelKey(chatId);
        return groupKey === chatId ? null : memory.getGroupModel(groupKey);
    } catch {
        return null;
    }
}

function recentMessageToInboxMessage(memory: ConversationsReader, message: RecentMessageEntry): ConversationInboxMessage {
    return {
        messageId: message.messageId,
        chatId: message.chatId,
        userId: message.userId,
        displayName: message.displayName,
        content: formatConversationMessageContent(memory, message),
        mentions: message.mentions,
        replyToMessageId: message.replyToMessageId,
        timestamp: message.timestamp,
    };
}

function isUnread(
    latestMessage: ConversationInboxMessage | undefined,
    lastAttendedAt: string | null,
    observerUnreadCount: number,
): boolean {
    if (observerUnreadCount > 0) {
        return true;
    }
    if (!latestMessage) {
        return false;
    }
    return !lastAttendedAt || latestMessage.timestamp > lastAttendedAt;
}

function countUnreadMessages(
    memory: ConversationsReader,
    chatId: string,
    lastAttendedAt: string | null,
    latestMessage: ConversationInboxMessage | undefined,
): number {
    if (!latestMessage) {
        return 0;
    }
    if (!lastAttendedAt) {
        return memory.getRecentMessages(chatId, 100, { includeBlocked: false }).length;
    }
    return memory.queryMessages({ chatIds: [chatId], after: lastAttendedAt, limit: 100, includeBlocked: false })
        .filter((message) => message.timestamp > lastAttendedAt)
        .length;
}

function compareInboxItems(unreadFirst: boolean) {
    return (left: ConversationInboxItem, right: ConversationInboxItem): number => {
        if (unreadFirst && left.unread !== right.unread) {
            return left.unread ? -1 : 1;
        }
        const leftTime = left.latestMessage?.timestamp ?? left.lastActiveAt ?? "";
        const rightTime = right.latestMessage?.timestamp ?? right.lastActiveAt ?? "";
        if (leftTime !== rightTime) {
            return rightTime.localeCompare(leftTime);
        }
        return left.chatId.localeCompare(right.chatId);
    };
}

function resolvePlatform(chatId: string): string | undefined {
    try {
        return getPlatform(chatId);
    } catch {
        const index = chatId.indexOf(":");
        return index > 0 ? chatId.slice(0, index) : undefined;
    }
}

function formatActivityTime(value: number | undefined): string | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return undefined;
    }
    return new Date(value).toISOString();
}

function asExecutorReader(value: unknown): ExecutorReader | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    return value as ExecutorReader;
}

function decodeInboxCursor(cursor: string | undefined): number {
    if (!cursor) {
        return 0;
    }
    const offset = Number.parseInt(cursor, 10);
    return Number.isFinite(offset) && offset > 0 ? offset : 0;
}

function encodeInboxCursor(offset: number): string {
    return String(offset);
}

function decodeMessageCursor(cursor: string | undefined): string | undefined {
    const value = cursor?.trim();
    return value || undefined;
}

function makeBeforeCursor(timestamp: string | undefined): string | undefined {
    if (!timestamp) {
        return undefined;
    }
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
        return timestamp;
    }
    return String(parsed.getTime() - 1);
}

type NormalizedConversationFilters = Omit<ConversationsQueryFilters, "after" | "before"> & {
    after?: string;
    before?: string;
};

function normalizeFilters(filters: ConversationsQueryFilters): NormalizedConversationFilters {
    return {
        ...filters,
        after: timestampInputToIso(filters.after) ?? undefined,
        before: timestampInputToIso(filters.before) ?? undefined,
    };
}

function resolveUsers(
    memory: ConversationsReader,
    filters: NormalizedConversationFilters,
    limit: number,
): ResolvedConversationUser[] {
    const resolved = new Map<string, PersonIdentity>();
    const explicitUserId = filters.userId?.trim();
    if (explicitUserId) {
        const identity = memory.getPersonIdentity(explicitUserId);
        resolved.set(explicitUserId, identity ?? identityFromUserId(explicitUserId));
    }

    const user = filters.user?.trim();
    if (user) {
        const exact = memory.getPersonIdentity(user);
        if (exact) {
            resolved.set(exact.userId, exact);
        }
        for (const identity of memory.searchByAlias(user, Math.min(limit, 20))) {
            resolved.set(identity.userId, identity);
        }
    }

    return [...resolved.values()]
        .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
        .slice(0, Math.min(limit, 20))
        .map((identity) => ({
            userId: identity.userId,
            displayName: identity.displayName,
            username: identity.username,
            aliases: identity.aliases,
        }));
}

function identityFromUserId(userId: string): PersonIdentity {
    const timestamp = new Date(0).toISOString();
    return {
        userId,
        displayName: userId,
        aliases: [],
        totalMessageCount: 0,
        lastSeenAt: timestamp,
        firstSeenAt: timestamp,
        updatedAt: timestamp,
    };
}

function queryMessages(
    memory: ConversationsReader,
    input: {
        filters: NormalizedConversationFilters;
        limit: number;
        chatIds: string[];
        keyword?: string;
        userIds: string[];
        fallbackName?: string;
        includeBlocked?: boolean;
    },
): MessageSearchResult[] {
    const { filters, limit, chatIds, keyword, userIds, fallbackName, includeBlocked } = input;

    if (userIds.length > 0) {
        const rows = queryMessagesByKeyword(memory, {
            chatIds,
            userIds,
            keyword,
            after: filters.after,
            before: filters.before,
            limit,
            includeBlocked,
        });
        if (rows.length > 0 || !keyword) {
            return rows;
        }
    }

    const displayNameNeedle = fallbackName ?? keyword;
    if (displayNameNeedle) {
        const nameRows = queryMessagesWith(memory, {
            chatIds,
            displayNameLike: displayNameNeedle,
            after: filters.after,
            before: filters.before,
            limit,
            includeBlocked,
        });
        if (nameRows.length > 0) {
            return nameRows;
        }
    }

    if (keyword) {
        return queryMessagesByKeyword(memory, {
            chatIds,
            keyword,
            after: filters.after,
            before: filters.before,
            limit,
            includeBlocked,
        });
    }

    if (chatIds.length === 0) {
        return [];
    }

    const merged: MessageSearchResult[] = [];
    for (const chatId of chatIds) {
        const rows = memory.getRecentMessages(chatId, limit * 2, { includeBlocked })
            .filter((row) => matchesMessageFilters(row, filters))
            .map((row) => ({
                messageId: row.messageId,
                chatId: row.chatId,
                userId: row.userId,
                displayName: row.displayName,
                content: row.text,
                mentions: row.mentions,
                replyToMessageId: row.replyToMessageId,
                timestamp: row.timestamp,
                mediaType: row.mediaType,
                mediaInfo: row.mediaInfo,
            }));
        merged.push(...rows);
    }

    return sortMessages(merged).slice(0, limit);
}

function queryMessagesWith(
    memory: ConversationsReader,
    input: {
        chatIds: string[];
        userIds?: string[];
        displayNameLike?: string;
        textLike?: string;
        after?: string;
        before?: string;
        limit: number;
        includeBlocked?: boolean;
    },
): MessageSearchResult[] {
    return sortMessages(memory.queryMessages(input)).slice(0, input.limit);
}

function queryMessagesByKeyword(
    memory: ConversationsReader,
    input: {
        chatIds: string[];
        userIds?: string[];
        keyword?: string;
        after?: string;
        before?: string;
        limit: number;
        includeBlocked?: boolean;
    },
): MessageSearchResult[] {
    const terms = splitSearchTerms(input.keyword);
    if (terms.length === 0) {
        return queryMessagesWith(memory, {
            chatIds: input.chatIds,
            userIds: input.userIds,
            after: input.after,
            before: input.before,
            limit: input.limit,
            includeBlocked: input.includeBlocked,
        });
    }

    const merged = new Map<string, MessageSearchResult>();
    for (const term of terms) {
        const rows = queryMessagesWith(memory, {
            chatIds: input.chatIds,
            userIds: input.userIds,
            textLike: term,
            after: input.after,
            before: input.before,
            limit: input.limit,
            includeBlocked: input.includeBlocked,
        });
        for (const row of rows) {
            merged.set(`${row.chatId}:${row.messageId}`, row);
        }
    }

    return sortMessages([...merged.values()]).slice(0, input.limit);
}

function queryTopics(
    memory: ConversationsReader,
    input: {
        filters: NormalizedConversationFilters;
        limit: number;
        chatIds: string[];
        keyword?: string;
        userIds: string[];
    },
): TopicSearchResult[] {
    const { filters, limit, chatIds, keyword, userIds } = input;
    const scopes = chatIds.length > 0 ? chatIds : [undefined];
    const merged = new Map<string, TopicSearchResult>();

    if (keyword) {
        for (const chatId of scopes) {
            const rows = memory.searchTopics(keyword, {
                chatId,
                after: filters.after,
                before: filters.before,
                limit,
            });
            for (const row of rows) {
                if (userIds.length === 0 || userIds.some((userId) => row.participants.includes(userId))) {
                    merged.set(row.topicId, row);
                }
            }
        }
        return sortTopics([...merged.values()]).slice(0, limit);
    }

    const topicChatIds = chatIds.length > 0
        ? chatIds
        : userIds.length > 0
            ? memory.listGroupModels().map((group) => group.chatId)
            : [];

    for (const chatId of topicChatIds) {
        const rows = memory.getRecentTopics(chatId, limit * 2)
            .filter((row) => matchesTopicFilters(row, filters, userIds))
            .map(topicNodeToSearchResult);
        for (const row of rows) {
            merged.set(row.topicId, row);
        }
    }

    return sortTopics([...merged.values()]).slice(0, limit);
}

function enrichMessages(
    memory: ConversationsReader,
    rows: MessageSearchResult[],
): ConversationMessageResult[] {
    return rows.map((row) => {
        const chatTitle = resolveChatTitle(memory, row.chatId);
        const { mediaType: _mediaType, mediaInfo: _mediaInfo, ...publicRow } = row;
        return {
            ...publicRow,
            content: formatConversationMessageContent(memory, row),
            chatTitle,
            chatLabel: formatChatLabel(chatTitle, row.chatId),
        };
    });
}

function formatConversationMessageContent(
    memory: ConversationsReader,
    row: {
        messageId: string;
        chatId: string;
        displayName: string;
        timestamp: string;
        content?: string;
        text?: string;
        mediaType?: string;
        mediaInfo?: string;
    },
): string {
    const content = row.content ?? row.text ?? "";
    return formatMessageBody({
        id: row.messageId,
        sender: row.displayName,
        text: content,
        timestamp: row.timestamp,
        mediaType: row.mediaType,
        mediaInfo: row.mediaInfo,
    }, {
        includeMediaTags: true,
        stickerDescriptionLookup: memory,
    });
}

function enrichTopics(
    memory: ConversationsReader,
    rows: TopicSearchResult[],
): ConversationTopicResult[] {
    return rows.map((row) => {
        const chatTitle = resolveChatTitle(memory, row.chatId);
        return {
            ...row,
            chatTitle,
            chatLabel: formatChatLabel(chatTitle, row.chatId),
        };
    });
}

function resolveChatTitle(memory: ConversationsReader, chatId: string): string {
    return resolveGroupModel(memory, chatId)?.chatTitle || chatId;
}

function formatChatLabel(chatTitle: string, chatId: string): string {
    return `[${chatTitle}(${chatId})]`;
}

function matchesMessageFilters(
    row: Awaited<ReturnType<ConversationsReader["getRecentMessages"]>>[number],
    filters: NormalizedConversationFilters,
): boolean {
    if (filters.userId && row.userId !== filters.userId) {
        return false;
    }
    if (filters.after && row.timestamp < filters.after) {
        return false;
    }
    if (filters.before && row.timestamp > filters.before) {
        return false;
    }
    return true;
}

function matchesTopicFilters(topic: TopicNode, filters: NormalizedConversationFilters, userIds: string[]): boolean {
    const participantFilters = userIds.length > 0 ? userIds : filters.userId ? [filters.userId] : [];
    if (participantFilters.length > 0 && !participantFilters.some((userId) => topic.participants.includes(userId))) {
        return false;
    }
    if (filters.after && topic.startedAt < filters.after) {
        return false;
    }
    if (filters.before && topic.startedAt > filters.before) {
        return false;
    }
    return true;
}

function topicNodeToSearchResult(topic: TopicNode): TopicSearchResult {
    return {
        topicId: topic.id,
        chatId: topic.chatId,
        label: topic.label,
        summary: topic.summary,
        keywords: topic.keywords,
        participants: topic.participants,
        startedAt: topic.startedAt,
        endedAt: topic.endedAt,
        sentiment: topic.sentiment,
        callbackPotential: topic.callbackPotential ?? 0,
        associatedMemories: topic.associatedMemories ?? [],
    };
}

function sortMessages(rows: MessageSearchResult[]): MessageSearchResult[] {
    return rows.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

function sortTopics(rows: TopicSearchResult[]): TopicSearchResult[] {
    return rows.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
    return Math.min(Math.max(value ?? fallback, 1), max);
}

function uniqueStrings(values?: string[]): string[] {
    if (!values?.length) {
        return [];
    }
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function splitSearchTerms(query?: string): string[] {
    if (!query) {
        return [];
    }
    return uniqueStrings(query.split(/\s+/).map((term) => term.replace(/"/g, "")));
}
