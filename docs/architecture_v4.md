# CyberGroupmate Architecture v4

> **Meta-CodeAct: A Multi-Agent Social Bot with Structured Context Management**
>
> Last updated: 2026-05-26

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [System Overview](#2-system-overview)
3. [Meta Agent — The Orchestrator](#3-meta-agent--the-orchestrator)
4. [Dispatch / Callback: Cross-Group Agency](#4-dispatch--callback-cross-group-agency)
5. [CodeAct + TypeScript Sandbox](#5-codeact--typescript-sandbox)
6. [Progressive Disclosure: "npm as Skills"](#6-progressive-disclosure-npm-as-skills)
7. [Context Engine: Structured Prompt Assembly](#7-context-engine-structured-prompt-assembly)
8. [Attention Accumulator](#8-attention-accumulator)
9. [Recording Pipeline & Topic Registry](#9-recording-pipeline--topic-registry)
10. [Memory V2: Three-Layer Memory](#10-memory-v2-three-layer-memory)
11. [Multi-Platform Adapters](#11-multi-platform-adapters)
12. [LLM Pool & Multi-Model Routing](#12-llm-pool--multi-model-routing)
13. [Web Dashboard](#13-web-dashboard)
14. [Telemetry & Observability](#14-telemetry--observability)

---

## 1. Design Philosophy

CyberGroupmate is a self-directed social agent that lives in group chats. It doesn't just respond to commands — it observes conversations, forms opinions, makes decisions about when and what to say, and acts across multiple groups simultaneously.

Three principles guide the architecture:

1. **"Structured data = source of truth, natural language = view layer."** The system reasons about typed objects; rendering to natural language happens once, at the boundary, right before the LLM sees it. This is what makes high cache rates possible.

2. **"Code is the universal tool interface."** Instead of wrapping every SDK into JSON Schema tool definitions, the agent writes and executes real TypeScript. API documentation is injected progressively — only when the agent actually needs it. This makes skill expansion trivially cheap.

3. **"Observe globally, act locally."** A single Meta Agent sees all groups and makes orchestration decisions. Subagent Executors carry out tasks within individual groups. The dispatch/callback loop ties them together.

---

## 2. System Overview

```
┌─────────────────────────── Platform Layer ───────────────────────────┐
│  Telegram Adapter     Discord Adapter     OneBot (QQ) Adapter        │
└──────────────┬──────────────┬──────────────┬────────────────────────┘
               │              │              │
               ▼              ▼              ▼
         ┌─────────────────────────────────────────┐
         │          NotificationCenter (Q1)         │
         │        Global event bus + routing         │
         └──────────────────┬──────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
    ┌──────────────┐ ┌───────────┐ ┌──────────────┐
    │   Observer    │ │ Recording │ │   Message     │
    │  (per-group)  │ │ Pipeline  │ │   Archive     │
    └──────┬───────┘ └─────┬─────┘ └──────────────┘
           │               │
           ▼               ▼
    ┌──────────────┐ ┌───────────────┐
    │    Topic      │ │  Topic        │
    │    Signals    │ │  Registry     │
    └──────┬───────┘ └───────────────┘
           │
           ▼
┌─────────────────────────────────────────────────┐
│          Attention Accumulator (Q2/Q3)           │
│   Layer 0: Direct  │ Layer 1: Callbacks/Sched   │
│   Layer 2: Topic signals + pressure scoring      │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌══════════════════════════════════════════════════╗
║              Meta Agent Session                  ║
║  ┌──────────────────────────────────────────┐   ║
║  │  Context Engine (meta providers)         │   ║
║  │  → Session Digests, Todos, Callbacks,    │   ║
║  │    Topic Digests, Messages, Profiles...  │   ║
║  └──────────────┬───────────────────────────┘   ║
║                 ▼                                ║
║  ┌──────────────────────────────────────────┐   ║
║  │  MetaSandbox (VM) + Meta APIs            │   ║
║  │  conversations · memory · agents         │   ║
║  │  dispatch · remind · cron · todo         │   ║
║  └──────────────┬───────────────────────────┘   ║
║                 │ dispatch.taskToGroup()         ║
╚═════════════════╪═══════════════════════════════╝
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│     CodeAct Executor (per-group subagent)        │
│  ┌─────────────────────────────────────────┐    │
│  │  Context Engine (executor providers)    │    │
│  │  → Task, Topics, Messages, Profiles,   │    │
│  │    Memory, Grounding, Stickers...       │    │
│  └──────────────┬──────────────────────────┘    │
│                 ▼                                │
│  ┌─────────────────────────────────────────┐    │
│  │  Sandbox Worker (isolated process)      │    │
│  │  TypeScript execution + PTY shell       │    │
│  │  Built-in modules + TS Skills           │    │
│  └──────────────┬──────────────────────────┘    │
│                 │ sends messages, runs code...   │
└─────────────────┼───────────────────────────────┘
                  │
                  ▼
         Callback Queue (Q5) ──→ Meta Agent (next cycle)
```

---

## 3. Meta Agent — The Orchestrator

The Meta Agent is the "brain" of the system. It doesn't talk directly to any group — instead, it observes the global state of all groups and makes orchestration decisions by writing and executing JavaScript code in a secure VM sandbox.

### Session Loop

```
AttentionAccumulator.flush()
       │
       ▼
MetaSessionHandler
  1. Load session history from GlobalState
  2. Build context via ContextEngine (meta providers)
  3. Run MetaSessionRunner:
     ┌─────────────────────────────────┐
     │  LLM generates thinking + code  │
     │         ↓                       │
     │  MetaSandbox.execute(code)      │
     │         ↓                       │
     │  Observation → append to msgs   │
     │         ↓                       │
     │  Repeat until end_turn          │
     └─────────────────────────────────┘
  4. Extract session digest from thinking
  5. Commit context tree to ledger
  6. Append new turns to GlobalState history
```

### Meta APIs

The Meta Agent has access to a set of orchestration APIs inside the sandbox:

| API | Purpose |
|-----|---------|
| `conversations.query()` | Cross-group message and topic search |
| `memory.searchEntities()` | Cross-group identity and fact retrieval |
| `agents.listStatus()` | Monitor subagent load and state |
| `dispatch.taskToGroup()` | Delegate tasks to group-level executors |
| `dispatch.getTask()` / `listTasks()` | Query dispatched task status |
| `remind.set()` | Schedule future wake-ups |
| `cron.add()` / `remove()` / `list()` | Periodic scheduled tasks |
| `todo.add()` / `list()` / `remove()` | Persistent cross-session notes |

These APIs are exposed as frozen objects in a `vm.runInNewContext` sandbox with a 30-second execution timeout. The Meta Agent writes real JavaScript to call them — no JSON tool schemas, no function calling wrappers.

### Session Digest

After each Meta session, the system extracts a **session digest** from the LLM's thinking block (via `[SESSION_DIGEST]...[/SESSION_DIGEST]` markers). These digests form the Meta Agent's persistent memory of past decisions, carried forward into future sessions via the Context Engine's delta tracking.

---

## 4. Dispatch / Callback: Cross-Group Agency

The dispatch/callback loop is what gives the agent **cross-group awareness and agency** — the ability to observe a conversation in Group A, decide it should act, and dispatch a tailored reply task to Group A's executor, all while simultaneously handling Groups B and C.

### Dispatch Flow

```
Meta Agent (global view)
  │
  │  dispatch.taskToGroup("group_A", {
  │    contentDirection: "回复张三关于旅游的问题，语气轻松",
  │    toneGuidance: "casual, friendly",
  │    quotes: ["msg:12345"],
  │    tracking: {
  │      key: "travel-reply",
  │      content: "等张三回复后跟进",
  │      remindAfterMinutes: 30,
  │      callback: "检查张三是否回复了旅游话题"
  │    }
  │  })
  │
  ▼
Dispatch API
  1. Get or create subagent for group_A
  2. Ensure CodeActExecutor has active session
  3. Run optional grounding (fact-check via web search)
  4. Build GroupContextPackage:
     - Group model (chat profile)
     - Active user profiles
     - Quote context (resolved from message IDs)
     - Memory search results
     - Grounding context
  5. Construct CodeActReplyTask
  6. Record to GlobalState for tracking
  7. Enqueue to executor
  8. If tracking.remindAfterMinutes: schedule reminder
```

### Callback Flow

```
CodeActExecutor (group_A)
  │  Executes task → sends messages → collects results
  │
  ▼
SubagentCallback {
  taskId, chatId, status,
  sentMessages, executionSummary
}
  │
  ▼
CallbackQueue (Q5) — global producer-consumer queue
  │
  ▼
MainAgentLoop.drainCallbacks()
  │
  ▼
Meta Agent (next session)
  sees: "task X completed, sent 2 messages, user reacted with 👍"
  decides: follow up? move on? dispatch to another group?
```

### Tracking & Reminders

Dispatch supports an optional `tracking` spec that:
- Stores a tracking record in the todo system (keyed by `dispatch:{taskId}`)
- Schedules a reminder via GlobalState that re-injects into the Attention Accumulator after N minutes
- Includes a `callback` message and arbitrary `data` payload for the Meta Agent to evaluate later

This creates a **closed feedback loop**: dispatch → execute → callback → evaluate → re-dispatch if needed.

### Cross-Group Dispatch

A subagent executor in Group A can itself dispatch tasks to Group B via the `dispatch` module in the sandbox. The dispatch source is tagged (`"meta"` vs `"subagent"`) so the Meta Agent can trace the origin chain. This enables sophisticated multi-group coordination without requiring the Meta Agent to micromanage every step.

---

## 5. CodeAct + TypeScript Sandbox

The agent doesn't use traditional tool-calling. It writes and executes real TypeScript code in an isolated sandbox.

### Sandbox Architecture

```
┌─────── Host Process (main) ──────┐     ┌────── Worker Process ──────────┐
│  Sandbox class                    │     │  sandbox-worker.ts              │
│  - IPC via stdin/stdout JSON-line │◄───►│  - Async code execution         │
│  - PTY shell management (≤5 tabs) │     │  - Notebook-scope variables     │
│  - Host call handler (50+ methods)│     │  - Promise tracking (deep proxy)│
│  - Per-chat state isolation       │     │  - Module registry              │
│  - Environment variable patching  │     │  - Skill loader                 │
└───────────────────────────────────┘     └─────────────────────────────────┘
```

**Key design decisions:**

- **Notebook semantics**: Top-level `const`/`let` declarations are rewritten to assignments on a per-task scope proxy, so variables persist across turns within a task — just like Jupyter notebook cells.
- **Promise tracking**: All injected API objects are wrapped with deep Proxy to intercept function calls. Unawaited promises are collected and flushed before returning results, preventing silent failures.
- **Host callback bridge**: When sandbox code calls an API that requires host-side resources (memory, platform adapter, MCP), the call is serialized to the host process via IPC, executed there, and the result returned to the worker.

### Built-in Modules

| Module | Capabilities |
|--------|-------------|
| `telegram` / `discord` / `onebot` | Platform-specific messaging, media, reactions |
| `memory` | Semantic search, user profiles, topic/fact recall |
| `shell` | Multi-tab PTY terminals with scrollback |
| `filesystem` | Workspace-scoped file operations |
| `vision` | Image analysis via multimodal LLM |
| `todo` | Persistent task lists |
| `cron` | Periodic scheduled tasks (min 1h interval) |
| `dispatch` | Cross-subagent task routing |
| `mcp` | Model Context Protocol bridge to external tools |
| `skills` | Hot-reloadable user-defined TypeScript skills |
| `runtime` | Notifications, user input, task spawning, reminders |
| `ctx` | Per-chat persistent key-value state |

### Session Runner (CodeAct Loop)

```
System Prompt (with Pass 1 API briefs)
     │
     ▼
LLM generates thinking + code blocks (ts/js/bash)
     │
     ▼
Parse code blocks → execute in sandbox
     │
     ├─ Success → observation with result
     │
     └─ Error → API Intent Extractor scans code
                     │
                     ▼
              Inject full .d.ts docs for called methods (Pass 2)
                     │
                     ▼
              LLM retries with complete documentation
     │
     ▼
Repeat until <end_task> or max turns (default 30)
```

---

## 6. Progressive Disclosure: "npm as Skills"

> *"Make the entire npm your skill library."*

Traditional agent frameworks require wrapping every SDK method into JSON Schema tool definitions. CyberGroupmate takes a radically different approach: the agent writes TypeScript, and documentation is injected **only when needed**.

### Two-Pass Documentation

**Pass 1 — Cognitive Map (always present):**
Every loaded module gets a single-line brief in the system prompt:

```
## tavily
- search: Search web content.
- extract: Extract content from a URL.
```

Dozens of modules cost only hundreds of tokens. The LLM knows *what exists* without being overwhelmed by *how to use it*.

**Pass 2 — Full Docs on Error (on-demand):**
When the agent's code fails at runtime, the **API Intent Extractor** scans the failed code for method calls, matches them against `.d.ts` declarations, and injects complete TypeScript type definitions (with JSDoc, parameters, examples) into the next observation.

The key insight: **the agent's own code is the best intent signal.** No need for a separate router model, no RAG retrieval, no classification step. What the agent wrote is what it needs documentation for.

### Stateless Deduplication

Before injecting docs, the system scans visible conversation history for existing documentation markers. If the docs are already present, they're not re-injected. If context compaction has pruned them away, they're automatically re-injected on the next error — true on-demand access.

### Skill Definition

A skill is just a directory in `workspace/skills/<name>/`:

```
workspace/skills/tavily/
├── index.ts       # Runtime: export the SDK instance or wrapper
├── tavily.d.ts    # API definition: curated TypeScript declarations + JSDoc
└── (or SKILL.md)  # Alternative: agent-skill specification (no code)
```

No JSON schemas, no tool wrappers. The `.d.ts` file is the **cognitive map** — you expose exactly the API surface you want the LLM to know about, with human-crafted documentation. The `index.ts` is the runtime implementation, loaded in the sandbox worker.

---

## 7. Context Engine: Structured Prompt Assembly

The Context Engine is what makes high prompt-cache hit rates possible. Instead of manually concatenating strings for each LLM call, context is assembled declaratively from **typed data providers**, with built-in delta tracking, caching strategies, and a manifest for observability.

### Core Abstraction

```typescript
interface SectionProvider<T> {
  schema: SectionSchema;          // name, label, cache strategy, history strategy
  resolve(ctx: ResolveContext): T | null;  // extract typed data
  diff?(current: T, committed: T | null): DiffResult<T>;  // structural delta
  render(data: T): string;        // typed data → natural language (once)
  renderDelta?(delta: T): string; // render only the new parts
  hash?(data: T): string;         // identity for static caching
}
```

### Cache Strategies

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| `static` | Hash-based; skip if unchanged | System instructions, group profile |
| `delta` | Provider computes structural diff | Messages, user profiles, topic digests |
| `snapshot` | Always send full data | Callbacks, volatile state |
| `volatile` | Never cached | Per-turn instructions, decision prompts |

### History Strategies

| Strategy | What enters conversation history | Use Case |
|----------|----------------------------------|----------|
| `persistent` | Full rendered text | Headers, group context |
| `delta-only` | Only incremental changes | Messages (avoid resending 200 msgs each turn) |
| `ephemeral` | Nothing (current turn only) | Memory search results, sticker catalogs |
| `omit` | Placeholder: "see latest version" | Rarely-changing reference data |

### How It Achieves High Cache Rates

The flow is:

```
Provider.resolve() → typed data
        │
        ▼
Provider.diff(current, committed) → delta (in structured layer)
        │
        ▼
Provider.render(data) → natural language text (one-time)
        │
        ▼
Assemble: historical content + ephemeral content
        │
        ▼
After LLM success: engine.commit(tree) → update ledger
```

Delta computation happens on **typed objects**, not on text. This means:
- Messages are diffed by ID — only new messages are rendered
- User profiles are diffed by userId — unchanged profiles are skipped
- Topic digests are diffed structurally — only new/updated topics appear

Because the static and unchanged portions of the prompt remain identical across turns, LLM API-level prompt caching (e.g., Anthropic's cache, Gemini's context caching) can match long prefixes. The subagent executor module achieves **90%+ cache hit rates** on DeepSeek V4 Flash in production.

### Context Manifest

Every render produces a `ContextManifest` — a structured summary of all sections with their token counts, cache/history strategies, change status, and content previews. This manifest is broadcast to the dashboard, letting you see exactly which parts of the prompt are cached, which are delta, and which are ephemeral — per LLM call, in real time.

```typescript
interface ContextManifest {
  sections: Array<{
    name: string;
    label: string;
    cache: CacheStrategy;
    history: HistoryStrategy;
    renderedChars: number;
    estimatedTokens: number;
    changed: boolean;
    deltaStats?: { total: number; added: number; unchanged: number };
    contentPreview: string;
  }>;
  summary: {
    totalTokens: number;
    historicalTokens: number;
    ephemeralTokens: number;
  };
}
```

### Two Context Engines, Same Abstraction

The system runs two independent Context Engine instances:

1. **Meta Engine** — for the Meta Agent's global orchestration sessions. Providers: session digests, todos, callbacks, attend headers, topic digests, messages, group model, user profiles, decision prompts.

2. **Executor Engine** — per-group, for CodeAct Executor task prompts. Providers: task header, decisions, topic summary, person context, memory context, quoted context, target messages, stickers, grounding, footer instructions.

Both share the same `ContextEngine` class and `SectionProvider` interface. The ledger is scoped by `chatId` for the executor engine, enabling independent delta tracking per group.

---

## 8. Attention Accumulator

The Attention Accumulator replaces a simple FIFO queue with a **priority-aware, pressure-scored batching system** that decides which groups the Meta Agent should attend to next.

### Three-Layer Priority

| Layer | Trigger | Behavior |
|-------|---------|----------|
| **Layer 0 (Red)** | Direct mentions, DMs, @ notifications | Immediate preemption |
| **Layer 1 (Yellow)** | Callbacks (Q5), scheduled reminders, wake conditions | Accumulate in time window |
| **Layer 2 (Green)** | Topic signals from Recording Pipeline | Pressure-based release |

### Pressure Scoring

For Layer 2 items, a dynamic pressure score determines priority:

```
pressure = volume × stickiness × ageFactor × ignoredPenalty

where:
  volume     = participantMsgCount × avgCharCount × dunbarTierWeight
  stickiness = CORE: 2.0 | FAMILIAR: 1.2 | ACQUAINTANCE: 0.8 | STRANGER: 0.5
  ageFactor  = 1 + 0.02 × minutesSinceEnqueue
  ignoredPenalty = 0.3 if previously ignored, else 1.0
```

### Flush Behavior

- **Window-based batching** (default 5s): accumulates items, then flushes top-N (default 3) to the Meta Agent
- **Layer 0 preemption**: direct mentions bypass the window and trigger immediate processing
- **Dequeue history**: tracks last 50 dequeued items for analysis
- **Chat blocking**: specific chats can be temporarily blocked (e.g., during post-task windows)

---

## 9. Recording Pipeline & Topic Registry

The Recording Pipeline runs in the background, continuously analyzing incoming messages to extract and track conversation topics.

### Pipeline Stages

```
Messages arrive (buffered)
  │
  │  Thresholds: 50 msgs (normal) / 15 msgs (eager)
  │  Timeouts:   2 min (normal) / 30 sec (eager)
  │  Eager mode triggered by: mention keywords, strong signals
  │
  ▼
Stage 1: Topic Clustering (cheap LLM)
  Group messages into topic clusters
  │
  ▼
Stage 2: Topic Triage + Summarization (cheap LLM)
  Summarize each cluster, decide triage status
  │
  ▼
Stage 3: Topic Registry Update
  Upsert topics with lifecycle: ACTIVE → STALE → ARCHIVED
  Track participants, sentiment, keywords, key points
  │
  ▼
Stage 4: Memory Write
  Store to Memory V2: upsertTopic, storeMessageBatch, incrementProfileStats
  │
  ▼
Topic Signals → Attention Accumulator (Layer 2)
```

### Topic Registry

The Topic Registry maintains a live view of all detected topics across all groups:
- Topic lifecycle management (ACTIVE/STALE/ARCHIVED)
- Engagement tracking (which topics the agent has responded to)
- Participant lists and sentiment analysis
- Keywords and key points for quick retrieval
- Callback potential scoring (likelihood of topic revival)

---

## 10. Memory V2: Three-Layer Memory

### Layer 1: Short-Term (Working Memory)

The current conversation context — messages the LLM can directly see. Managed by the Context Manager with:
- **Token budgeting**: Allocates percentages for system prompt, briefing, recent history, output reserve
- **Smart compaction**: When approaching context limits, classifies messages, protects ENGAGED topic messages and reply chains, compresses the rest with a cheap model
- **Topic continuity**: Messages from actively engaged topics are shielded from compaction

### Layer 2: Medium-Term (Episodic + Social)

SQLite-backed structured records with hours-to-days retention:

| Table | Content |
|-------|---------|
| `TopicNode` | Persistent topics with label, summary, participants, sentiment, keywords, lifecycle |
| `PersonGroupProfile` | Per-group user portraits with Dunbar tier, interaction patterns, sentiment |
| `GroupModel` | Chat characteristics: title, description, norms, typical behavior |
| `InteractionEpisode` | Temporal clusters of user interactions |

### Layer 3: Long-Term (Semantic + Identity)

Stable, cross-group knowledge:

| Table | Content |
|-------|---------|
| `PersonProfile` | Global user characteristics: traits, interests, communication style |
| `CoreFact` | Extracted facts with categories (biographical, preference, anecdote, opinion, plan, relationship), confidence, sensitivity, visibility |

### Dunbar Tier System

Users are ranked into relationship tiers based on interaction frequency and quality:

| Tier | Multiplier | Profile Detail |
|------|-----------|----------------|
| CORE | 2.0x | Full traits, interests, communication style |
| FAMILIAR | 1.2x | Moderate detail |
| ACQUAINTANCE | 0.8x | Basic info |
| STRANGER | 0.5x | Minimal |

Affinity scores are computed via percentile ranking + quality delta + time decay, with automatic tier downgrade when capacity is exceeded.

### Recall API

Unified retrieval with three-layer search:
1. **Vector search**: Embedding-based semantic similarity (cosine/dot/euclidean/manhattan)
2. **FTS5 search**: Full-text search on stored text
3. **LIKE fallback**: Pattern matching when above methods fail

Supports facts, topics, persons, and history browsing by date range.

### Reflection Engine

LLM-driven periodic self-reflection:
- **Triggers**: 2h silence, 24h max interval, off-hours periods
- **Process**: Collect interactions → quantify engagement → LLM analysis → update profiles → merge episodes → trim tiers
- **Outputs**: Updated PersonProfiles, new/modified/deleted CoreFacts, topic sentiment

---

## 11. Multi-Platform Adapters

A unified `PlatformAdapter` interface abstracts platform differences:

| Adapter | Library | Features |
|---------|---------|----------|
| **Telegram** | `@mtcute/node` | Bot + Userbot modes, media caching, invisible user tracking, TL passthrough |
| **Discord** | `discord.js` | Gateway lifecycle, auto-reconnect with exponential backoff, CDN media |
| **OneBot (QQ)** | WebSocket (NapCat) | Request-response tracking, nickname caching, whitelist filtering |

All adapters provide: `start()`, `stop()`, `canHandle()`, `handleCall()`, optional media download, mention formatting, muting, and read receipts.

Messages from all platforms flow into the same NotificationCenter, and the agent's code in the sandbox calls platform-specific APIs transparently.

---

## 12. LLM Pool & Multi-Model Routing

### Component-Level Routing

Different system components can be routed to different LLM providers and models:

| Component | Typical Assignment | Reason |
|-----------|-------------------|--------|
| `meta` | High-capability model (Gemini Pro, Claude) | Complex orchestration |
| `session` | Mid-tier model (DeepSeek, Gemini Flash) | Cost-efficient dialogue |
| `recording_cluster` | Cheapest model (Gemini Flash) | Background batch processing |
| `recording_triage` | Cheap model | Background summarization |
| `reflection` | Mid-tier model | Periodic analysis |
| `compact` | Cheap model | Context compression |
| `memory` | Mid-tier model | Recall and search |
| `vision` | Multimodal model (Claude, Gemini) | Image understanding |

### Load Balancing Pool

Each LLM profile supports multiple API keys with load balancing:

- **Strategies**: `round_robin`, `least_pending`, `random`
- **Fault handling**: Exponential backoff for 429/quota errors (5s → 120s), immediate disable for auth errors, circuit breaker when all keys are cooling down
- **Per-key tracking**: Pending request count, consecutive errors, cooldown timestamps

### Provider Support

Four LLM providers supported natively: `anthropic`, `openai`, `google` (Gemini), `openai_responses` (OpenAI Responses API). Each with provider-specific features like thinking levels (Gemini), prefill support (Anthropic), and custom error pattern matching.

---

## 13. Web Dashboard

A real-time Svelte SPA with 13+ panels for monitoring and debugging every aspect of the system:

| Panel | What It Shows |
|-------|--------------|
| **Messages** | Real-time per-group message stream with auto-scroll |
| **Topics** | Live topic states (ACTIVE/STALE/ARCHIVED) with engagement status |
| **Queue** | Attention accumulator entries with boost/remove controls |
| **Decisions** | Meta Agent decision traces |
| **CodeAct** | Per-group executor session traces with real-time code execution |
| **Subagent Tasks** | Task dispatch history and status |
| **LLM Log** | Detailed LLM API call logs with full request/response, token usage, **and Context Manifest** |
| **Token Stats** | Token consumption analytics with per-model pricing |
| **Memory** | Search, browse, and edit memory entries (facts, profiles, topics) |
| **Stickers** | Sticker/emoji catalog with frequency and preview |
| **Skills** | Skill browser and management |
| **MCP** | MCP server connections and tool discovery |
| **Config** | Live configuration editor with validation and hot-reload |
| **System** | Health metrics, version info, sandbox pool, scheduler |

### Technical Stack

- **Backend**: Express HTTP + WebSocket server with token authentication
- **Frontend**: Svelte SPA with 5-second polling + WebSocket push for real-time updates
- **Event Bridge**: Bridges internal NotificationCenter events to WebSocket clients
- **Light/dark mode**: Auto-follows system preference

### Context Manifest in LLM Log

The LLM Log panel is particularly powerful for debugging context assembly. Each LLM call displays its Context Manifest, showing:
- Which sections are **static** (cached across turns)
- Which are **delta** (only new content sent)
- Which are **ephemeral** (current turn only)
- Exact token counts per section
- Content previews for quick inspection

This makes it trivial to understand *why* a particular LLM call had a certain cache rate, and to tune providers for better efficiency.

---

## 14. Telemetry & Observability

### Prometheus Metrics

Exposed on localhost in Prometheus text format (pull-compatible):

| Category | Metrics |
|----------|---------|
| **LLM Tokens** | Usage by model/caller/provider, cached tokens, cache write tokens |
| **LLM Performance** | Request latency histograms, TPS histograms, error/retry rates |
| **Group Stats** | Engagement scores, message buffers, queue sizes, attend decisions |
| **System Health** | Main loop ticks, heap usage, sandbox pool, uptime |

### Structured Logging

Per-component loggers with configurable levels. Key events:
- LLM calls with full token breakdown
- Dispatch/callback lifecycle
- Sandbox execution traces
- Attention accumulator decisions
- Recording pipeline flushes

---

## Appendix: Source Code Map

```
src/
├── accumulator/          # Attention Accumulator (pressure scoring, layered priority)
├── adapter/              # Platform adapters (Telegram, Discord, OneBot)
├── context-engine/       # Context Engine core + providers
│   ├── providers/        # Meta, Executor, Pipeline, Common providers
│   ├── context-engine.ts # Core engine (register, render, commit)
│   ├── context-ledger.ts # Delta tracking ledger
│   └── types.ts          # CacheStrategy, HistoryStrategy, SectionProvider
├── core/                 # Config, IDs, LLM clients, logger, timezone
│   └── llm/              # Anthropic, OpenAI, Google, Responses API clients
├── dashboard/            # Web dashboard (Express + WS server, Svelte UI)
│   └── ui/src/           # Svelte components (13+ panels)
├── main-agent/           # Main Agent Loop, Meta Session Handler, GlobalState
├── memory-v2/            # Three-layer memory (SQLite + embeddings)
├── meta-sandbox/         # Meta Agent sandbox (VM, session runner)
│   └── meta-api/         # Orchestration APIs (dispatch, conversations, memory...)
│       └── modules/      # .d.ts type definitions for Meta APIs
├── pipeline/             # Recording Pipeline, Topic Registry
├── sandbox/              # CodeAct Sandbox (host + worker + modules)
│   └── modules/          # Built-in module implementations
├── skills/               # Skill loader, DTS parser
├── subagent/             # Subagent Manager, CodeAct Executor, Callback Queue, Observer
└── main.ts               # Entry point

system-prompts/           # Prompt templates (meta, executor, memory, recording)
workspace/                # Runtime data (DB, sessions, skills, media)
docs/                     # Architecture and design documents
```
