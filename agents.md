# CyberGroupmate Agent Guidelines

Project-level guidelines for AI coding agents (Claude, Codex, Cursor, etc.) working on this codebase.

## Testing Philosophy

This project deliberately minimizes automated tests. The testing strategy is:

1. **Only test edge cases and boundary conditions** — write tests for tricky logic where a subtle off-by-one or null-handling bug would be hard to catch manually (e.g. FTS query sanitization, timestamp clamping, privacy scrubbing edge cases).

2. **Do NOT test full flows** — end-to-end flow verification belongs in manual e2e testing, not in automated test suites. Avoid writing tests that exercise the happy path through multiple layers (adapter → sandbox → meta → subagent → response).

3. **Do NOT add tests for every change** — when fixing a bug or adding a feature, only add a test if the fix involves a genuinely tricky edge case. Most changes should be verified through manual e2e testing.

4. **Test files live in `tests/`** — when you do write tests, use the existing `tsx --test` runner (see `package.json` scripts).
