# agent-loop-circuit-breaker Specification

## Purpose
TBD - created by archiving change agent-self-circuit-breaker. Update Purpose after archive.
## Requirements
### Requirement: Runtime Circuit Breaker Evaluation
The system SHALL evaluate agent loop health during each assistant response and stop tool execution before the configured hard step cap when runtime signals indicate a runaway or non-progressing loop.

#### Scenario: Repeated equivalent tool calls are stopped
- **WHEN** an assistant response repeatedly requests the same tool with equivalent normalized arguments beyond the configured repeated-call threshold
- **THEN** the system SHALL stop further tool execution for that response with a circuit-breaker reason identifying repeated tool calls

#### Scenario: Consecutive tool failures are stopped
- **WHEN** consecutive tool results are failures, blocked operations, or timeout-like errors beyond the configured failure threshold
- **THEN** the system SHALL stop further tool execution for that response with a circuit-breaker reason identifying repeated failures

#### Scenario: No-progress loop is stopped
- **WHEN** consecutive loop steps produce no visible assistant progress and no useful new tool result beyond the configured no-progress threshold
- **THEN** the system SHALL stop further tool execution for that response with a circuit-breaker reason identifying no progress

### Requirement: Hard Step Cap Preservation
The system SHALL keep the configured maximum tool-step limit as an absolute upper bound even when the circuit breaker is enabled.

#### Scenario: Circuit breaker does not extend max steps
- **WHEN** the circuit breaker does not stop a response before the configured maximum tool-step limit
- **THEN** the system SHALL stop at the maximum tool-step limit using the existing hard-cap behavior

#### Scenario: Circuit breaker disabled
- **WHEN** circuit breaker protection is disabled in settings
- **THEN** the system SHALL continue to enforce the configured maximum tool-step limit

### Requirement: Final Response After Circuit Break
The system SHALL produce a final assistant response after a circuit-breaker stop without allowing additional tool calls.

#### Scenario: Model summarizes partial progress
- **WHEN** the circuit breaker stops tool execution and the model can produce a no-tools final response
- **THEN** the system SHALL stream that final response to the user and include the stop reason in the completion metadata

#### Scenario: Model produces no final content
- **WHEN** the circuit breaker stops tool execution and the no-tools final response is empty or unusable
- **THEN** the system SHALL return deterministic fallback content that explains the stop reason and that the task may be incomplete

### Requirement: Configurable Thresholds
The system SHALL provide persisted settings with safe defaults for enabling the circuit breaker and tuning repeated-call, failure, no-progress, runtime, and token-budget thresholds.

#### Scenario: Existing settings load safely
- **WHEN** saved settings do not contain circuit-breaker fields
- **THEN** the system SHALL apply default circuit-breaker settings without requiring manual migration

#### Scenario: User tunes thresholds
- **WHEN** a user changes circuit-breaker settings in the settings UI and saves them
- **THEN** subsequent agent responses SHALL use the saved thresholds

### Requirement: Stop Metadata
The system SHALL expose machine-readable stop metadata when a response ends because of the circuit breaker.

#### Scenario: Completion includes circuit-breaker metadata
- **WHEN** a response ends because the circuit breaker stopped tool execution
- **THEN** the done stream event SHALL include a stop reason of `circuit_breaker` and include the specific breaker reason, detail, and step number

#### Scenario: Normal completion remains backward-compatible
- **WHEN** a response ends normally or by the hard step cap
- **THEN** the done stream event SHALL remain consumable by existing clients that only read content and usage fields

