## Why

Agent 通过 shell_command 修改文件后，用户如果对结果不满意，目前只能手动复原。参照 Codex 的撤回体验，需要提供一键撤回功能，让用户在本次会话中将工作区恢复到 agent 修改之前的状态。

## What Changes

- 在 agent 执行文件修改类 shell_command 之前自动保存受影响的文件快照。
- 每次 agent 消息完成后，前端展示"撤回"按钮，允许一键恢复该轮全部文件变更。
- 撤回操作仅影响当前会话的最新一次 assistant turn 的文件修改，不涉及 git 历史。
- 快照存储于 .nexo-data/snapshots/ 目录，随撤回操作自动清理。

## Capabilities

### New Capabilities

- gent-undo-rollback: 定义 agent 文件修改快照与撤回的完整流程——快照时机、存储位置、撤回 API、前端交互。

### Modified Capabilities

- minimal-agent-toolset: shell_command 工具执行前后增加快照/记录钩子。

## Impact

- 受影响的服务端文件：electron/server/tools/shell-command.ts（新增文件快照逻辑）、electron/server/routes/chat.ts（新增撤回路由）、electron/server/types.ts（新增撤回相关类型）。
- 受影响的前端文件：src/store/chat.ts、ChatPanel 组件（新增撤回按钮）。
- 新增数据目录：.nexo-data/snapshots/<sessionId>/<turnId>/。
- 对现有功能无破坏性变更。
