## 1. 浏览器运行时

- [ ] 1.1 创建 `BrowserManager` 模块，懒加载地管理共享 Electron 浏览器会话。
- [ ] 1.2 配置隐藏运行模式：`show: false`、固定桌面视口、`partition: "persist:agent-browser"`、`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`。
- [ ] 1.3 为可见工作台提供可嵌入主窗口的 Web 内容承载方式，例如 `BrowserView` 或 `WebContentsView`。
- [ ] 1.4 添加管理器生命周期处理：窗口/视图复用、关闭恢复、导航超时、操作串行化，以及应用关闭时的清理。
- [ ] 1.5 统一维护当前 URL、标题、`canGoBack`、`canGoForward`、加载状态和最近快照引用映射。

## 2. `browser_action` 工具核心

- [ ] 2.1 在 `nexo/tools.json` 中添加单一 `browser_action` 元数据，参数包含 `action`、`url`、`ref`、`text`、`submit`、`direction`、`amount` 等字段。
- [ ] 2.2 在 `electron/server/tools/executors.ts` 中添加 `browser_action` 执行器，按 action 委托给 `BrowserManager`。
- [ ] 2.3 实现 `navigate` action，校验 HTTP/HTTPS 协议，对常规页面和 SPA 提供尽力而为的等待行为。
- [ ] 2.4 实现 `snapshot` action，返回 URL、标题、导航状态、裁剪后的可见文本以及裁剪后的交互元素条目。
- [ ] 2.5 为交互元素生成快照内引用，并在管理器中存储最新引用映射。
- [ ] 2.6 实现 `click`、`type`、`scroll`、`refresh`、`back` 和 `forward` action，并在操作后返回更新后的页面状态。
- [ ] 2.7 实现 `screenshot` action，捕获视口并返回截图元数据或托管工件引用，不将完整图片数据嵌入常规快照响应。
- [ ] 2.8 返回清晰的引用失效、协议不支持、导航失败和 action 不支持错误信息。
- [ ] 2.9 提升工具设置迁移版本号，使现有安装能够标准化设置并接收 `browser_action` 默认值。

## 3. 可见浏览器工作台

- [ ] 3.1 在主应用菜单/侧边栏中添加“浏览器”入口，并提供对应图标和中英文文案。
- [ ] 3.2 创建浏览器工作台视图，顶部 header 包含 URL 输入框、刷新、后退、前进控件。
- [ ] 3.3 在工作台左侧显示共享浏览器 Web 内容，并在导航、刷新、前进/后退后同步地址栏状态。
- [ ] 3.4 在工作台右侧添加 AI 聊天控制面板，发送消息时复用现有 Agent runtime，并引导其使用共享会话的 `browser_action`。
- [ ] 3.5 实现左右分栏拖拽调整大小，并持久化用户偏好的分栏宽度。
- [ ] 3.6 处理窗口 resize、侧边栏切换和分栏 resize 后的 Web 内容 bounds 同步，避免网页区域与 UI 控件重叠。
- [ ] 3.7 在离开浏览器工作台时隐藏或挂起可见 Web 内容，但保留共享浏览器会话状态。

## 4. IPC 与状态同步

- [ ] 4.1 扩展 `DesktopApi` / preload，暴露受限浏览器工作台 API：获取状态、导航、刷新、后退、前进和 bounds 更新。
- [ ] 4.2 在主进程中注册浏览器工作台 IPC handler，并委托给 `BrowserManager`。
- [ ] 4.3 将浏览器 URL、标题、加载状态、`canGoBack` 和 `canGoForward` 变化推送给渲染进程。
- [ ] 4.4 确保外部页面打开新窗口或跳转非 Web 协议时按安全策略拦截或交给系统浏览器。

## 5. 编排引导

- [ ] 5.1 更新 `electron/server/agent.ts` 提示词引导，使其在交互式 Web 浏览和 Web 应用操作任务中使用 `browser_action`。
- [ ] 5.2 确保引导仍将文件系统和命令行工作路由到 `shell_command`，不会重新引入已移除的 HTTP/Web 搜索工具行为。
- [ ] 5.3 保持 `browser_action` 工具描述明确说明用户意图、敏感站点、凭据输入限制以及 Electron 浏览器自动化的局限性。

## 6. 验证

- [ ] 6.1 在代码库支持直接测试的地方，添加或更新针对 URL 验证、action 分发、快照格式、输出限制以及引用失效行为的测试。
- [ ] 6.2 运行覆盖 Electron 服务端代码、preload 类型和工具元数据的 TypeScript/构建检查。
- [ ] 6.3 手动验证隐藏流程：导航到测试页面、获取元素快照、点击链接或按钮、输入文本、滚动并捕获截图。
- [ ] 6.4 手动验证可见工作台流程：从菜单打开浏览器、输入 URL、刷新、前进、后退、拖拽分栏，并确认右侧 AI 能控制左侧页面。
- [ ] 6.5 验证现有非浏览器工具仍可加载，且包含已移除工具名的旧保存工具设置仍能正确标准化。
