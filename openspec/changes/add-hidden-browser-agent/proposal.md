## Why

Nexo Agent 可以推理和运行本地命令，但无法代表用户直接浏览或操作需要登录的 Web 应用。添加一个 Electron 浏览器运行时，可以让 Agent 在受控环境下导航页面、检查交互状态并执行用户请求的 Web 任务。

本次变更需要同时覆盖两种使用方式：默认隐藏运行，供 Agent 通过工具自动操作；以及用户从菜单打开一个类似浏览器的可见工作台，在左侧查看真实页面、在右侧用 AI 聊天控制页面。

## What Changes

- 在 Electron 主进程/服务进程中添加一个基于 `BrowserWindow` / `BrowserView` / `WebContentsView` 的浏览器运行时，默认可隐藏运行。
- 将浏览器自动化工具收敛为一个通用 `browser_action`，通过 `action` 参数支持导航、快照、点击、输入、滚动、截图、刷新、前进和后退等操作。
- 返回紧凑的结构化页面状态给 Agent，包括 URL、标题、可见文本、可用导航状态以及交互元素的稳定引用。
- 使用 Electron partition 保持会话状态，使 Cookie 和登录会话在隐藏工具调用和可见浏览器工作台之间保持一致。
- 通过安全的 Electron webPreferences 设置，将外部页面与 Nexo 应用权限隔离。
- 在应用菜单/侧边栏中添加浏览器工作台入口，打开后展示浏览器式页面：顶部地址栏和刷新/前进/后退控件，主体为左右可调分栏，左侧显示页面内容，右侧为 AI 聊天控制面板。
- 添加运行时指导，使编排器仅在 Web 浏览和 Web 应用操作任务中使用 `browser_action`，而非把它当成通用 HTTP/Web 搜索工具。

## Capabilities

### New Capabilities
- `hidden-browser-agent`：定义 Electron 浏览器运行时、隐藏/可见会话共享方式，以及 Agent 使用 `browser_action` 检查和操作 Web 页面的工具契约。
- `browser-workbench`：定义用户可打开的浏览器工作台，包括菜单入口、地址栏导航控件、页面视图、AI 控制聊天和可调分栏。

### Modified Capabilities
- `minimal-agent-toolset`：允许在内置工具目录中添加范围收窄的 `browser_action`，同时保持不相关工具的精简意图。
- `model-orchestration`：扩展编排行为，使浏览器任务可以使用 `browser_action`，而文件系统和命令行工作仍优先使用 `shell_command`。

## Impact

- 影响 Electron 运行时代码：`electron/main.ts` 启动生命周期、应用菜单/侧边栏入口，以及在 Electron/server 边界下新增的浏览器管理器模块。
- 影响工具运行时：`nexo/tools.json`、`electron/server/tools/executors.ts` 及相关工具辅助模块。
- 影响 Agent 行为：`electron/server/agent.ts` 中的提示词和工具选择指导。
- 影响 UI：新增浏览器工作台页面/组件、地址栏控件、Web 内容承载层、右侧 AI 聊天控制面板和可拖拽分栏。
- 影响安全态势：外部 Web 内容必须禁用 Node integration、启用 context isolation 和 sandboxing，并与 Nexo 应用 UI 权限隔离。
