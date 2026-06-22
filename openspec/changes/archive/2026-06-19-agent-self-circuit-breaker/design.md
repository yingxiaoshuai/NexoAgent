## Context

Nexo Agent executes tool-calling turns in `electron/server/agent.ts`. The current loop stops when the model stops calling tools, a special file-tool boundary guard blocks repeated file access failures, or the configured `maxSteps` limit is reached. Settings expose `maxSteps` with a UI maximum of 100, so production protection is mostly a fixed call-count cap.

That fixed cap is necessary but not sufficient. A failed task can repeatedly call the same tool, alternate between equivalent failing tools, or make no observable progress while still staying below the cap. The harness needs code-level runtime judgment that can stop early and explain why.

## Goals / Non-Goals

**Goals:**

- Detect runaway agent/tool behavior before the absolute `maxSteps` limit is exhausted.
- Keep stop decisions deterministic, local, and testable without calling an LLM.
- Preserve the existing final-response behavior by asking the model for a no-tools summary when possible.
- Include machine-readable stop metadata in stream completion so logs and UI can display the stop reason.
- Provide conservative default thresholds that work without user configuration, while allowing tuning from settings.

**Non-Goals:**

- Replacing `maxSteps`; it remains the hard final cap.
- Building a full token billing system or provider-specific cost calculator.
- Changing individual tool executor semantics beyond feeding their results into the breaker.
- Adding background cancellation across all running tools. The breaker evaluates between completed model/tool steps.

## Decisions

### Add a Pure Circuit Breaker Evaluator

Create a small runtime module, for example `electron/server/agent-loop-circuit-breaker.ts`, that owns loop state and exposes methods such as:

- `recordModelTurn(step, content, toolCalls, usage)`
- `recordToolResult(toolCall, output, elapsed)`
- `evaluate(): CircuitBreakerDecision`

The evaluator returns `{ action: "continue" }` or `{ action: "stop", reason, detail }`. It does not push SSE events, mutate LangChain messages, or call tools.

Alternative considered: inline all checks in `agent.ts`. That is faster to write but harder to test and likely to become tangled with streaming, DSML parsing, and tool execution.

### Use Multiple Runtime Signals Instead of One Counter

The breaker should inspect a compact per-run history and stop on these default signals:

- Repeated equivalent tool calls: same tool name plus normalized arguments repeated beyond a threshold without new useful output.
- Consecutive tool failures: tool outputs beginning with `Error:`, `[BLOCKED]`, timeout messages, or known boundary failures exceed a threshold.
- No progress: consecutive steps produce no visible assistant content and only low-value or duplicate tool results.
- Token pressure: accumulated prompt/completion usage exceeds a configurable run budget when usage metadata is available.
- Wall-clock pressure: elapsed runtime exceeds a configurable maximum before `maxSteps`.

Alternative considered: ask the model to self-report whether it is stuck. That can help final wording, but the stop decision must be enforced by code because the failure mode is often caused by the model itself.

### Keep `maxSteps` as an Absolute Backstop

The existing loop should continue to use `settings.maxSteps` as the upper bound in the `for` loop. The circuit breaker runs after each model/tool step and can set `reachedCircuitBreaker = decision` before breaking early. The existing `reachedToolStepLimit` path remains for the hard cap.

Alternative considered: replace `maxSteps` with dynamic thresholds only. That removes a simple worst-case bound and makes production behavior harder to reason about.

### Finalize With a No-Tools Summary

When the breaker stops a run, `agent.ts` should request a final assistant response using the current `lcMessages` plus a system message that includes the stop reason and forbids tool calls. If the model returns no visible content, use a deterministic fallback in the user's language that states the stop reason and that work is incomplete.

Alternative considered: immediately return a canned stop message. That is safer but produces worse UX because the model can often summarize partial results usefully without more tools.

### Add Settings With Safe Defaults

Add settings fields with defaults through `AgentSettings`, `defaultSettings`, `buildRuntimeSettings`, and the settings form:

- `enableAgentCircuitBreaker`: default `true`
- `circuitBreakerRepeatedToolCallLimit`: default `3`
- `circuitBreakerConsecutiveFailureLimit`: default `3`
- `circuitBreakerNoProgressLimit`: default `4`
- `circuitBreakerMaxRuntimeMs`: default `600000`
- `circuitBreakerTokenBudget`: default `0` for disabled token-budget stopping

These fields should be optional-tolerant when reading old saved settings.

Alternative considered: one preset dropdown only. Presets are simpler for users, but explicit numeric fields are more useful for production tuning and debugging.

### Extend Stream Completion Metadata

Extend the `done` stream event with optional circuit-breaker metadata:

- `stopReason`: `"model_complete" | "max_steps" | "circuit_breaker"`
- `circuitBreaker?: { reason: string; detail: string; step: number }`

The UI can initially ignore unknown fields, while logs and future UI work can show the reason.

Alternative considered: emit a new SSE event type. Reusing `done` keeps the lifecycle unchanged and avoids requiring a new frontend event branch to complete streams.

## Risks / Trade-offs

- False positive stop on legitimate repeated polling or retries -> Use conservative thresholds and allow disabling/tuning in settings.
- False negative on novel runaway patterns -> Keep `maxSteps` as a hard cap and structure the evaluator so new signals can be added.
- Token usage metadata is not always available -> Token-budget stopping only applies when usage exists; other signals still protect the run.
- Final no-tools summary could still be empty or malformed -> Provide deterministic fallback content and strip DSML/tool-call markup as today.
- Additional settings increase UI complexity -> Group advanced breaker settings near existing max tool steps and keep defaults suitable for most users.

## Migration Plan

1. Add optional settings with defaults so existing saved settings load without migration.
2. Add the evaluator and unit tests for each stop reason.
3. Integrate evaluator into `agent.ts` behind `enableAgentCircuitBreaker`.
4. Extend stream metadata and keep frontend handling backward-compatible.
5. Rollback by setting `enableAgentCircuitBreaker` to `false`; `maxSteps` remains active.

## Open Questions

- Should token-budget stopping default to disabled (`0`) or to a conservative enabled value after enough provider usage data is observed?
- Should stop metadata be persisted in assistant messages later, or is stream/log visibility enough for the first implementation?
