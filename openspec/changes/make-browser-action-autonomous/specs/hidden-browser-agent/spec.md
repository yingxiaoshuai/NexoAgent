## MODIFIED Requirements

### Requirement: 单一 `browser_action` 工具支持自主执行入口

系统 SHALL 暴露单一 `browser_action` 工具，并在现有固定 action 之外支持 `action: "run"`，使 Agent 能够自主编写浏览器操作目标、目标定位参数、步骤和执行策略。

#### Scenario: 工具暴露 run action

- **WHEN** Agent 查看可用工具 schema
- **THEN** `browser_action.action` 应当包含 `run`
- **AND** `browser_action` 应当接受 `goal`、`target`、`steps`、`strategy` 和 `onFailure` 等参数

#### Scenario: run 支持多步执行

- **WHEN** Agent 使用 `action: "run"` 并提供多个 steps
- **THEN** 浏览器运行时应当按顺序执行这些 steps
- **AND** 每个 step 可以声明操作类型、目标、文本、按键、滚动量、策略和失败处理

#### Scenario: run 复用 DOM resolver

- **WHEN** run step 需要定位自然语言描述的页面元素
- **THEN** 系统应当复用浏览器 DOM descriptor、MiniLM 向量化语义匹配和 DOM 规则融合 resolver
- **AND** resolver 的结果应当可用于 click、type、hover、wheel、drag 等 step

#### Scenario: run 返回执行轨迹

- **WHEN** `browser_action.run` 执行完成
- **THEN** 响应应当包含最终浏览器状态
- **AND** 响应应当包含 run trace，说明每步是否成功、使用的策略、选中的 ref、置信度、MiniLM 状态和失败原因

#### Scenario: 固定 action 向后兼容

- **WHEN** Agent 使用 `snapshot`、`resolve`、`navigate`、`click`、`type`、`scroll`、`screenshot`、`refresh`、`back` 或 `forward`
- **THEN** 系统应当保持现有行为
