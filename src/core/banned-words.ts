/**
 * banned-words.ts — Subagent 发言前禁用词检查
 *
 * 提供发送文本前的禁用词扫描能力。
 * 词表默认内置一组在 SOUL.md 中明确禁用的中文口癖词，
 * 也可以通过 config.yaml 的 subagent.bannedWords 覆盖。
 */

/** 默认禁用词列表（来自 SOUL.md，避免 AI 口癖出现在发言中）。 */
export const DEFAULT_BANNED_WORDS: string[] = [
    "确实",
    "笑死",
    "还真是",
    "接住",
    "抓住",
    "你说得对",
    "说得对",
    "不绕",
    "我认了",
];

/**
 * 在文本中查找匹配的禁用词，返回命中词列表（去重）。
 * @param text    待检测文本
 * @param words   禁用词列表
 */
export function findBannedWords(text: string, words: string[]): string[] {
    const found: string[] = [];
    for (const word of words) {
        if (word && text.includes(word) && !found.includes(word)) {
            found.push(word);
        }
    }
    return found;
}

/**
 * 构造一段发射给 LLM 上下文的禁用词警告文本。
 * @param foundWords  命中的禁用词
 * @param text        原始消息内容
 */
export function buildBannedWordWarning(foundWords: string[], text: string): string {
    const wordList = foundWords.map(w => `"${w}"`).join("、");
    const preview = text.length > 80 ? text.slice(0, 80) + "…" : text;
    return (
        `[⚠ 运行时警告: 禁用词已拦截] ` +
        `消息 "${preview}" 包含 ${foundWords.length} 个禁用词：${wordList}。` +
        `本次发送已拦截。请修改措辞，避免使用上述词语，改用更自然的网络口语后重新调用 sendText。`
    );
}
