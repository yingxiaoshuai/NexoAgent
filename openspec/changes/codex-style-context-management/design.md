## Context

Nexo currently trims prompt history with a message-count heuristic: it keeps a recent window of turns, summarizes older conversation once the thread exceeds a configurable threshold, and injects that summary back as an extra system message. That keeps long threads alive, but it does not know the active model's context window, does not reserve prompt space for tool schemas or output tokens, and does not budget memory, knowledge, attachments, and tool output against one shared limit.

The requested direction is to move closer to Codex's behavior: watch how much context budget remains, compact when the thread approaches a model-aware token threshold, keep only a recent slice of raw transcript, and preserve a rolling thread summary that carries the current task forward. At the same time, durable memory should remain separate from thread compaction so only stable facts and preferences become reusable memory.

This is a cross-cutting design because it changes model profile data, runtime prompt assembly, compaction triggers, memory extraction boundaries, settings/UI surfaces, and how the runtime learns model context limits. It also introduces a token-estimation policy that must work across mixed Chinese/English content while deferring to model-reported `usage` when available.

## Goals / Non-Goals

**Goals:**

- Make context compaction trigger from model-aware token pressure rather than only turn count.
- Add configurable context budget metadata per model profile, with sane defaults and a layered lookup path that starts from a local dictionary and falls back to persisted first-use discovery.
- Preserve a rolling session summary for current-thread continuity while keeping only a small recent raw transcript in the live prompt.
- Separate thread-local summary state from durable cross-session memory extraction.
- Apply one shared budget across system prompt, recent turns, session summary, memories, knowledge, attachments, and tool outputs.
- Capture actual provider-reported `usage` when available and use it to refine budgeting decisions over time.

**Non-Goals:**

- Implement exact provider-specific tokenizer parity for every model family in this change.
- Replace the existing semantic memory backend or redesign SQLite/Chroma storage.
- Introduce full sub-agent orchestration as part of context management.
- Guarantee that discovered providers always return authoritative context-window metadata.
- Build a generic internet search subsystem for arbitrary model benchmarking beyond the one-time context-window lookup path.

## Decisions

### Resolve model context limits through dictionary-first lookup with persisted fallback

Each saved model profile will gain explicit optional fields for `contextWindowTokens`, `reservedOutputTokens`, `autoCompactTokenLimit`, and `compactionTargetRatio`. The runtime will resolve `contextWindowTokens` through a layered strategy:

1. explicit user override on the profile,
2. a maintained local dictionary keyed by model identifier patterns,
3. provider discovery metadata when it includes a credible context limit,
4. a one-time AI-assisted lookup on first use,
5. persisted cache/storage reuse for later calls.

Why:

- Provider discovery often returns model IDs but not reliable context limits.
- Many OpenAI-compatible or proxied deployments use model names that can still be recognized from a curated dictionary.
- A first-use lookup closes gaps without forcing the user to configure every unknown model by hand.
- Operators need a way to override defaults for custom or proxied OpenAI-compatible deployments.
- Budget settings belong with the model profile because they vary by model, not by conversation thread.

Alternative considered: store only global settings. Rejected because different specialist profiles can have different limits and output budgets.

Alternative considered: require manual context-window entry for every model. Rejected because it adds too much setup friction and weakens the Codex-style "just keep working" goal.

### Persist unknown-model lookups after first use

When a model's context window cannot be resolved from overrides, dictionary entries, or discovery metadata, the runtime should perform a one-time AI-assisted lookup during the model's first real use, then persist the resolved result in local storage for future sessions.

Why:

- Unknown or newly released model names will continue to appear.
- The lookup cost should be paid once, not on every request.
- Persisted results make later prompt budgeting deterministic and faster.

Alternative considered: fail closed when a model is unknown. Rejected because it would break first-run experience for custom providers and newly added model releases.

### Use heuristic token estimation plus actual usage feedback

Prompt budgeting will use an estimator for preflight decisions:

- English text: about `0.3 token / character`
- Chinese text: about `0.6 token / character`
- Digits, whitespace, punctuation, and mixed text: conservative blended handling

When the provider returns `usage`, the runtime should record that value and prefer it as the observed source of truth for subsequent steps in the same run.

Why:

- The runtime must decide whether to compact before sending the next request.
- Exact tokenizer parity across all providers is not realistic in one change.
- The user-provided heuristic is directionally correct and cheap enough for runtime use.

Alternative considered: block the change until every model has a matching tokenizer library. Rejected because it adds heavy dependencies and still fails for many custom provider proxies.

### Split context into recent transcript, rolling thread summary, and durable memory

The runtime will maintain three layers:

- recent raw turns for the current working set,
- a rolling session summary used only inside the current thread,
- durable memory entries for cross-thread reuse.

Thread summary content should keep goals, decisions, attempts, failures, constraints, file paths, and unfinished work. Durable memory extraction should keep stable facts such as user preferences, recurring workflows, project conventions, and long-lived caveats.

Why:

- Session continuity and long-term memory serve different purposes.
- Important in-flight debugging context is often too ephemeral for durable memory but too important to drop.
- This mirrors the distinction between Codex compaction and memory systems.

Alternative considered: replace compaction entirely with memory extraction and only keep a few raw turns. Rejected because memory is too lossy for active task state.

### Compact by budget bands instead of one hard step

The runtime should evaluate prompt pressure in bands:

- below threshold: keep normal assembly,
- near threshold: compact older turns into the rolling summary,
- still above target: trim injected contexts such as knowledge, attachments, or memory excerpts,
- still above target: re-compact the thread summary into a denser summary.

Why:

- Different context sources have different value and volatility.
- A single compact step can still leave the prompt over budget.
- Repeated compaction is an explicit goal of the Codex-style approach.

Alternative considered: only compact chat history and leave all other injected context untouched. Rejected because memories, knowledge, and tool output often dominate the budget.

### Reserve explicit budget slices for non-conversation context

Prompt assembly should compute a total input budget and reserve room for:

- system instructions,
- tool schema overhead,
- reserved output tokens,
- recent raw turns,
- rolling session summary,
- memories,
- knowledge,
- attachments,
- truncated tool outputs.

Each section can use defaults and caps, but all must compete within one total input allowance.

Why:

- The current runtime injects memory, knowledge, and attachments independently.
- Budget accounting is impossible if all auxiliary context is "free."

Alternative considered: keep one aggregate char limit for all injected context. Rejected because it hides where budget is being spent and makes trimming less predictable.

### Persist thread-summary state separately from durable memories

Rolling session summaries should live in thread/session state rather than the durable memory store. They can be updated on compact events and reused on resume, but they should not become global memory artifacts by default.

Why:

- Session summaries are operational state, not reusable knowledge.
- Mixing them into durable memory would pollute long-term recall with stale or task-local details.

Alternative considered: write thread summaries into script memory. Rejected because script memory is still designed for reusable workflow state rather than every long-running conversation.

## Risks / Trade-offs

- Heuristic token estimation can drift from actual provider tokenization -> Mitigation: use conservative estimates, reserve output headroom, and update runtime accounting with returned `usage` whenever available.
- More aggressive compaction can hide useful detail from the live prompt -> Mitigation: keep a small recent raw window and preserve attempted paths, errors, and constraints in the rolling summary schema.
- Added profile/settings complexity can confuse users -> Mitigation: provide defaults, infer values when possible, and treat advanced fields as optional expert controls.
- AI-assisted context-window lookup may return stale or wrong results -> Mitigation: prefer explicit overrides and curated dictionary entries first, persist provenance with the cached result, and let users edit or replace the stored value.
- Thread summaries may become stale after large direction changes -> Mitigation: regenerate summaries from current conversation slices during compaction and reset summary emphasis when goals materially change.
- Budgeting many context sources increases implementation complexity -> Mitigation: stage the rollout so profile metadata, budget estimation, prompt budgeting, and session-summary persistence land in clear increments.

## Migration Plan

1. Extend shared types and profile persistence with optional context-budget metadata, provenance fields, and defaulting rules.
2. Add a maintained local model-context dictionary plus lookup helpers that try override, dictionary, discovery metadata, and persisted cache in order.
3. Add first-use AI-assisted lookup and persistence for unknown model context windows.
4. Update model discovery and settings UI to display inferred, cached, or editable context-budget fields.
5. Replace the current turn-threshold compaction path with token-aware budget evaluation in the runtime.
6. Introduce rolling thread-summary state and keep only the recent raw turn window in prompt assembly.
7. Separate durable memory extraction rules from thread-summary generation and budget memory/knowledge/attachment injection against the same prompt limit.
8. Capture actual request `usage` where providers return it and use that signal to improve in-run budgeting and diagnostics.
9. Validate long-thread behavior, resume behavior, and fallback behavior when model metadata is missing or newly discovered.

## Open Questions

- Should rolling thread summaries be persisted inside `sessions.json`, a parallel summary file, or another lightweight session-state store?
- Do we want one universal default for `autoCompactTokenLimit`, or should it derive from a ratio of `contextWindowTokens` plus a hard floor?
- Should tool-output truncation happen at tool-result storage time, prompt-assembly time, or both?
