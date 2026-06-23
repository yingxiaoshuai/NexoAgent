## 1. Extend model profile and settings metadata

- [x] 1.1 Add optional context-budget fields to shared model profile and settings types for context window, reserved output tokens, auto-compact threshold, and compaction target ratio.
- [x] 1.2 Persist the new context-budget fields in model profile storage and keep backward compatibility for older saved profiles.
- [x] 1.3 Add a maintained local model-context dictionary and lookup helpers that resolve context window by override, dictionary entry, provider metadata, or persisted cache.
- [x] 1.4 Add first-use lookup persistence metadata so resolved model context windows can be stored with provenance and reused on later calls.
- [x] 1.5 Update model discovery to infer context-budget defaults when provider metadata is available and fall back safely when it is not.
- [ ] 1.6 Expose the new context-budget controls in the Settings model profile editor with sensible defaults, provenance display, and help text.

## 2. Add token-aware budgeting primitives

- [x] 2.1 Implement a reusable token estimation utility based on the agreed Chinese and English character-to-token heuristics.
- [x] 2.2 Add runtime helpers that compute per-request input budget from context window, reserved output, tool schema reserve, and configurable compact thresholds.
- [x] 2.3 Implement a one-time first-use model-context lookup flow for unknown models and persist the resolved context budget locally.
- [x] 2.4 Capture provider-reported `usage` from model responses and make it available to runtime budgeting and diagnostics in the current run.

## 3. Replace turn-count compaction with budget-aware compaction

- [x] 3.1 Refactor prompt assembly in `electron/server/agent.ts` to evaluate prompt pressure against the active model budget before each model request.
- [x] 3.2 Trigger automatic compaction when the estimated prompt budget reaches the configured threshold instead of relying only on message-count limits.
- [x] 3.3 Keep only a recent raw turn window in prompt context and rebuild older history into a rolling session summary.
- [x] 3.4 Support repeated compaction passes when a long session still exceeds the target prompt budget after one pass.

## 4. Separate rolling thread summaries from durable memory

- [x] 4.1 Introduce storage or session-state support for rolling thread summaries that survive resume without becoming durable cross-session memories.
- [x] 4.2 Update compaction flow so thread-local summaries preserve goals, decisions, attempts, failures, constraints, and unfinished work.
- [x] 4.3 Update memory extraction rules so only stable preferences, recurring workflows, conventions, and long-lived facts are promoted to durable memory.

## 5. Budget auxiliary context sources together

- [x] 5.1 Apply shared budget accounting to memories, knowledge snippets, attachment context, and retained tool outputs during prompt assembly.
- [x] 5.2 Trim or compact lower-priority auxiliary context when it would push the prompt over the active model limit.
- [x] 5.3 Bound retained tool output context so large command or tool results do not dominate the conversation budget.

## 6. Verify behavior and document the new model

- [x] 6.1 Add focused tests or runtime checks for token estimation, compaction triggering, rolling summary behavior, and memory-boundary rules.
- [x] 6.2 Verify dictionary hits, cached reuse, and first-use lookup fallback for unknown models.
- [ ] 6.3 Verify resume and long-thread behavior with repeated compaction and ensure prompts stay within configured budgets.
- [x] 6.4 Update docs and operator-facing guidance to explain Codex-style auto compaction, token heuristics, the dictionary-plus-cache lookup path, and the difference between session summaries and durable memory.
