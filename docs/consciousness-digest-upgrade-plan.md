# Consciousness Digest & Dream Harness Upgrade

## Overview

This document tracks the upgrade from short-lived JSON session digests and a separate proactive-idle path to a DB-backed consciousness memory and harness-driven idle flow.

Goals:

- Store session digests permanently in `memory.db`.
- Make digests searchable as first-class memory, including agent intentions and follow-up thoughts.
- Preserve source metadata so every agent can tell which actor/chat/task produced a digest.
- Route idle/proactive work to the consciousness/background harness instead of directly waking Meta when a harness is configured.
- Keep old config names and compatibility wrappers during migration.

## Current Implemented Baseline

- Existing MCP tools already expose conversation, memory, agents, skills, todo, scheduler, digest, notify, and sandbox/platform access.
- Existing `notify(to: "meta")` can wake Meta by adding a `BACKGROUND_AGENT` attention item.
- Existing `workspace/background-dreaming.md` is generated before harness launch from recent dispatched subagent work and group/person profiles.
- Existing ContextEngine digest providers already use `delta-only` per-agent ledgers.
- Existing proactive-idle path injected a synthetic `PROACTIVE_IDLE` Meta attention item from `MainAgentLoop`.

## Target Architecture

- `session_digests` in SQLite is the authoritative permanent digest store.
- `GlobalState.addSessionDigest()` remains as a compatibility wrapper and delegates to SQLite after startup wiring.
- Meta/Subagent digest injection reads the latest 30 DB digests and remains `delta-only`; each agent only sees newly unseen records after its first render.
- The consciousness harness starts with recent global digest context in addition to dispatched task retrospectives.
- Harnesses use structured `attention_enqueue` / `attention_callback` with run id, actor id, trigger reason, observed refs, summary, requested action, and source chat/task metadata.
- If a harness is configured, proactive idle is routed to harness as `consciousness_tick`; deployments without a harness retain the old Meta fallback.

## DB Schema

`session_digests` fields:

- `id`, `created_at`, `kind`, `actor_type`, `actor_id`
- `source_chat_id`, `source_chat_title`, `target_chat_id`
- `task_id`, `run_id`, `content`, `tags`, `importance`
- `visibility`, `metadata`, `embedding`

Indexes:

- created time, source chat, actor, kind
- FTS table over content, tags, actor id, and source chat title
- vec table for optional digest embeddings/backfill

## API Contracts

- Memory store:
  - `appendSessionDigest()`
  - `migrateLegacySessionDigests()`
  - `listSessionDigests()`
  - `searchAgentMemory()`
  - `getTimeline()`
- Meta/MCP/sandbox memory APIs expose agent memory search and timeline.
- MCP structured harness tools:
  - `attention_enqueue`
  - `attention_callback`
  - `harness_enqueue`
  - `harness_status`
- Existing `session_digests` MCP tool continues to work through the `GlobalState` compatibility adapter.

## Migration Plan

- On startup, read legacy `global-state.json.sessionDigests`.
- Insert them into SQLite as `kind=legacy`, `actorType=system`, `tags=["legacy"]`.
- Use deterministic legacy ids from createdAt + content so migration is idempotent.
- Do not delete or mutate legacy JSON digest data; keep it for audit.

## Migration Status

- Implemented: startup migration runs after `GlobalState` and `MemoryStoreV2` are initialized.
- Implemented: `GlobalState.addSessionDigest()` delegates to `memory.db` once the adapter is wired.
- Implemented: legacy JSON fallback remains capped at 30 only when no DB adapter exists, primarily for old tests/offline utilities.
- Implemented: dashboard reads session digest summaries through `GlobalState.getSessionDigests()`, so the DB adapter is visible in existing UI/API paths.
- Preserved for audit: legacy JSON digest rows are not deleted by migration or dashboard reset.

## Implementation Checklist

- [x] Branch created: `codex/consciousness-digest-memory`.
- [x] SQLite table, FTS table, and vec table for session digests.
- [x] Memory store append/list/search/timeline APIs.
- [x] Legacy JSON digest migration.
- [x] GlobalState digest adapter compatibility bridge.
- [x] Default digest injection window raised to 30.
- [x] Digest render includes source/kind/task/run metadata when present.
- [x] Harness startup context includes recent session digests.
- [x] Structured MCP attention/harness tools.
- [x] Harness source is allowed in dispatch records.
- [x] Proactive idle routes to harness when configured, with Meta fallback otherwise.
- [x] Tests added/updated for migration, adapter writes, DB digest search, timeline, structured MCP attention/callback tools, privacy scrub, idle harness routing, and 30-record injection.
- [ ] Audit privacy behavior for permanent digest records in real deployments.
- [ ] Add async embedding backfill command for historical session digests.

## Test Matrix

- DB schema creation and legacy migration idempotency.
- `GlobalState.addSessionDigest()` adapter delegation.
- DB digest search with source metadata.
- Context providers render recent 30 and keep delta-only behavior.
- Meta memory API returns DB-backed digest results.
- Sandbox and MCP APIs expose agent memory and timeline.
- Structured MCP attention/callback tools write digest records and wake/forward as requested.
- Harness callback can record digest and wake Meta.
- Proactive idle does not directly wake Meta when harness is configured.
- Privacy scrub drops permanent digest records whose source chat is private to the current sandbox.

## Audit Notes

- Permanent digests may contain agent thoughts and cross-chat orchestration context; reviewers should check privacy scrubbing around `source_chat_id`.
- Dashboard clear currently only clears legacy JSON state through `GlobalState`; permanent DB records are intentionally retained.
- Digest embedding support is schema-ready but synchronous digest writes do not call embedding generation inline.
