# Progressive Disclosure & "npm as Skills" in CodeAct Architecture

## 我们的愿景 (Our Vision)
**"Make the entire npm your skill library."**

在传统的 Agent 架构中，为大语言模型（LLM）提供工具通常需要繁琐的包裹（Wrapping）和参数定义（如 JSON Schema）。当面对复杂的外部系统（如 GitHub API、Notion API）时，我们需要手动将庞大的 SDK 转化为几十个散碎的 Tools，这不仅增加了开发成本，还极易导致 LLM 的上下文窗口（Context Window）被铺天盖地的工具说明塞满，造成注意力分散（Context Bloat / Attention Dilution）。

在 CyberGroupmate 中，我们借鉴了基于 **CodeAct** 和 **渐进式披露（Progressive Disclosure）** 的优点并提出这个新的 TS Skills 的理念。

---

## 核心机制：渐进式文档披露 (Progressive Documentation Disclosure)

如果你把整个复杂的 SDK 文档直接塞给 LLM，它多半会晕头转向。我们在 CodeAct 两阶段执行机制（Two-Pass Code Generation）中引入了**无状态的动态文档解析与注入**：

### Pass 1：认知轮廓，精准索引 (The "Brief" Pass)
在每一轮的 System Prompt 中，LLM 只会看到所有已加载模块的**单行签名**（Brief Overview）。
例如，它只知道有这样一个对象：
```typescript
github.listIssues: 列出指定仓库的 Issue 列表
github.createIssue: 在指定仓库创建新的 Issue
telegram.sendText: 发送文本消息到指定频道
```
由于这些定义极其轻量，它即便挂载了几十个 Skills，也不会占用系统太多的 Token，保证了 LLM 依然保持敏锐的核心逻辑思考能力。

### 运行时错误后：按需索取，精准滴灌 (Runtime Recovery)
当 LLM 准备采取行动，生成了如 `await github.listIssues(...)` 的代码时，Sandbox 会先按原样执行。
如果代码成功运行，系统不额外注入完整文档，避免把上下文撑大。

只有当代码出现运行时错误时，我们的 **API Intent Extractor** 才会扫描刚刚执行失败的代码，提取其中调用的原生能力。
如果命中了一些复杂模块（如 `github`），系统会动态读取这些具体方法的**完整类型定义（包含详尽的 JSDoc、多行说明、具体参数和示例）**，作为新的 observation 追加给 LLM。此时**不会删除或撤销上一条 assistant/code 消息**，模型会同时看到原代码、运行时错误和完整“说明书”，再自行修正下一轮代码。

**为什么是最优雅的意图推测？**
作为底层框架，推测一个 Agent “当前需要什么文档”往往是个难题。传统的做法可能需要前置一个额外的 Router 模型去猜测，或者使用向量检索（RAG）。但在 CodeAct 架构中，最优雅的推测方式就是**让她先发散思维去“盲写代码”**。
你不需要另一个 LLM 来进行推测预测，你只需要静静地观察她写出了什么方法调用。她本能写出的代码，就是她自发需要使用的原生能力。提取这段代码中的 API 意图，然后精准“喂”给她对应的说明书，这是最符合直觉、开销最小的动态寻路方案。

### 记忆去重与压缩自适应 (Stateless Deduplication & Context Compaction)
LLM 的交互是在多轮流式对话中进行的：
- **无状态去重**：每次运行时错误后准备注入文档时，系统会向前追溯历史消息（Messages History）。只要上下文中**已有**这本“说明书”（带有 `### module.method` 等标记），就不会重复注入，避免对话被反复出现的文档撑爆。
- **与 Session Compaction 的完美契合**：如果对话过长，旧的文档被上下文截断（Compact）清理掉了怎么办？无需担心！我们的检测机制是**基于当前可见上下文**的。一旦 LLM 的“认知”里失去了这块文档，而它又要调用该方法时，机制会自动补发一次缺失的说明，实现真正的随需取用。

---

## 技术实现：完全解耦的 npm Skills
我们如何定义一个 TS Skill？
开发者只需去独立的 Git 仓库 `Archeb/ts-skills` 中新建一个文件夹，并在里面做两件事：
1. `index.ts`（或者 `index.js`）：暴露标准的 SDK 实例（或封装的实例）。想用什么 npm 包，直接 `npm install`，在代码里自由引入。这是给 **Sandbox（Node.js Worker 进程）** 真实执行用的。
2. `.d.ts`：编写一份**人工精心裁剪**的 TypeScript 声明文件。在这个文件里，你不需要暴露完整的 npm 库接口，只暴露你**希望 LLM 认知的接口**（Cognitive Map），并配上简单易懂的 JSDoc。这段描述是给 **Host（LLM Prompt 处理器）** 静态读取并喂给 LLM 的。

**系统完全解耦：**
主程序完全不干涉你的 npm 包逻辑，只要它出现在 `workspace/skills/` 下，主程序就会在运行时（Runtime）利用 `dts-parser.ts` 以纯正则静态提取 `.d.ts`，组装成给 LLM 的“知识地图”。不仅实现了热插拔，更从根本上保证了核心内置能力与第三方组件在代码和静态编译期上的隔离。无需执行任何 npm 脚本，只需 clone 仓库即可生效，下一次对话 LLM 就能直接识别并使用。

---

## 架构优势总结 (Benefits)

1. **零封装成本 (Zero-wrapping cost)**：再也不用痛苦地把原本一个原生函数调用就能解决的事情，费尽心思地转化为各种复杂的 OpenAI JSON Schema Formats（还要维护巨大的参数映射层）。会写 TypeScript 就会写 Tool。
2. **无限可扩展性 (Infinite Scalability)**：利用“轻量概览 + 错误后按需详述”机制，我们打破了 System Prompt 的长度魔咒。理论上你可以挂载几百个微小而具体的 Skills，LLM 只会在真正调用失败、需要修正时，才获得那个模块的详细地图。
3. **安全与隔离并存 (Safety & Isolation)**：Host 进程仅做纯文本的静态AST分析（绝不会意外 `require` 恶意模块），所有的 npm 模块实例和真正的代码执行都被限定在安全隔离的 Sandbox Worker 内运作。
4. **像真实程序员一样的工作流 (Human-like Workflow)**：这极度贴近真实程序员的工作状态——面对庞大的不知名 SDK，先通过 IDE 的智能提示看个函数名和短述直接尝试；如果运行时报错，再查看详细的 JSDoc、完整出入参和示例代码，然后修正下一版。

**“Stop teaching LLMs how to parse your JSON tool definitions. Let them write executable code and read JSDoc instead.”**

---



## 实战解读：一次真实的轻量尝试 → 错误后补文档流程

以下基于一次真实的群聊回复任务，展示渐进式披露机制如何在实际对话中运作。

---

### 第 1 轮：Agent 只看到"目录"

在 System Prompt 的 `# 可用 API` 区域，Agent 看到的 `tavily` 模块仅有两行：

```
## tavily
tavily.d.ts — 网络搜索模块类型定义
- search: 搜索网页内容。
- extract: 从指定 URL 提取页面内容。
```

没有参数列表，没有返回类型，没有示例代码——所有 Skill 模块加起来也只占很少的 Token。Agent 能同时看到 `telegram`、`memory`、`github`、`finance`、`tavily` 等十几个模块的概览，而上下文依然轻量清爽。

基于这份"目录"，Agent 决定先搜索一下相关信息，于是**凭直觉盲写**了一段代码：

```javascript
const searchResults = await tavily.search(
  "CodeAct Progressive Disclosure MCP", { maxResults: 3 }
);
console.log("搜索结果:", JSON.stringify(searchResults, null, 2));
```

此时 Agent 并不知道 `search()` 的完整签名——它不知道有 `searchDepth`、`topic`、`timeRange` 这些选项，也不知道返回值的具体结构（`result.answer`、`result.results[0].url`）。但没关系，**它写出了 `tavily.search`，这就足够了。**

---

### Intent Extraction：Host 静态扫描意图

代码会先按原样执行。如果出现运行时错误，Host 进程再用正则扫描这段失败代码，提取出 API 调用意图：

```
检测到意图: tavily.search
```

系统判断 `tavily` 是一个需要详细文档的复杂模块，于是在错误 observation 中追加完整文档。

---

### 错误后：精准注入"说明书"，下一轮修正

系统动态读取 `tavily.d.ts` 中 `search` 方法的**完整类型定义**，将其追加进包含运行时错误的 User Message；Agent 刚才写下的代码消息保留在历史里：

```
[📚 运行时错误后加载 API d.ts 文档]

刚才的代码出现了运行时错误，并且用到了以下 API: tavily.search。
以下是这些方法的完整类型定义和用法文档。请结合上面的错误信息修正代码：

### tavily.search
search(
    query: string,
    opts?: {
        searchDepth?: "basic" | "advanced";
        topic?: "general" | "news" | "finance";
        maxResults?: number;
        includeAnswer?: boolean;
        ...
    },
): Promise<WebSearchResponse>

搜索网页内容。返回相关网页的标题、URL 和内容摘要。

示例：
const result = await tavily.search("2024年奥运会金牌榜");
console.log(result.answer);
console.log(result.results[0].url);

---
#### 相关类型定义
interface WebSearchResponse { results: WebSearchResult[]; answer?: string; ... }
...
```

现在 Agent 手握完整手册，重新生成代码：

```javascript
const searchResult = await tavily.search(
  "CodeAct Progressive Disclosure MCP context stuffing",
  { searchDepth: "advanced", maxResults: 3 }   // ← 现在知道有 searchDepth 选项了
);
console.log("搜索结果:", JSON.stringify(searchResult, null, 2));
```

对比两次输出：修正版代码利用了文档中新获知的 `searchDepth: "advanced"` 参数，生成了更精确的调用。

---

### 流程对比一览

| | 初次尝试（轻量概览） | 错误后修正（完整文档） |
|---|---|---|
| **Agent 可见信息** | `search: 搜索网页内容。`（单行） | 运行时错误 + 原代码 + 完整签名 + JSDoc + 示例 + 返回类型 |
| **Token 开销** | 极低（所有模块概览 ~数百 Token） | 仅注入被调用方法的文档（~数百 Token） |
| **代码质量** | 先试，可能因参数理解不足报错 | 参数精准、符合最佳实践 |
| **是否执行** | ✅ 先送入 Sandbox 执行 | ✅ 下一轮修正后再执行 |

---

### 关键洞察

整个过程中，**没有额外的 Router 模型、没有向量检索、没有预测分类器**。Agent 自身的"盲写代码"就是最天然的意图信号——它写了 `tavily.search`，说明它需要搜索；它写了 `github.issues.listForRepo`，说明它需要 GitHub。Host 只需做静态分析，就能精准地知道该喂哪本说明书。

这就是 **"让 Agent 先写，再补文档"** 的核心哲学：用 Agent 的本能表达替代昂贵的意图推理。
