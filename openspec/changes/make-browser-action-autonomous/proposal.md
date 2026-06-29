## Why

当前 `browser_action` 是一个固定 action schema：`snapshot`、`resolve`、`navigate`、`click`、`type`、`scroll`、`screenshot`、`refresh`、`back`、`forward`。这个设计清晰，但对 Agent 来说过于“表单化”：模型必须在有限 enum 和固定字段里拆动作，复杂任务容易变成多次工具调用、ref 过期、参数不够表达、失败后重复同一路径。

用户希望 `browser_action` 更像 `shell_command`：不是让 Agent 改用 shell，而是让浏览器工具本身成为一个更自由的执行入口。Agent 可以自主编写浏览器操作参数、目标描述、步骤和策略，由浏览器运行时解释执行。这样既保留共享 Electron 浏览器、DOM snapshot、CDP 点击和截图能力，也让模型能更自然地表达“找到发送按钮并点击”“如果当前 ref 失效就重新解析”“滚动到包含某文本的区域再输入”等组合动作。

同时，已有的 MiniLM 向量化 DOM 查找不能移除。它仍应是模糊目标解析的重要能力，只是从单独的 `resolve` action 扩展为所有自主浏览器操作都能复用的目标定位层。

## What Changes

- 为 `browser_action` 增加一个通用执行入口，例如 `action: "run"`。
- `run` 允许 Agent 像写 shell 命令一样自主描述浏览器操作，但仍使用结构化 JSON 参数：
  - `goal`: 本次浏览器操作目标。
  - `steps`: 可选的多步操作列表。
  - `target`: 可选目标描述，支持 query、role、text、selector、xpath、ref、nearText、bounds、relativePosition 等。
  - `strategy`: 可选策略，例如 `auto`、`dom`、`semantic`、`css`、`cdp`、`coordinate`、`visionFallback`。
  - `onFailure`: 可选失败处理，例如重新 snapshot、重新 resolve、滚动后重试、返回候选。
- 保留现有固定 action，作为向后兼容和简单任务的快捷路径。
- 将 MiniLM DOM resolver 从 `resolve` 专用能力提升为 browser action target resolver：
  - 当 `target.query`、`goal` 或 step 的目标是自然语言描述时，自动调用 DOM descriptor + MiniLM 语义匹配。
  - 仍然融合 lexical、role、context、visible/enabled、recent focus 等规则分。
  - MiniLM 只用于浏览器 DOM 解析，不进入记忆、知识库或通用语义检索。
- 允许单次 `browser_action.run` 完成短链路任务，减少多次 tool-call 之间的 ref 过期。
- 工具返回应包含执行计划、每步结果、最终页面状态、使用的定位策略、MiniLM 是否参与、候选和失败原因。

## Capabilities

### Modified Capabilities

- `hidden-browser-agent`: 扩展 `browser_action` 工具契约，新增自主执行入口和通用 target resolver，同时保留现有 action。
- `model-orchestration`: 引导 Agent 使用 `browser_action.run` 表达组合浏览器动作，并让浏览器运行时内部处理目标解析、MiniLM 查找、CDP 点击、滚动和重试。

## Impact

- 影响 `src/shared/types.ts`：
  - 扩展 `BrowserAction` 增加 `run`。
  - 新增 `BrowserRunStep`、`BrowserTargetDescriptor`、`BrowserActionStrategy`、`BrowserRunResult` 等类型。
- 影响 `nexo/tools.json`：
  - 为 `browser_action` schema 增加 `run` 所需的自由结构化参数。
  - 描述从“固定动作选择器”改成“共享浏览器执行入口，既支持固定 action，也支持自主 run”。
- 影响 `electron/server/tools/executors.ts`：
  - 透传 `goal`、`steps`、`target`、`strategy`、`onFailure` 等参数到 BrowserManager。
- 影响 `electron/server/browser-manager.ts`：
  - 实现 `run` 编排器。
  - 将现有 snapshot/resolve/click/type/scroll/CDP click 组织成可复用 primitive。
  - 让 target resolver 在 run steps 中复用 MiniLM DOM 语义索引。
- 影响 `electron/server/agent.ts`：
  - 提示词应鼓励 Agent 对复杂浏览器任务使用 `browser_action.run` 自主组织参数。
  - 保留“普通 DOM 控件优先利用 DOM/semantic resolver”的能力，但不要求模型必须手动先 snapshot 再 resolve 再 click。
- 影响 README / README.en：
  - 更新浏览器自动化说明，解释 `browser_action.run` 和 MiniLM DOM 查找关系。

## Non-Goals

- 不移除现有 `snapshot`、`resolve`、`click`、`type` 等固定 action。
- 不把浏览器操作改成 `shell_command`；自主入口仍属于 `browser_action`。
- 不移除 MiniLM 向量化 DOM 查找。
- 不把 MiniLM 用于记忆、知识库、通用问答或非浏览器 DOM 解析。
