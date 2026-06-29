## MODIFIED Requirements

### Requirement: 浏览器任务使用自主 `browser_action`

编排器 SHALL 使用共享 `browser_action` 操作 Electron 浏览器会话；对于复合、模糊或需要策略表达的浏览器任务，编排器 SHOULD 使用 `browser_action.action="run"`，由 Agent 自主编写 goal、target、steps 和 strategy 参数，并由浏览器运行时负责解释执行。

#### Scenario: 简单任务可以使用固定 action

- **WHEN** 用户请求简单导航、截图、刷新、后退、前进、单次点击、单次输入或滚动
- **THEN** 编排器可以继续使用现有固定 `browser_action` action
- **AND** 固定 action 的行为应保持向后兼容

#### Scenario: 复合浏览器任务使用 run

- **WHEN** 用户请求需要多步浏览器操作的任务
- **THEN** 编排器应当可以调用 `browser_action` 且设置 `action: "run"`
- **AND** 编排器可以在一次调用中提供多个 steps
- **AND** 浏览器运行时应当按 steps 执行并返回 run trace

#### Scenario: 模糊目标由 run 内部解析

- **WHEN** `browser_action.run` 的 goal、target 或 step target 包含自然语言目标描述
- **THEN** 浏览器运行时应当通过 DOM descriptor、MiniLM 向量语义匹配、词法匹配、角色匹配、上下文匹配和可见/可用状态融合来解析目标
- **AND** 编排器不需要为了每个自然语言目标手动先调用 `resolve`

#### Scenario: Agent 自主编写浏览器参数

- **WHEN** 编排器调用 `browser_action.run`
- **THEN** 它应当能够自主填写 `goal`、`target`、`steps`、`strategy` 和 `onFailure`
- **AND** 工具 schema 不应把复合浏览器行为限制为只能通过固定 action enum 逐步表达

#### Scenario: MiniLM 仅用于浏览器 DOM 解析

- **WHEN** `browser_action.run` 或 `browser_action.resolve` 使用 MiniLM
- **THEN** MiniLM 应仅用于浏览器 DOM descriptor 与目标 query 的语义匹配
- **AND** MiniLM 不应被该能力用于记忆、知识库、通用问答或非浏览器 DOM 解析

#### Scenario: 视觉作为显式策略或兜底

- **WHEN** Agent 在 `browser_action.run` 中指定 `strategy: "visionFallback"` 或 DOM/semantic resolver 无法提供足够证据
- **THEN** 浏览器运行时可以返回需要视觉兜底的信息或截图结果
- **AND** 截图和视觉不应替代 MiniLM DOM resolver 的保留要求
