## ADDED Requirements

### Requirement: Reduced Built-in Tool Catalog
The system SHALL expose a reduced built-in agent tool catalog that keeps `shell_command`, `invoke_model`, and `recall_memory`, routes multimodal specialist work through `invoke_model`, and removes dedicated file, HTTP, skills, scheduled-task, and calculator tools from the default runtime.

#### Scenario: Preserved tools remain available
- **WHEN** the tool registry loads bundled tools for the default runtime
- **THEN** it SHALL include `shell_command`, `invoke_model`, and `recall_memory`

#### Scenario: Removed tools are absent
- **WHEN** the tool registry loads bundled tools for the default runtime
- **THEN** it SHALL not expose `file_read`, `file_write`, `web_search`, `http_request`, `search_skills`, `install_skill`, `create_skill`, `create_scheduled_task`, `analyze_image`, `generate_image`, `edit_image`, `transcribe_audio`, `synthesize_speech`, or `calculator`

### Requirement: Shell Command as Primary Operational Surface
The system SHALL treat `shell_command` as the primary built-in operational tool for filesystem and command-line workflows after dedicated file and HTTP tools are removed.

#### Scenario: Operational prompt guidance prefers shell command
- **WHEN** the orchestrator prompt is assembled for a chat request
- **THEN** it SHALL instruct the model to use `shell_command` for general operational tasks instead of removed utility tools

#### Scenario: Removed operational tools are not suggested
- **WHEN** the runtime builds prompt guidance or tool descriptions
- **THEN** it SHALL not instruct the model to use removed file, HTTP, skills, or scheduled-task tools

### Requirement: Backward-Compatible Tool Settings Loading
The system SHALL tolerate existing saved tool settings that reference removed tools and normalize them to the reduced runtime.

#### Scenario: Saved settings contain removed tool names
- **WHEN** the runtime loads a saved enabled-tools list created before tool reduction
- **THEN** removed tool names SHALL be ignored and the normalized settings SHALL continue loading successfully

#### Scenario: Normalized settings are persisted
- **WHEN** the runtime detects removed or unknown tool names in saved settings
- **THEN** it SHALL persist an updated enabled-tools list containing only supported tool names
