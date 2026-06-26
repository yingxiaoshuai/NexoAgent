## MODIFIED Requirements

### Requirement: 精简内置工具目录
系统 SHALL 暴露一个精简的内置 Agent 工具目录，包含 `shell_command`、`invoke_model`、`recall_memory`、`write_knowledge` 以及范围收窄的 `browser_action`；通过 `invoke_model` 路由多模态专业工作；并从默认运行时中移除不相关的专用文件、HTTP、技能、定时任务、计算器和旧版多模态工具。

#### Scenario: 保留的工具仍然可用
- **当** 工具注册表加载默认运行时的内置工具时
- **则** 它应当包含 `shell_command`、`invoke_model`、`recall_memory`、`write_knowledge` 和 `browser_action`

#### Scenario: 已移除的工具不存在
- **当** 工具注册表加载默认运行时的内置工具时
- **则** 它不应当暴露 `file_read`、`file_write`、`web_search`、`http_request`、`search_skills`、`install_skill`、`create_skill`、`create_scheduled_task`、`analyze_image`、`generate_image`、`edit_image`、`transcribe_audio`、`synthesize_speech` 或 `calculator`

#### Scenario: 旧浏览器工具族不存在
- **当** 工具注册表加载默认运行时的内置工具时
- **则** 它不应当暴露独立的 `browser_navigate`、`browser_snapshot`、`browser_click`、`browser_type`、`browser_scroll` 或 `browser_screenshot` 工具

#### Scenario: 浏览器工具保持范围收窄
- **当** 工具注册表加载 `browser_action` 时
- **则** 该工具应当被描述为交互式浏览器操作工具
- **并且** 不应当被描述为通用 HTTP、Web 搜索、文件、技能或定时任务工具
