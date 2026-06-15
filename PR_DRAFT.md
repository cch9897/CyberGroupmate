# OneBot / NapCat adapter 完善：已读回执、Reaction、群成员、人性化延迟、昵称解析

## 概述

完善 OneBot（NapCat）适配器，补充与 Telegram 适配器对等的基本能力，修复若干消息处理缺陷，并优化 LLM 上下文中的 at 消息可读性。

## 变更项

### 1. 消息提取：@self 改写 + 昵称解析 (`9b507f5`)
- `extractText` 中原样输出 `[CQ:at,qq=123456]`，LLM 无法理解这是谁
- 新增 `personaName` 构造函数参数（默认 `"我"`），main.ts 从 `persona.name` 配置注入
- @自己 → `@personaName`（如 `@赛博群友`）
- @他人 → 昵称缓存命中时 `@昵称(QQ)`，未命中时 `[CQ:at,qq=xxx]` 回退 + fire-and-forget 异步拉取（下次可用）

### 2. 能力补齐 (`4511bc8`, `5ea4eec`)
- **sendReaction**：映射到 NapCat `set_msg_emoji_like`
- **pokeUser**：映射到 NapCat `group_poke`（仅群聊）
- **getChatMembers**：映射到 NapCat `get_group_member_list`
- **callApi 透传**：通用 NapCat API 直通，含 guide 白名单校验

### 3. 已读回执 & 消息删除 (`5ea4eec`)
- **markAsRead**：根据 chatType 分发 `mark_group_msg_as_read` / `mark_private_msg_as_read`
- **deleteMessages**：移除仅群聊限制，私聊 `delete_msg` 也可用
- **getMessage**：修复 `callAction` 已剥离 envelope 后再次 `.data` 解包导致的空值 bug

### 4. 人性化延迟 (`5ea4eec`)
- `applyHumanizedDelay`：首次发送无等待、连续发送打包延迟、窗口期过后重置

### 5. 性能优化 (`5ea4eec`)
- **inflight 去重**：并发的 `fetchGroupName`/`fetchUserNickname` 复用同一个 RPC Promise
- **prefetch 改进**：白名单感知的 peer name 预加载，替代旧的 `prefetchWhitelistedGroups`

### 6. WS 认证 (`4caa90e`)
- 支持 `accessToken` 配置项，连接时发送 `Authorization: Bearer` 头

### 7. 测试 (`044ed8e`, `8575067`)
- 新增 13 个 `chat-title-sync` 测试
- 新增 8 个 OneBot 功能测试（markAsRead、deleteMessages、humanizedDelay、sendReaction、pokeUser、getChatMembers、getMessage、extractText）
- context-manager / telegram 测试适配 composite ID 格式

## 影响范围

| 文件 | 变更 |
|---|---|
| `src/adapter/onebot-adapter.ts` | 核心适配器：+342/-138 |
| `src/main.ts` | 注入 `personaName` |
| `src/core/config.ts` | OneBotConfig 新增字段 |
| `src/sandbox/modules/onebot/` | 沙箱 proxy 声明和实现 |
| `tests/` | 3 文件新增/适配测试 |
| `config.example.yaml` | access_token 文档 |

## 向后兼容

- 所有新增构造函数参数均有默认值，现有调用方无需修改
- 消息段处理保持 CQ 码回退路径，无破坏性变更

## 测试

```
OneBotAdapter: 13/13 通过
chat-title-sync: 13/13 通过
context-manager: 全部通过
```
