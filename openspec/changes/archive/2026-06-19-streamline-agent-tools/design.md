## Context

Nexo Agent currently exposes a broad built-in tool catalog that mixes core runtime primitives, product-integrated actions, and convenience wrappers. The orchestrator prompt explicitly teaches the model when to use specialized tools such as file access, HTTP, skill management, scheduled tasks, and multimodal capabilities. That breadth gives flexibility, but it also creates overlap and increases the number of tool-selection branches inside the main agent loop.

The requested direction is to remove most operational and product-management tools and converge on a smaller runtime centered on `shell_command`, `invoke_model`, and memory recall. Multimodal actions stay available, but they route through `invoke_model` instead of separate top-level tools. This is a cross-cutting change because it affects bundled tool metadata, default migrations, prompt guidance, executor wiring, frontend surfaces, docs, and user expectations about what the built-in agent can do.

## Goals / Non-Goals

**Goals:**

- Reduce the default toolset so the orchestrator has fewer competing execution paths.
- Preserve the highest-value non-shell capabilities: specialist model routing, multimodal generation/analysis through `invoke_model`, and memory recall.
- Make `shell_command` the primary general-purpose execution surface for filesystem and terminal workflows.
- Remove UI and documentation references to deleted tools so the product surface matches runtime behavior.
- Keep the runtime maintainable by pruning unused executors and stale migration logic.

**Non-Goals:**

- Removing multimodal capabilities or the model-profile system.
- Replacing `shell_command` with a new universal abstraction in this change.
- Deleting all product features behind removed tools if they still exist elsewhere in the app; this change is about agent runtime exposure first.
- Reworking the memory architecture or model-profile storage format.

## Decisions

### Define a Minimal Preserved Toolset

Keep these built-in tools enabled and supported:

- `shell_command`
- `invoke_model`
- `recall_memory`

Remove these built-in tools entirely from the runtime registry and default settings:

- `file_read`
- `file_write`
- `web_search`
- `http_request`
- `search_skills`
- `install_skill`
- `create_skill`
- `create_scheduled_task`
- `analyze_image`
- `generate_image`
- `edit_image`
- `transcribe_audio`
- `synthesize_speech`
- `calculator`

This gives the orchestrator one general operational tool, one specialist-model routing surface, and one memory tool.

Alternative considered: keep removed tools as disabled-by-default options. That would reduce default noise but would keep runtime and UI complexity, migration burden, and prompt ambiguity.

### Treat Shell Command as the Default Operational Adapter

After the reduction, all general filesystem inspection, file editing, shell-based automation, and external CLI access should flow through `shell_command`. Prompt guidance in `agent.ts` should stop teaching the model about removed tools and instead make `shell_command` the expected path for operational work.

Alternative considered: introduce a new unified `workspace` tool that internally wraps read/write/list operations. That could be cleaner long term, but it is a larger architectural change than this proposal requires.

### Preserve Capability-Based Model Routing

`invoke_model` should continue resolving specialists by capability rather than by hard-coded model IDs, and it should absorb the existing multimodal entry points. This keeps the product's strong part: one orchestrator can delegate to the best configured chat, vision, image, or audio model without reopening the deleted operational tool surface.

Alternative considered: replace `invoke_model` immediately with a full internal sub-agent framework. That may still be a good future direction, but it is orthogonal to tool-surface reduction and would broaden this change too much.

### Remove Product-Integrated Agent Tool Flows, Not Underlying Product Areas

Deleting `search_skills`, `install_skill`, `create_skill`, and `create_scheduled_task` means the built-in agent can no longer manage those features through tool calls. It does not necessarily require removing the Skills or Tasks product areas in the same change. The initial implementation should focus on removing tool exposure, executor wiring, and related prompt/documentation references; any secondary UI product simplification can happen separately if needed.

Alternative considered: remove Skills and Tasks UI at the same time. That would be more opinionated, but it enlarges the blast radius and couples separate product decisions.

### Simplify Tool Migrations and Settings Compatibility

Tool settings loading should ignore removed tool names when old saved tool settings still reference them. Migration logic in `registry.ts` should be rewritten around the smaller preserved set and should stop auto-adding removed tools for older settings versions.

Alternative considered: perform a one-time destructive cleanup of saved tool settings files. Ignoring unknown or removed names is safer and keeps upgrades tolerant.

### Update Docs and Surfaces to Match Reality

The README, tools panel, and any feature descriptions that present removed tools as agent capabilities must be updated in the same implementation change. If a user can still see a removed tool in UI copy, they will assume the runtime supports it.

Alternative considered: defer docs/UI cleanup until later. That would create an avoidable mismatch between runtime behavior and visible product promises.

## Risks / Trade-offs

- Loss of structured tool safety for file access and HTTP operations -> Mitigation: keep `shell_command` guidance strict and retain existing timeout protections and circuit-breaker work.
- Some current workflows become less deterministic because shell output is less structured than dedicated tool returns -> Mitigation: keep `invoke_model` and memory as structured surfaces and tighten prompt instructions around shell usage.
- Skills and scheduled-task features may feel half-integrated if their UI remains but agent tools disappear -> Mitigation: document that this change only removes built-in agent management flows and review UI copy during implementation.
- Existing saved tool settings may reference deleted tool names -> Mitigation: make registry loading tolerant and resave normalized enabled-tool sets.
- Future expansion becomes slightly harder because deleted tools cannot be re-enabled by toggle alone -> Mitigation: this is an intentional trade-off in favor of a smaller, clearer runtime boundary.

## Migration Plan

1. Shrink bundled tool metadata and default enabled tools to the preserved set.
2. Remove executor wiring and dead runtime references for deleted tools.
3. Update agent prompt instructions and any attachment/help text that mentions deleted tools.
4. Make tool-settings loading normalize away removed tool names and resave the cleaned set.
5. Update UI and docs to reflect the reduced runtime.
6. Verify that preserved tools still work and deleted tools no longer appear or execute.

## Open Questions

- Should the Tools panel continue to exist if the remaining toolset becomes very small, or should it later move into a simpler “runtime capabilities” surface?
- Should `recall_memory` remain an explicit tool forever, or should memory become a fully implicit runtime behavior in a later change?
