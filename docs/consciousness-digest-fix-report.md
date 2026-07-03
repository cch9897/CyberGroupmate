# Consciousness Digest Upgrade — 审计修复报告

基于 Claude 对 `codex/consciousness-digest-memory` 分支的审计，以下是发现的问题及对应修复。

## 审计结果汇总

审计共发现 8 个潜在问题，经验证排除 3 个误报，最终确认 5 个需要修复的问题。

### 已排除的误报

| 编号 | 原始问题 | 排除原因 |
|------|----------|----------|
| 1.2 | FTS5 查询未转义 | `querySessionDigests` 已调用 `buildFtsOrQuery()` 进行转义处理 |
| 7.2 | `listCoreFacts` 不在 interface 中 | 属于历史遗留，非本分支引入，且 TypeScript 可正确解析类实现 |
| 8.2 | `recall()` 的 sessionDigests 未脱敏 | `recall()` 仅在 `semanticSearch` 内部使用，不对外暴露 sessionDigests |

## 修复清单

### Fix A — `harness_enqueue` 结构化升级 [High]

**问题**: `harness_enqueue` 只接受 `content` 字符串，缺少 `runId`、`actorId`、`triggerReason` 等结构化元数据。Meta→Harness 方向缺少与 Harness→Meta 对等的上下文信息。

**修复**: 为 `harness_enqueue` 添加可选结构化字段（`actorId`、`runId`、`triggerReason`、`sourceChatId`、`sourceChatTitle`、`taskId`、`metadata`），并在入队时写入 session digest 记录。

**文件**: `src/mcp-server/tools/notify.ts`

### Fix B — `attention_enqueue` 累加器负载裁剪 [Medium]

**问题**: `attention_enqueue` 在累加器 payload 中使用 `...input` 展开，将整个输入对象（含 `observedContextRefs`、`metadata` 等可能的大对象）保存在内存中。

**修复**: 将 `...input` 替换为仅需要的字段：`actorId`、`triggerReason`、`requestedAction`、`sourceChatId`、`taskId`、`runId`、`priority`。

**文件**: `src/mcp-server/tools/notify.ts`

### Fix C — 新增 `attention_enqueue` digest 类型 [Medium]

**问题**: `attention_enqueue` 和 `attention_callback` 都使用 `kind: "harness_callback"` 写入 digest，无法区分两种不同语义的操作，影响过滤和分析。

**修复**:
1. 在 `SessionDigestKind` 联合类型中新增 `"attention_enqueue"` 值（同时更新 `memory-v2/types.ts` 和 `subagent/types.ts` 中的重复定义）。
2. `attention_enqueue` handler 的 digest kind 改为 `"attention_enqueue"`。

**文件**: `src/memory-v2/types.ts`, `src/subagent/types.ts`, `src/mcp-server/tools/notify.ts`

### Fix D — Delta diff 使用 `id` 作为比较键 [Medium]

**问题**: Delta diff 使用 `createdAt::content` 作为比较键，同毫秒内的相同内容会被误判为重复而丢失。

**修复**: 在 `MetaHistoricalData` 和 `ExecutorSessionDigestsData` 接口中添加 `id?: string` 字段，diff 逻辑优先使用 `id` 作为比较键，保留 `createdAt::content` 作为无 id 时的回退。

**文件**: `src/context-engine/providers/meta-providers.ts`, `src/context-engine/providers/executor-providers.ts`

### Fix E — 移除死代码 `searchSessionDigests` 回退 [Medium]

**问题**: `searchEntities` 中包含 `typeof memory.searchAgentMemory === "function"` 的运行时类型检查和 `searchSessionDigests(globalState, ...)` 回退。由于 `searchAgentMemory` 始终是 `MemoryEntityReader` 接口的一部分，此条件永远为 true，回退代码不可达。

**修复**:
1. 移除条件判断，直接使用 `memory.searchAgentMemory()`。
2. 删除 `searchSessionDigests()` 函数和 `SessionDigestReader` 类型别名。
3. 移除 `createMemoryApi` 的 `globalState` 参数及所有调用点的传参。
4. 清理 `quotes.ts` 中不再需要的 `globalState` 字段和 `GlobalState` 导入。

**文件**: `src/meta-sandbox/meta-api/memory.ts`, `src/meta-sandbox/meta-api/index.ts`, `src/meta-sandbox/meta-api/quotes.ts`

## 验证

- TypeScript 类型检查通过（已排除环境未安装依赖的 pre-existing 错误）
- 所有变更限于本分支新增代码范围，未影响既有功能
