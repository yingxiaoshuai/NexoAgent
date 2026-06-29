## 1. API and Types

- [x] 1.1 Add `run` to `BrowserAction`.
- [x] 1.2 Define `BrowserTargetDescriptor` with `ref`, `query`, `role`, `text`, `selector`, `xpath`, `placeholder`, `ariaLabel`, `nearText`, `bounds`, and `relativePosition`.
- [x] 1.3 Define `BrowserRunStep`, `BrowserRunOperation`, `BrowserActionStrategy`, `BrowserRunFailurePolicy`, and `BrowserRunTrace` shared types.
- [x] 1.4 Extend `BrowserActionRequest` with `goal`, `target`, `steps`, `strategy`, `onFailure`, `key`, `deltaX`, `deltaY`, and step-level fields needed by run.
- [x] 1.5 Extend `BrowserActionResponse` with run trace metadata.

## 2. Tool Schema

- [x] 2.1 Update `nexo/tools.json` so `browser_action.action` includes `run`.
- [x] 2.2 Add schema fields for `goal`, `target`, `steps`, `strategy`, and `onFailure`.
- [x] 2.3 Keep existing fixed actions and parameters backward compatible.
- [x] 2.4 Update tool description to explain that Agent may use `run` for compound or fuzzy browser operations.

## 3. Browser Runtime

- [x] 3.1 Implement `BrowserManager.run()`.
- [x] 3.2 Refactor existing navigate/resolve/click/type/scroll/screenshot/back/forward/refresh into reusable primitives for run steps.
- [x] 3.3 Add target normalization and resolution for ref, selector, xpath, natural-language query, bounds, and relativePosition.
- [x] 3.4 Reuse DOM descriptor + MiniLM semantic resolver for any natural-language target inside `run`.
- [x] 3.5 Add limited failure handling based on `onFailure`, including snapshot, resolve, scroll, and return-candidates.
- [x] 3.6 Return detailed run trace with selected refs, confidence, strategy, semantic readiness, and per-step result.

## 4. Browser Gestures

- [x] 4.1 Add `wheel` primitive using CDP mouseWheel events.
- [x] 4.2 Add `hover` primitive using CDP mouseMoved.
- [x] 4.3 Add `drag` primitive using CDP mousePressed/mouseMoved/mouseReleased.
- [x] 4.4 Allow coordinate and relativePosition fallback when explicitly requested.

## 5. Agent Prompting

- [x] 5.1 Update `electron/server/agent.ts` browser guidance to recommend `run` for compound or fuzzy browser tasks.
- [x] 5.2 Remove wording that forces the model to manually call snapshot/resolve/ref click for every ordinary control.
- [x] 5.3 Keep guidance that MiniLM semantic matching is browser-only and not used for memory or knowledge.
- [x] 5.4 Keep screenshot/vision as a possible fallback when the Agent requests it through strategy or when DOM evidence is insufficient.

## 6. Documentation

- [x] 6.1 Update README browser section with `browser_action.run` examples.
- [x] 6.2 Update README.en with the same behavior.
- [x] 6.3 Document that fixed actions remain available for simple tasks.

## 7. Verification

- [x] 7.1 Verify `browser_action.run` can click a fuzzy button target using MiniLM resolver.
- [x] 7.2 Verify `browser_action.run` can type into a fuzzy input target.
- [x] 7.3 Verify a multi-step compose flow can run in one tool call without stale refs between steps.
- [x] 7.4 Verify MiniLM unavailable/degraded mode still falls back to lexical and DOM rules.
- [x] 7.5 Verify fixed `click`, `type`, `resolve`, `snapshot`, and `scroll` actions remain backward compatible.
