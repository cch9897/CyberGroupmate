/**
 * discord.d.ts — Discord 平台 API
 *
 * 系统注入的 Discord host proxy 接口。
 * 提供给 Agent 在 sandbox 执行时作为 TypeScript 强类型上下文参考。
 * 平台连接与消息监听由宿主侧 DiscordAdapter 管理。
 */

type DiscordNativeSendOptions = string | {
    content?: string;
    tts?: boolean;
    nonce?: string | number;
    enforceNonce?: boolean;
    reply?: { messageReference: string; failIfNotExists?: boolean };
    files?: Array<string | { attachment?: string; file?: string; data?: string; url?: string; name?: string; fileName?: string; [key: string]: unknown }>;
    embeds?: unknown[];
    components?: unknown[];
    allowedMentions?: unknown;
    stickers?: readonly string[];
    flags?: unknown;
    poll?: unknown;
    [key: string]: unknown;
};

type DiscordMessageAck = { id: string; text: string; channelId: string; guildId?: string; timestamp: number; };

declare const discord: {
    // ─── 发送与交互 ───

    /**
     * Discord.js 原生 TextBasedChannel.send(options) 风格入口。
     * channelId 由 CyberGroupmate 用来定位频道；options 保持 discord.js MessageCreateOptions 形状。
     * 旧 sendText/sendMedia wrapper 只保留兼容，不再扩展新 Discord 参数。
     * @example
     * await discord.send(channelId, { content: "你好", reply: { messageReference: "1234567890" } });
     * @example
     * await discord.send(channelId, { content: "带附件", files: [{ attachment: "Downloads/a.png", name: "a.png" }] });
     */
    send(channelId: string, options: DiscordNativeSendOptions): Promise<DiscordMessageAck>;

    /**
     * Discord REST create message 风格别名，参数同 discord.send(channelId, options)。
     */
    createMessage(channelId: string, options: DiscordNativeSendOptions): Promise<DiscordMessageAck>;

    /**
     * 发送文本消息到指定频道。兼容 wrapper，冻结为兜底用法；新参数优先用 discord.send。
     * @param channelId 目标频道 ID（由 sandbox 上下文自动填入当前频道）
     * @param text 消息内容
     * @param opts 可选参数
     * @example sendText(channelId, "你好！")
     * @example sendText(channelId, "回复你的问题", { replyTo: "1234567890" })
     */
    sendText(channelId: string, text: string, opts?: { replyTo?: string }): Promise<DiscordMessageAck>;

    /**
     * 发送媒体消息（附件）到指定频道。兼容 wrapper，冻结为兜底用法；新参数优先用 discord.send。
     * 支持 URL 和本地文件路径（支持绝对路径或基于 cwd 工作区的相对路径）。
     * @param channelId 目标频道 ID
     * @param media 媒体对象或路径字符串，支持 URL、本地文件路径、data URL 或文件内容
     * @param opts 可选参数
     * @example sendMedia(channelId, { url: "https://example.com/image.png", caption: "看看这张图" })
     * @example sendMedia(channelId, { file: "screenshot.png", caption: "本地截图" }) // 自动基于 process.cwd() 解析
     * @example sendMedia(channelId, "screenshot.png")
     */
    sendMedia(channelId: string, media: string | { type?: "photo" | "video" | "document" | "audio" | "auto"; url?: string; file?: string; caption?: string; fileName?: string }, opts?: { replyTo?: string; caption?: string }): Promise<DiscordMessageAck>;

    /**
     * 对指定消息添加表情反应。支持 Unicode emoji、自定义 emoji ID、name:id 或 Discord emoji mention 格式。
     * @param channelId 目标频道 ID（由 sandbox 上下文自动填入当前频道）
     * @param messageId 目标消息 ID
     * @param emoji 表情字符串
     * @example sendReaction(channelId, "1234567890123456789", "😄")
     */
    sendReaction(channelId: string, messageId: string, emoji: string): Promise<void>;

    // ─── 状态操作 ───

    /**
     * 在频道中显示 "正在输入..." 状态。
     * @param channelId 目标频道 ID
     */
    sendTyping(channelId: string): Promise<void>;
};
