## Background

现有 `browser_action` 把浏览器能力拆成多个固定 action。Agent 需要自己决定先 `snapshot`、再 `resolve`、再 `click`，或者在 `type` 前拿 ref。这在简单任务中清晰，但在复杂网页和 SPA 中会有几个问题：

- 多次 tool-call 之间页面可能 rerender，导致 ref 过期。
- 模型必须学习工具内部细节，才能正确组合 action。
- 固定 schema 难以表达“如果失败就刷新 DOM 后重试”“滚动到附近再点击”“优先按钮角色但允许链接”等策略。
- MiniLM resolver 已经存在，但它只通过 `resolve` 和 query-based click/type 间接使用，没有成为所有浏览器动作的通用 target resolver。

目标是让 `browser_action` 更像 `shell_command` 的使用体验：Agent 给出一个自主组织的浏览器操作请求，浏览器工具内部完成拆解、定位、执行和重试。

## API Shape

### 1. Keep existing actions

保留已有 action：

```text
snapshot, resolve, navigate, click, type, scroll, screenshot, refresh, back, forward
```

这些 action 继续用于简单、明确、向后兼容的场景。

### 2. Add `action: "run"`

新增通用入口：

```json
{
  "action": "run",
  "goal": "点击发送按钮",
  "target": {
    "query": "发送",
    "role": "button"
  },
  "steps": [
    {
      "op": "click",
      "target": {
        "query": "发送",
        "role": "button"
      },
      "strategy": "auto"
    }
  ],
  "onFailure": {
    "retry": ["snapshot", "resolve", "scroll"]
  }
}
```

`goal` 是给运行时和返回结果看的任务意图；`steps` 是 Agent 自主编写的操作序列；`target` 是默认目标，steps 可以继承或覆盖。

### 3. Target descriptor

`BrowserTargetDescriptor` 支持多种定位方式：

```ts
interface BrowserTargetDescriptor {
  ref?: string;
  query?: string;
  role?: string;
  text?: string;
  selector?: string;
  xpath?: string;
  placeholder?: string;
  ariaLabel?: string;
  nearText?: string;
  index?: number;
  bounds?: BrowserBounds;
  relativePosition?: {
    xRatio: number;
    yRatio: number;
  };
}
```

解析优先级不是死规则，而是由 `strategy` 和可用信息决定。一般建议：

- `ref` 可用时直接尝试。
- `selector` / `xpath` 可用时验证可见性和可用性后使用。
- `query` / `text` / `ariaLabel` / `nearText` 走 DOM descriptor + MiniLM resolver。
- `bounds` / `relativePosition` 作为坐标兜底。

### 4. Run steps

`BrowserRunStep` 可以覆盖常用浏览器动作：

```ts
type BrowserRunOperation =
  | "navigate"
  | "resolve"
  | "click"
  | "type"
  | "key"
  | "scroll"
  | "wheel"
  | "hover"
  | "drag"
  | "wait"
  | "screenshot"
  | "back"
  | "forward"
  | "refresh";
```

示例：

```json
{
  "action": "run",
  "goal": "填写并发送邮件",
  "steps": [
    { "op": "click", "target": { "query": "写信", "role": "button" } },
    { "op": "type", "target": { "query": "收件人" }, "text": "test@example.com" },
    { "op": "type", "target": { "query": "主题" }, "text": "测试邮件" },
    { "op": "type", "target": { "query": "正文" }, "text": "你好" },
    { "op": "click", "target": { "query": "发送", "role": "button" }, "strategy": "semantic" }
  ]
}
```

### 5. Strategy

`strategy` 用于表达 Agent 想让运行时如何定位或执行：

```ts
type BrowserActionStrategy =
  | "auto"
  | "dom"
  | "semantic"
  | "css"
  | "xpath"
  | "cdp"
  | "coordinate"
  | "visionFallback";
```

- `auto`: 运行时自行选择。
- `dom`: 偏向 DOM/ref/selector。
- `semantic`: 明确使用 descriptor + MiniLM resolver。
- `css` / `xpath`: 明确使用 selector。
- `cdp`: 使用 CDP 输入事件执行。
- `coordinate`: 使用 bounds 或 relativePosition。
- `visionFallback`: 允许截图/视觉兜底。

## MiniLM Resolver Integration

MiniLM 不生成操作计划，也不替代 Agent。它只做浏览器 DOM target resolution：

1. 页面 snapshot 或 DOM index 生成 descriptor text。
2. descriptor text 向量化并缓存。
3. `run` 中任何自然语言目标都转成 query。
4. query 向量化，取 Top K。
5. 与 lexical、role、context、visible/enabled、recent focus 分数融合。
6. 返回候选；当置信度满足执行条件时，step 可以继续执行。

这意味着 `run` 不是绕过 DOM resolver，而是把 DOM resolver 放到更底层，让 Agent 不必每次手动调用 `resolve`。

## Execution Model

`BrowserManager.run()` 应当：

1. 确保浏览器会话存在。
2. 如果有 `goal` 或自然语言 target，预热 MiniLM。
3. 归一化 steps；如果没有 steps，则根据 `goal`、`target` 和 `text` 推断一个单步操作。
4. 每步执行前解析 target。
5. 执行 primitive：navigate/click/type/scroll/wheel/hover/drag/wait/screenshot 等。
6. 每步后按需等待页面稳定。
7. 如果失败，根据 `onFailure` 做有限重试或返回候选。
8. 最后返回页面 snapshot 和 run trace。

返回示例：

```json
{
  "ok": true,
  "lastAction": "run",
  "run": {
    "goal": "点击发送按钮",
    "steps": [
      {
        "op": "click",
        "ok": true,
        "strategy": "semantic+cdp",
        "target": { "query": "发送", "role": "button" },
        "selectedRef": "e6",
        "semanticReady": true,
        "confidence": 0.92
      }
    ]
  }
}
```

## Prompt Changes

提示词应从“必须先 snapshot/resolve/ref click”改成：

```text
Use browser_action for the shared browser session. For simple operations, fixed actions such as snapshot, resolve, click, type, scroll, screenshot, back, and forward are available. For compound or fuzzy browser tasks, use browser_action with action="run" and write the goal, target, steps, and strategy yourself. The browser runtime will resolve natural-language targets through DOM descriptors, local MiniLM semantic matching, DOM rules, and CDP-backed input events.
```

这样模型获得自主表达空间，同时仍会利用向量化 DOM 查找。
