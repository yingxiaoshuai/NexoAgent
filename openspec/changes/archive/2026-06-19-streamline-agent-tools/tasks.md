## 1. Shrink the Runtime Tool Catalog

- [x] 1.1 Remove `file_read`, `file_write`, `web_search`, `http_request`, `search_skills`, `install_skill`, `create_skill`, and `create_scheduled_task` from `nexo/tools.json` and the default enabled tool list.
- [x] 1.2 Update tool registry migrations so old saved settings normalize to the preserved toolset without failing.
- [x] 1.3 Remove registry-time references to deleted tools and ensure only supported bundled tools are exposed.

## 2. Prune Runtime Execution Paths

- [x] 2.1 Remove deleted tool executors from `electron/server/tools/executors.ts` and clean up unused imports.
- [x] 2.2 Remove or retire now-unused helper modules that only support deleted tools if nothing else depends on them.
- [x] 2.3 Update `electron/server/agent.ts` prompt guidance so operational work routes through `shell_command` and removed tools are no longer mentioned.
- [x] 2.4 Update attachment or runtime helper text that currently points users or the model toward removed tools.

## 3. Preserve the Minimal High-Value Toolset

- [x] 3.1 Verify `shell_command`, `invoke_model`, and `recall_memory` remain registered and executable.
- [x] 3.2 Ensure multimodal actions still resolve specialist profiles and return managed artifacts through `invoke_model` after runtime reduction.
- [x] 3.3 Ensure semantic memory recall remains callable and unaffected by removal of unrelated utility tools.

## 4. Align UI and Documentation

- [x] 4.1 Update the Tools UI and any related frontend copy so deleted tools no longer appear as toggles or supported runtime features.
- [x] 4.2 Update `README.md`, `README.en.md`, and relevant docs to describe the reduced built-in toolset accurately.
- [x] 4.3 Review Skills and Tasks product surfaces for misleading copy that implies the built-in agent can still manage them through removed tools.

## 5. Verify Compatibility

- [x] 5.1 Test loading existing tool settings that contain removed tool names and confirm the runtime recovers by normalizing and resaving.
- [x] 5.2 Verify deleted tools cannot be selected or executed through the runtime after the change.
- [x] 5.3 Run the project typecheck/build verification and fix regressions caused by removed runtime code paths.
