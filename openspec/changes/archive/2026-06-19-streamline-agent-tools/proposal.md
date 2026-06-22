## Why

The current tool surface is broader than needed for the product's core workflow, which increases runtime complexity, tool-selection errors, maintenance cost, and token waste. For most real tasks, `shell_command` plus model routing and memory are sufficient, while several dedicated tools duplicate capabilities without providing enough additional control or product value.

This change streamlines the agent into a smaller, more opinionated runtime so the orchestrator can choose from fewer paths and execute common tasks more reliably.

## What Changes

- **BREAKING** Remove the following built-in tools from the agent runtime and tool settings UI: `file_read`, `file_write`, `web_search`, `http_request`, `search_skills`, `install_skill`, `create_skill`, and `create_scheduled_task`.
- Keep `shell_command` as the primary general-purpose execution surface for file inspection, filesystem updates, shell workflows, and external command access.
- Keep model-routing and multimodal specialist capabilities, but funnel them through `invoke_model` so the agent still delegates to the best configured model for chat, vision, image, and audio work without extra top-level tools.
- Keep memory recall so the assistant preserves cross-session usefulness without requiring a large general-purpose tool catalog.
- Tighten system prompting and runtime guidance so the orchestrator prefers the reduced toolset instead of attempting removed flows.
- Simplify tool registry, migrations, settings defaults, and frontend tool-management surfaces to match the reduced runtime.

## Capabilities

### New Capabilities

- `minimal-agent-toolset`: Defines the reduced default runtime in which `shell_command` becomes the main general-purpose tool while `invoke_model` handles specialist model work and `recall_memory` preserves useful context.

### Modified Capabilities

- `model-orchestration`: The orchestrator's runtime contract changes to operate with a smaller tool surface and to prefer the reduced toolset over dedicated utility tools.
- `multimodal-ai-actions`: Multimodal actions remain supported after tool-surface reduction and must stay reachable through `invoke_model` capability routing without removed utility tools.
- `semantic-memory-retrieval`: Memory recall remains available after tool-surface reduction and becomes one of the few preserved non-shell tools in the default runtime.

## Impact

- Affected bundled tool definitions and defaults: `nexo/tools.json`.
- Affected runtime registry/executors: `electron/server/tools/registry.ts`, `electron/server/tools/executors.ts`, and removed executor modules that become unused.
- Affected agent orchestration prompt and loop behavior: `electron/server/agent.ts`.
- Affected frontend tool/settings surfaces: tools list UI, any copy that references removed tools, and saved tool enablement migrations.
- Affected docs and onboarding: `README.md`, `README.en.md`, and any feature docs that describe removed tools.
