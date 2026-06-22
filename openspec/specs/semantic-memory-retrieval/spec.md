# semantic-memory-retrieval Specification

## Purpose
TBD - created by archiving change daily-memory-dream-embeddings-sqlite. Update Purpose after archive.
## Requirements
### Requirement: Chroma vector persistence
The system MUST persist embeddings for recallable memories in the local Chroma collection at `.nexo-data/chroma/` (`nexo_memories`), linked to SQLite memory rows by `memory_id`.

#### Scenario: Store memory with embedding credentials
- **WHEN** a memory is stored and embedding credentials are available
- **THEN** after SQLite write succeeds, the system upserts the vector and metadata (`kind`, `day_key`) to Chroma for that `memory_id`

#### Scenario: Delete embedded memory
- **WHEN** a memory is deleted
- **THEN** the SQLite row is removed and the Chroma vector for that `memory_id` is deleted

#### Scenario: Update memory content
- **WHEN** an existing memory's content is updated
- **THEN** the SQLite row is updated and Chroma upserts the same `memory_id` vector and document content

### Requirement: Chroma semantic recall
The system MUST rank recall results with Chroma similarity search when possible, and fall back to SQLite keyword plus recency ranking when Chroma or embedding is unavailable.

#### Scenario: Query vector available and Chroma healthy
- **WHEN** a recall query can be embedded and the Chroma collection is available
- **THEN** the system returns top results from Chroma similarity search with optional `kind` / `day_key` metadata filters and hydrates full memory fields from SQLite by `memory_id`

#### Scenario: Chroma or embedding unavailable
- **WHEN** embedding generation fails, no API key is configured, or Chroma initialization/query fails
- **THEN** the system returns relevant memories using SQLite keyword and recency ranking without throwing an error

### Requirement: Filtered memory search
The system MUST support semantic memory search filtered by memory kind, `day_key`, and result count, preferring Chroma metadata `where` filters.

#### Scenario: Search one day
- **WHEN** semantic search is requested with `dayKey=20260616` and `k=5`
- **THEN** at most five matching memories from that day are returned

#### Scenario: Search selected kinds
- **WHEN** semantic search is requested for `daily` and `dream` kinds
- **THEN** long-term and script memories are excluded from the Chroma candidate set

### Requirement: Chroma and SQLite consistency recovery
The system MUST handle missing or inconsistent Chroma vectors and backfill vectors when credentials become available.

#### Scenario: SQLite row exists without Chroma vector
- **WHEN** recall or background checks find a `memory_id` in SQLite without a corresponding Chroma vector
- **THEN** the row can still participate through SQLite keyword/recency fallback, and Chroma can be backfilled when credentials are available

#### Scenario: Embedding credentials become available later
- **WHEN** credentials become available for a memory row that lacks a Chroma vector
- **THEN** the system can upsert the Chroma vector without changing the SQLite memory id or content

### Requirement: Memory Recall Preserved In Minimal Runtime
Semantic memory recall SHALL remain available in the reduced built-in toolset and continue serving as a structured non-shell context source for the orchestrator.

#### Scenario: Recall memory remains available after tool reduction
- **WHEN** the reduced runtime loads its preserved built-in tools
- **THEN** semantic memory recall SHALL remain callable through the preserved memory tool path

#### Scenario: Missing removed tools do not disable memory recall
- **WHEN** dedicated file, HTTP, skills, and scheduled-task tools are removed from the runtime
- **THEN** memory retrieval SHALL continue functioning without depending on those removed tools

