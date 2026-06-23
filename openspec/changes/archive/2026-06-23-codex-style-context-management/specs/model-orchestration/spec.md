## MODIFIED Requirements

### Requirement: Single primary orchestrator profile
The system MUST allow exactly one enabled model profile to be marked as the primary orchestrator, and the runtime MUST use that profile as the default planning model when one is configured. The same profile data model MUST also support optional context-budget metadata used by the runtime to manage prompt assembly and compaction.

#### Scenario: Save a new primary profile
- **WHEN** the user marks a profile as primary and saves it
- **THEN** the system clears the primary flag from any other saved profiles

#### Scenario: Use the primary orchestrator
- **WHEN** a user sends a normal chat request and a primary profile exists
- **THEN** the runtime uses that profile for planning and top-level reasoning

#### Scenario: Fall back without a primary
- **WHEN** no enabled profile is marked as primary
- **THEN** the runtime falls back to the existing default chat model settings

#### Scenario: Save profile context-budget metadata
- **WHEN** a user saves or edits a model profile with context window or compaction budget fields
- **THEN** the system persists those fields with the profile and makes them available to the runtime

#### Scenario: Store lookup provenance
- **WHEN** the system resolves a model context budget from dictionary, provider metadata, or first-use AI lookup
- **THEN** it persists the resolved value with enough provenance to explain where that budget came from

### Requirement: Capability-based specialist resolution
The system MUST resolve specialist work by capability tag rather than by raw model ID, and it MUST skip disabled profiles when selecting a specialist. Specialist and orchestrator profiles MUST expose enough budget metadata for the runtime to compact context against the active model limit.

#### Scenario: Resolve a vision specialist
- **WHEN** the runtime requests a model with the vision capability
- **THEN** the system returns an enabled profile tagged for vision work

#### Scenario: Skip a disabled match
- **WHEN** the only matching specialist profile is disabled
- **THEN** the system does not select that profile and reports that no enabled specialist is available

#### Scenario: Use specialist budget metadata
- **WHEN** the runtime selects a specialist profile for a model call
- **THEN** prompt budgeting and compaction decisions use that selected profile's explicit or inferred context budget
