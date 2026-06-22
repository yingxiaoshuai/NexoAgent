## MODIFIED Requirements

### Requirement: Filtered memory search
The system MUST support semantic memory search filtered by memory kind, `day_key`, and result count, preferring Chroma metadata `where` filters. Memory injection into active prompts MUST also respect the shared model context budget instead of assuming memory context is always free.

#### Scenario: Search one day
- **WHEN** semantic search is requested with `dayKey=20260616` and `k=5`
- **THEN** at most five matching memories from that day are returned

#### Scenario: Search selected kinds
- **WHEN** semantic search is requested for `daily` and `dream` kinds
- **THEN** long-term and script memories are excluded from the Chroma candidate set

#### Scenario: Memory injection exceeds prompt budget
- **WHEN** candidate memory context would push the active prompt over its allowed budget
- **THEN** the runtime trims or prioritizes memory content so the final prompt remains within the active model limit

## ADDED Requirements

### Requirement: Durable memory is distinct from thread compaction
The system SHALL distinguish durable cross-session memory from thread-local compaction summaries and MUST NOT treat every compacted conversation summary as a lasting memory entry.

#### Scenario: Compact a long-running thread
- **WHEN** the runtime compacts a thread to save prompt space
- **THEN** it stores or reuses a thread-local summary for that session without automatically writing the summary into durable memory stores

#### Scenario: Extract long-lived memory
- **WHEN** the system identifies stable preferences, recurring workflows, project conventions, or long-lived facts
- **THEN** it MAY persist those items as durable memories for later recall across threads

### Requirement: Durable memory extraction prefers stable facts
The system SHALL bias durable memory generation toward stable, reusable information and avoid polluting memory with transient debugging state, temporary paths, or one-off execution details.

#### Scenario: Temporary debugging detail appears in thread
- **WHEN** a conversation contains one-off stack traces, temporary command output, or task-local dead ends
- **THEN** those transient details SHALL remain in thread-local compaction state rather than being promoted to durable memory by default

#### Scenario: User states a lasting preference
- **WHEN** a user confirms a stable preference or recurring workflow pattern
- **THEN** the system MAY extract that information into durable memory for later sessions
