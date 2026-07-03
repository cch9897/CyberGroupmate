/**
 * Shared chat ordering helpers for dashboard sidebars.
 */

function toTimestamp(value) {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function groupIndex(groups) {
  const map = new Map();
  (groups || []).forEach((g, index) => {
    if (g?.chatId) map.set(g.chatId, { group: g, index });
  });
  return map;
}

function latestMessageTimes(messages) {
  const map = new Map();
  for (const m of messages || []) {
    if (!m?.chatId) continue;
    const ts = toTimestamp(m.timestamp);
    if (ts > (map.get(m.chatId) || 0)) map.set(m.chatId, ts);
  }
  return map;
}

function compareChatItems(a, b) {
  if (b.lastMessageTs !== a.lastMessageTs) return b.lastMessageTs - a.lastMessageTs;
  if (a.index !== b.index) return a.index - b.index;
  return String(a.chatId).localeCompare(String(b.chatId));
}

export function sortGroupsByLastMessage(groups, messages = []) {
  const messageTimes = latestMessageTimes(messages);
  return [...(groups || [])]
    .map((group, index) => ({
      group,
      chatId: group.chatId,
      index,
      lastMessageTs: Math.max(toTimestamp(group.lastMessageAt), messageTimes.get(group.chatId) || 0),
    }))
    .sort(compareChatItems)
    .map((item) => item.group);
}

export function sortChatIdsByLastMessage(chatIds, groups, messages = []) {
  const indexed = groupIndex(groups);
  const messageTimes = latestMessageTimes(messages);
  return [...(chatIds || [])]
    .map((chatId, index) => ({
      chatId,
      index: indexed.get(chatId)?.index ?? index,
      lastMessageTs: Math.max(toTimestamp(indexed.get(chatId)?.group?.lastMessageAt), messageTimes.get(chatId) || 0),
    }))
    .sort(compareChatItems)
    .map((item) => item.chatId);
}
