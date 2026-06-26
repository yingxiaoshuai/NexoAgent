## 背景

Nexo Agent 在 Electron 主进程中运行 Express 后端，内置工具在 `nexo/tools.json` 中声明，执行器在 `electron/server/tools/executors.ts` 中接线。当前运行时刻意保持精简的内置工具目录，以 shell、模型调用、知识写入和记忆检索为中心。

本次请求的能力与之前移除的通用 Web/HTTP 工具不同：Agent 需要一个交互式浏览器会话，可以加载真实的 Web 应用、保持 Cookie、检查当前页面，并通过可见的页面控件执行用户请求的操作。同时，用户希望能从菜单打开一个类似浏览器的界面，亲眼看到页面并用右侧 AI 聊天控制左侧页面。

Electron 已经通过 Chromium 提供 Web 运行时，因此第一版实现应优先复用 Electron 原生能力，而不是引入 Playwright 或其他浏览器依赖。

## 目标 / 非目标

**目标：**
- 提供一个 Electron 浏览器运行时，Agent 可以通过 `browser_action` 进行导航和操作，默认支持隐藏运行。
- 提供一个可见浏览器工作台，包含地址栏、刷新、前进、后退、页面视图、右侧 AI 聊天控制面板，以及可拖拽调整的左右分栏。
- 隐藏 Agent 浏览器和可见工作台共享专用 Electron partition，使 Cookie 和登录状态可复用。
- 返回对语言模型有用的紧凑页面快照：URL、标题、可见文本、导航状态以及链接、按钮、输入框、文本域、选择框等常见控件的稳定引用。
- 支持核心交互：导航、快照、点击、输入、滚动、截图、刷新、前进和后退。
- 通过 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true` 隔离外部 Web 内容。
- 与现有工具注册表、工具设置、聊天工具调用事件流和 UI 导航集成。

**非目标：**
- 构建完整的 Playwright 兼容自动化框架。
- 解决反机器人检测、验证码或被屏蔽的银行/高风险网站。
- 提供通用的未认证 Web 搜索或 HTTP 请求工具。
- 在没有用户明确指示的情况下自动输入凭据。
- 第一版不要求多标签页、书签、下载管理、扩展系统或完整浏览器设置页。

## 决策

### 使用共享的 Electron 浏览器会话

创建一个 `BrowserManager` 模块，负责懒加载和复用浏览器会话。隐藏自动化模式可以使用 `show: false` 的 `BrowserWindow`；可见工作台应使用可嵌入主窗口布局的 Electron Web 内容承载方式，例如 `BrowserView` 或新版 Electron 的 `WebContentsView`，以便左侧页面与右侧 React AI 面板共存。

两种模式应使用同一个持久化 partition，例如 `partition: "persist:agent-browser"`。这样用户在可见工作台里登录后，Agent 的隐藏 `browser_action` 可以继续读取和操作同一站点状态；Agent 在隐藏模式导航后的状态也能在打开工作台时恢复或显示。

考虑的替代方案：隐藏模式和可见模式各自独立。这样隔离更强，但会让用户登录/调试流程重复，且右侧 AI 控制左侧页面的体验无法与工具状态保持一致。

### 将浏览器操作收敛为通用 `browser_action`

工具注册表应只暴露一个浏览器工具：

```json
{
  "name": "browser_action",
  "parameters": {
    "action": "snapshot | navigate | click | type | scroll | screenshot | refresh | back | forward",
    "url": "用于 navigate",
    "ref": "用于 click/type",
    "text": "用于 type",
    "submit": "用于 type 的可选提交",
    "direction": "用于 scroll: up | down | left | right",
    "amount": "用于 scroll 的可选像素距离"
  }
}
```

执行器根据 `action` 分发到 `BrowserManager`，并统一返回字符串化的结构化结果或错误。这样工具面更小，菜单和日志中也更容易把浏览器行为归为一个能力。

考虑的替代方案：继续使用 `browser_navigate`、`browser_snapshot` 等分散工具。分散工具语义更直接，但会增加内置工具数量，与精简工具面的方向冲突。当前需求明确要求使用通用 `browser_action`。

### 浏览器状态响应保持结构化且紧凑

`browser_action` 的常规响应应包含：
- `action`
- `ok`
- `url`
- `title`
- `canGoBack`
- `canGoForward`
- `text`
- `elements`
- `warning` / `error`

`elements` 中的引用在每次快照时重新生成，并存储在管理器中作为引用到元素选择器/路径元数据的映射。点击和输入应基于最新映射执行。如果引用失效，工具应返回明确错误，引导 Agent 重新调用 `browser_action` 的 `snapshot`。

截图不应嵌入常规快照文本中。`screenshot` action 应返回文件路径、托管工件引用、尺寸和 MIME 类型等元数据。

### 可见浏览器工作台作为独立视图

在主应用导航或菜单中添加“浏览器”入口。点击后进入浏览器工作台：
- 顶部 header 为地址栏，显示当前 URL，支持输入 URL 后导航。
- header 右侧/左侧提供刷新、后退、前进按钮，并根据 `canGoBack` / `canGoForward` 禁用不可用动作。
- 主区域左右分栏，左侧承载真实 Web 页面，右侧为 AI 聊天控制面板。
- 分栏宽度可拖拽调整，并持久化用户偏好。
- 右侧 AI 聊天发送消息时，应把任务路由给现有 Agent runtime，并让 Agent 使用同一浏览器会话的 `browser_action` 控制左侧页面。

外部网页内容不应直接运行在 React DOM 的 iframe 中作为首选方案。Electron 原生 Web 内容承载层可以更好地隔离权限、复用 partition、处理导航事件并支持前进/后退/刷新。

### UI 和浏览器运行时通过 IPC 同步

主进程应向渲染进程暴露受限的桌面 API，例如：
- 获取当前浏览器状态
- 导航到 URL
- 刷新、后退、前进
- 订阅 URL、标题和导航状态变化
- 调整或重算左侧 Web 内容区域 bounds

React 工作台负责绘制地址栏、按钮、右侧聊天和拖拽分栏；Electron 主进程负责真正的 Web 内容生命周期和页面 bounds。窗口 resize、分栏 resize、侧边栏折叠等布局变化后，渲染进程应通知主进程更新 Web 内容 bounds。

### 默认启用但保持边界清晰

`browser_action` 应属于内置目录，并在包含安全约束的前提下默认启用。现有精简工具集规范需要更新，以明确允许此专用浏览器工具，同时继续拒绝已移除的通用工具。

工具描述和系统提示必须强调：
- 仅在交互式浏览、检查页面或操作 Web 应用时使用。
- 不用于通用 HTTP 请求、搜索、爬虫或文件访问。
- 敏感操作和凭据输入需要明确用户意图。

## 风险 / 权衡

- 隐藏浏览器自动化可能在 SPA 或慢速页面上挂起 -> 缓解措施：集中管理导航/操作等待并设置超时，返回最佳可用快照加上警告。
- 可见工作台和隐藏工具争用同一会话 -> 缓解措施：由 `BrowserManager` 串行化关键操作，并向 UI 推送状态变更。
- 某些网站会阻止 Electron 或类自动化行为 -> 缓解措施：清晰地报告屏蔽情况，避免承诺通用站点支持。
- DOM 派生的元素引用在页面更新后可能失效 -> 缓解措施：每次快照时重新生成引用，返回清晰的失效引用错误，指示模型调用 `browser_action` 的 `snapshot`。
- 已登录会话可能触碰到敏感数据 -> 缓解措施：使用专用持久化 partition，保持外部页面沙箱化，并在工具描述中要求对敏感操作有用户意图。
- 快照文本可能超出模型上下文的限制 -> 缓解措施：限制可见文本和元素数量，优先展示交互元素及其附近的标签。
- 截图可能在日志或工件中暴露私密页面内容 -> 缓解措施：仅在 `screenshot` action 请求时保存截图，返回显式的截图元数据，而不是将大图像嵌入常规文本输出中。
- Web 内容嵌入主窗口会增加布局复杂度 -> 缓解措施：将 bounds 计算集中在工作台容器，使用稳定的 resize observer/IPC 协议同步。

## 迁移计划

1. 在现有工具注册表背后添加浏览器管理器和 `browser_action` 执行器。
2. 将 `browser_action` 元数据添加到 `nexo/tools.json`，并提升工具设置迁移版本，使现有用户可按需获得新的默认启用工具。
3. 更新 Agent 提示词引导和文档，说明何时使用 `browser_action`。
4. 增加浏览器工作台入口、页面布局、地址栏控件、右侧 AI 控制聊天和分栏 resize。
5. 增加主进程/渲染进程 IPC，使工作台 UI 和共享浏览器会话保持 URL、标题、导航状态和 bounds 同步。
6. 验证现有非浏览器工具仍能正常加载，且旧保存工具设置中的废弃工具名能正确标准化。
7. 如需回滚，从 `nexo/tools.json` 中移除 `browser_action`，隐藏浏览器工作台入口，并保留专用浏览器 partition 数据以便后续复用。

## 待解决问题

- 截图文件应存储在现有 uploads/artifacts 区域下，还是新增专用 browser artifacts 目录？
- 可见工作台是否需要第一版就支持手动清空浏览器会话/Cookie？
- 右侧 AI 控制聊天是否复用当前会话列表，还是为浏览器工作台创建独立的会话类型和历史记录？
