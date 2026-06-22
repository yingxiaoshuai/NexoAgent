## 1. Settings and Types

- [x] 1.1 Add circuit-breaker fields to `AgentSettings` and `StreamEvent` done metadata types.
- [x] 1.2 Add conservative circuit-breaker defaults to desktop and web default settings.
- [x] 1.3 Ensure runtime settings construction tolerates missing saved circuit-breaker fields.
- [x] 1.4 Add settings UI controls for enabling the breaker and tuning repeated-call, failure, no-progress, runtime, and token-budget thresholds.

## 2. Circuit Breaker Evaluator

- [x] 2.1 Create a pure `agent-loop-circuit-breaker` module with normalized tool-call fingerprinting.
- [x] 2.2 Track per-run model turns, tool results, elapsed runtime, usage metadata, and progress signals.
- [x] 2.3 Implement stop decisions for repeated equivalent tool calls, consecutive failures, no progress, runtime limit, and token budget.
- [x] 2.4 Return structured decisions with action, reason, detail, and step number.

## 3. Agent Loop Integration

- [x] 3.1 Instantiate the evaluator in `streamFromLLM` when circuit-breaker protection is enabled.
- [x] 3.2 Record model turns and tool results during each existing tool loop step.
- [x] 3.3 Break out of the loop early when the evaluator returns a stop decision while preserving `maxSteps` as the hard cap.
- [x] 3.4 Generate a no-tools final response after a circuit-breaker stop and provide deterministic fallback content if the model returns nothing useful.
- [x] 3.5 Include `stopReason` and circuit-breaker details in the final done event.

## 4. UI and Persistence Compatibility

- [x] 4.1 Keep existing stream consumers backward-compatible when done events include new metadata fields.
- [x] 4.2 Persist and reload new settings through desktop IPC and backend settings routes without requiring migration.
- [x] 4.3 Optionally display circuit-breaker stop details in the chat UI or logs if existing components have a natural place for it.

## 5. Verification

- [x] 5.1 Add unit coverage for repeated tool-call, consecutive failure, no-progress, runtime, and token-budget stop decisions.
- [ ] 5.2 Add integration coverage or a focused harness test showing `streamFromLLM` stops before `maxSteps` and still returns a final done event.
- [x] 5.3 Verify disabling the circuit breaker restores existing `maxSteps`-only behavior.
- [x] 5.4 Run the project typecheck/build command and fix regressions.
