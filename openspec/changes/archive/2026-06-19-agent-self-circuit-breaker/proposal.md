## Why

The current agent loop primarily relies on a fixed maximum tool-step count to stop runaway behavior. In production, retry loops, repeated low-value tool calls, or stagnant model/tool interactions can burn tokens and daily quota long before a hard 100-call ceiling is reached.

This change adds code-level self circuit breaking so the harness can decide to stop based on runtime signals instead of only counting calls.

## What Changes

- Add a reusable agent loop circuit breaker that evaluates each model/tool step and can stop execution early when it detects repeated failures, repeated equivalent tool calls, no progress, excessive cost growth, or sustained timeout/error patterns.
- Keep `maxSteps` as an absolute safety cap, but make it a final backstop rather than the main production guardrail.
- Emit a clear final response when the circuit breaker stops a run, including the stop reason and what remains incomplete.
- Expose enough stop metadata through the existing stream/done path for logs or UI display.
- Add configurable thresholds with conservative defaults so users can tune behavior without changing code.

## Capabilities

### New Capabilities

- `agent-loop-circuit-breaker`: Defines runtime self-protection behavior for detecting and stopping runaway agent/tool loops before the fixed step cap is exhausted.

### Modified Capabilities

- None.

## Impact

- Affected agent runtime: `electron/server/agent.ts`.
- Affected shared settings and defaults: `src/shared/types.ts`, `electron/main.ts`, and settings persistence.
- Affected UI/API surfaces: settings form in `src/components/Settings/index.tsx`, stream events or done metadata in `electron/server/types.ts`.
- Tests or verification should cover loop-stop decisions, final response behavior, and preservation of the existing `maxSteps` hard cap.
