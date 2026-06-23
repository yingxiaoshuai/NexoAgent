## Why

The current conversation runtime compacts context based on message count and coarse character limits, but it does not understand the active model's real context budget or distinguish thread-local working context from durable memory. As sessions get longer, that makes compaction timing unreliable, wastes token budget, and risks losing important in-flight decisions, tool results, and constraints.

This change upgrades Nexo's context management to follow a Codex-style model: monitor context pressure against model token limits, automatically compact when the thread approaches the budget, preserve a rolling thread summary for current work, and extract durable memory separately so long tasks remain stable without overstuffing the prompt.

## What Changes

- Add model-level context budget metadata so the runtime can reason about `context window`, reserved output budget, and auto-compaction thresholds per active model profile.
- Resolve model context size through a layered source strategy:
  - first check a maintained local dictionary of known model context windows,
  - then use provider discovery metadata when it is trustworthy,
  - otherwise let the runtime perform a one-time AI-assisted lookup on first use and persist the discovered result for later calls.
- Introduce token-aware context estimation using the agreed heuristic: roughly `0.3 token / English character`, `0.6 token / Chinese character`, while still treating provider-reported `usage` as the source of truth whenever available.
- Replace message-count-triggered compaction with budget-triggered automatic compaction inspired by Codex: monitor remaining context space, summarize older thread history when the budget gets tight, and continue compacting as needed during longer tasks.
- Separate thread-local compaction from durable memory:
  - keep only a recent window of raw turns in the active prompt,
  - maintain a rolling session summary for the current thread,
  - extract durable memory only for stable preferences, conventions, and long-lived facts.
- Add explicit budgeting for injected context such as memories, knowledge, attachments, and tool outputs so they compete within one shared prompt budget instead of growing independently.
- Add operator-visible settings and profile fields for context window size, reserved output tokens, auto-compact threshold, and compaction target.
- Add local persistence for discovered model context metadata so the runtime can reuse resolved context limits without repeating lookup work on every session.
- Record and reuse actual usage returned by models to refine future budgeting and make the runtime more accurate over time.

## Capabilities

### New Capabilities

- `token-aware-context-management`: Defines model-budget-aware prompt assembly, automatic thread compaction, rolling session summaries, and explicit context budgeting across conversation, tools, attachments, knowledge, and memory.

### Modified Capabilities

- `model-orchestration`: The orchestrator will build prompts against a known, dictionary-backed, or persisted model context budget instead of relying only on turn-count trimming.
- `semantic-memory-retrieval`: Memory behavior will be split between thread-local summaries and durable cross-session memory so only stable facts become lasting memory.

## Impact

- Affected shared types and settings surfaces: `src/shared/types.ts`, `electron/server/settings.ts`, and the model profile/settings UI in `src/components/Settings/index.tsx`.
- Affected model profile persistence, discovery, and context budget lookup/cache logic: `electron/server/model-profiles.ts`, `electron/server/routes/model-profiles.ts`, and new supporting lookup/storage utilities if needed.
- Affected runtime prompt assembly, compaction, and token tracking: `electron/server/agent.ts`, `electron/server/agent-loop-circuit-breaker.ts`, and related tool output handling.
- Affected memory and context injection paths: `electron/server/attachments.ts`, `electron/server/knowledge.ts`, memory integration points, and any future session-summary storage.
- Affected docs and runtime guidance that describe compaction, memory, and model budgeting behavior.
