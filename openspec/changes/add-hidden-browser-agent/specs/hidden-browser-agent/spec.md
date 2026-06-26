## ADDED Requirements

### Requirement: 共享浏览器运行时
系统 SHALL 提供一个 Electron 浏览器运行时，可以在隐藏模式下供 Agent 操作外部 Web 页面，也可以在可见浏览器工作台中展示同一浏览器会话。

#### Scenario: 按需创建隐藏浏览器
- **当** `browser_action` 被调用且不存在浏览器会话时
- **则** 系统应当创建一个隐藏的 Electron Web 运行时
- **并且** 外部页面不应当显示为单独的用户窗口

#### Scenario: 可见工作台复用同一会话
- **当** 用户打开浏览器工作台时
- **则** 工作台应当显示与 `browser_action` 共享的浏览器会话
- **并且** 已保存的 Cookie 和站点状态应当可被继续使用

#### Scenario: 浏览器会话保持 Web 状态
- **当** 浏览器在多次隐藏工具调用或可见工作台操作中加载页面时
- **则** 系统应当使用持久化的 Electron partition 保存 Cookie 和站点存储

#### Scenario: 外部内容被隔离
- **当** 浏览器加载外部 Web 页面时
- **则** 该页面应当禁用 Node integration、启用 context isolation 和 sandboxing 运行

### Requirement: 通用浏览器动作工具
系统 SHALL 暴露单一 `browser_action` 工具，通过 `action` 参数执行浏览器导航、快照、交互、截图和历史导航操作。

#### Scenario: 工具目录只暴露一个浏览器工具
- **当** 工具注册表加载浏览器能力时
- **则** 它应当暴露 `browser_action`
- **并且** 不应当暴露独立的 `browser_navigate`、`browser_snapshot`、`browser_click`、`browser_type`、`browser_scroll` 或 `browser_screenshot` 工具

#### Scenario: 拒绝未知 action
- **当** Agent 使用未知 `action` 调用 `browser_action` 时
- **则** 系统应当以明确的错误拒绝请求
- **并且** 错误应当列出支持的 action 范围

### Requirement: 浏览器页面快照
系统 SHALL 通过 `browser_action` 的 `snapshot` action 返回紧凑的结构化浏览器状态供 Agent 推理使用。

#### Scenario: 快照包含页面标识信息
- **当** Agent 使用 `action: "snapshot"` 调用 `browser_action` 时
- **则** 系统应当返回当前 URL、页面标题、加载状态、`canGoBack`、`canGoForward` 和裁剪后的可见页面文本

#### Scenario: 快照包含交互元素
- **当** 当前页面包含可见的交互元素时
- **则** 系统应当返回裁剪后的元素条目，包含当前快照的稳定引用、角色类型、显示名称、标签、禁用状态和位置元数据

#### Scenario: 快照限制输出大小
- **当** 当前页面包含大量文本或众多交互元素时
- **则** 系统应当截断快照文本和元素列表以适配 Agent 上下文预算

### Requirement: 浏览器导航动作
系统 SHALL 通过 `browser_action` 的 `navigate` action 在共享浏览器中打开 HTTP 或 HTTPS URL 并返回结果页面状态。

#### Scenario: 导航到有效的 Web URL
- **当** Agent 使用 `action: "navigate"` 和 HTTP 或 HTTPS URL 调用 `browser_action` 时
- **则** 系统应当在共享浏览器中加载该 URL
- **并且** 返回更新后的页面状态

#### Scenario: 拒绝不支持的 URL 协议
- **当** Agent 使用 `action: "navigate"` 和非 Web URL 协议调用 `browser_action` 时
- **则** 系统应当以明确的错误拒绝请求

#### Scenario: 刷新当前页面
- **当** Agent 使用 `action: "refresh"` 调用 `browser_action` 时
- **则** 系统应当刷新当前页面并返回更新后的页面状态

#### Scenario: 后退和前进
- **当** Agent 使用 `action: "back"` 或 `action: "forward"` 调用 `browser_action` 时
- **则** 系统应当在浏览器历史中后退或前进
- **并且** 当对应历史不可用时返回明确的不可用结果

### Requirement: 浏览器交互动作
系统 SHALL 通过 `browser_action` 基于最新页面快照中的引用进行交互，并在每次操作后返回更新后的页面状态。

#### Scenario: 点击引用的元素
- **当** Agent 使用 `action: "click"` 和有效元素引用调用 `browser_action` 时
- **则** 系统应当点击该引用的元素并返回更新后的页面状态

#### Scenario: 在引用的控件中输入文本
- **当** Agent 使用 `action: "type"`、有效可编辑元素引用和文本调用 `browser_action` 时
- **则** 系统应当聚焦该引用的控件，输入文本，并返回更新后的页面状态

#### Scenario: 输入后可选提交
- **当** Agent 使用 `action: "type"` 且 `submit` 为 true 时
- **则** 系统应当在输入文本后触发适合该控件的提交行为
- **并且** 返回提交后的页面状态

#### Scenario: 滚动当前页面
- **当** Agent 使用 `action: "scroll"` 和方向参数调用 `browser_action` 时
- **则** 系统应当滚动当前页面并返回更新后的页面状态

#### Scenario: 元素引用失效
- **当** Agent 使用最新快照映射中不存在的引用调用交互 action 时
- **则** 系统应当返回引用失效错误，指示 Agent 请求新的 `snapshot`

### Requirement: 浏览器截图动作
系统 SHALL 通过 `browser_action` 的 `screenshot` action 捕获浏览器视口供视觉检查工作流使用。

#### Scenario: 捕获当前视口
- **当** Agent 使用 `action: "screenshot"` 调用 `browser_action` 时
- **则** 系统应当捕获当前浏览器视口并返回截图元数据或托管工件引用

#### Scenario: 截图不导致常规快照膨胀
- **当** 返回常规浏览器页面状态时
- **则** 系统不应当将完整截图图片数据嵌入文本响应中
