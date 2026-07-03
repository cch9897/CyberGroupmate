# Consciousness Digest Upgrade — Second-Pass Fix Report

This document records the second-pass fixes after reviewing `docs/consciousness-digest-fix-report.md`.

## Summary

The Claude audit fixed several important issues, but second-pass verification found that two fixes were incomplete and two architecture goals were only partially implemented:

- `attention_enqueue` was added to TypeScript types but not to the DB normalization whitelist.
- `dispatch.ts` still passed a removed `globalState` field into quote resolution, so TypeScript failed.
- `harness_enqueue` accepted structured metadata but did not pass it into the actual harness pending context.
- Harness-originated dispatch callbacks wrote digests, but did not route the callback result back to the harness.

These issues are now addressed with minimal code changes and minimal test updates.

## Fixes

### Fix 1 — Preserve `attention_enqueue` Kind In DB

`MemoryStoreV2.normalizeSessionDigestKind()` now includes `attention_enqueue`.

Impact:

- `attention_enqueue` digests no longer degrade to `system`.
- Filtering/searching by `kind=attention_enqueue` works as intended.
- Type definitions and DB runtime behavior now agree.

Files:

- `src/memory-v2/memory-v2.ts`

### Fix 2 — Remove Stale Quote Resolver `globalState` Argument

`resolveDispatchQuoteContext()` no longer includes `globalState` in the deps pick or `resolveQuoteRefs()` call.

Impact:

- `npx tsc --noEmit` passes again.
- Claude Fix E is completed without leaving a stale object property.

Files:

- `src/meta-sandbox/meta-api/dispatch.ts`

### Fix 3 — Carry Structured Harness Enqueue Context Into Harness Pending State

`HarnessNotify` now carries structured fields:

- `actorId`
- `runId`
- `triggerReason`
- `sourceChatId`
- `sourceChatTitle`
- `taskId`
- `metadata`

`background.enqueue()` now accepts these fields as an optional third argument and passes them to `HarnessManager.enqueue()`.

`renderPendingFile()` renders the structured context into `workspace/background-pending.md`, so the launched harness can actually see the enqueue context, not just the content string.

Impact:

- Meta/harness enqueue becomes a real structured enqueue path rather than only a digest side effect.
- Third-party harnesses can pass enough context for the consciousness harness to continue the flow.

Files:

- `src/harness/types.ts`
- `src/harness/prompt.ts`
- `src/meta-sandbox/meta-api/background.ts`
- `src/meta-sandbox/meta-api/modules/background.d.ts`
- `src/mcp-server/tools/notify.ts`

### Fix 4 — Route Harness-Originated Dispatch Results Back To Harness

Dispatched task records now preserve `sourceRunId`.

`MainAgentLoop` has a `setHarnessDispatchCallbackHandler()` hook. When a dispatched task with `sourceType: "harness"` completes, the result is enqueued back to the harness as a structured `dispatch-callback` notification.

`main.ts` wires this hook to `HarnessManager.enqueue()` when a harness is configured.

Impact:

- Harness-to-subagent dispatch now has a callback route back to the harness.
- The existing digest write remains in place, so the global consciousness stream still records the result.

Files:

- `src/subagent/types.ts`
- `src/meta-sandbox/meta-api/modules/dispatch.d.ts`
- `src/meta-sandbox/meta-api/dispatch.ts`
- `src/main-agent/main-agent-loop.ts`
- `src/main.ts`

### Fix 5 — Minimal Test Synchronization

The existing MCP notify tool test was updated to match the `attention_enqueue` kind and structured `harness_enqueue` forwarding.

No broad new test suite was added.

Files:

- `tests/mcp-notify-tools.test.ts`

## Verification

Minimal verification only:

- `npx tsc --noEmit` passed.
- `pnpm exec tsx --test tests/mcp-notify-tools.test.ts` passed.

Full test suite was intentionally not run in this pass.

## Remaining Review Notes

- The codebase still contains legacy naming such as `dreaming`, `background-dreaming.md`, and `dream-journal`; these are compatibility names unless reviewers decide to perform a larger rename.
- Harness callback routing now enqueues result context back to the harness, but it does not cancel or bypass the existing Meta attention behavior for ordinary callback processing.
- `HarnessNotify.metadata` is rendered as JSON in `background-pending.md`; reviewers should check whether additional size caps are desired for very large third-party metadata.
