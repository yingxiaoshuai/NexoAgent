import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");

const breakerModule = await import(pathToFileURL(path.join(repoRoot, "dist-electron/electron/server/agent-loop-circuit-breaker.js")));
const settingsModule = await import(pathToFileURL(path.join(repoRoot, "dist-electron/electron/server/settings.js")));

const { createAgentLoopCircuitBreaker } = breakerModule;
const { DEFAULT_AGENT_SETTINGS } = settingsModule;

function createSettings(overrides = {}) {
  return {
    ...DEFAULT_AGENT_SETTINGS,
    ...overrides,
  };
}

function makeBreaker(overrides = {}, startedAt = Date.now()) {
  return createAgentLoopCircuitBreaker(createSettings(overrides), startedAt);
}

{
  const breaker = makeBreaker({ circuitBreakerRepeatedToolCallLimit: 3 });
  for (let step = 1; step <= 3; step++) {
    breaker.recordModelTurn({
      step,
      visibleText: "",
      toolCalls: [{ name: "shell_command", args: { command: "dir" } }],
      usage: { promptTokens: 10, completionTokens: 2 },
    });
    breaker.recordToolResult({
      name: "shell_command",
      args: { command: "dir" },
      output: "stdout:\nlisting unchanged",
      elapsedSeconds: 0.1,
    });
  }
  const decision = breaker.evaluate();
  assert.equal(decision.action, "stop");
  if (decision.action === "stop") {
    assert.equal(decision.reason, "repeated_tool_calls");
  }
}

{
  const breaker = makeBreaker({ circuitBreakerConsecutiveFailureLimit: 3 });
  for (let step = 1; step <= 3; step++) {
    breaker.recordModelTurn({
      step,
      visibleText: "",
      toolCalls: [{ name: "shell_command", args: { command: "bad-command" } }],
    });
    breaker.recordToolResult({
      name: "shell_command",
      args: { command: "bad-command" },
      output: "Error: command failed",
      elapsedSeconds: 0.1,
    });
  }
  const decision = breaker.evaluate();
  assert.equal(decision.action, "stop");
  if (decision.action === "stop") {
    assert.equal(decision.reason, "consecutive_failures");
  }
}

{
  const breaker = makeBreaker({ circuitBreakerNoProgressLimit: 2 });
  breaker.recordModelTurn({
    step: 1,
    visibleText: "",
    toolCalls: [{ name: "invoke_model", args: { prompt: "again" } }],
  });
  breaker.recordToolResult({
    name: "invoke_model",
    args: { prompt: "again" },
    output: "",
    elapsedSeconds: 0.1,
  });
  breaker.recordModelTurn({
    step: 2,
    visibleText: "",
    toolCalls: [{ name: "invoke_model", args: { prompt: "again" } }],
  });
  breaker.recordToolResult({
    name: "invoke_model",
    args: { prompt: "again" },
    output: "",
    elapsedSeconds: 0.1,
  });
  const decision = breaker.evaluate();
  assert.equal(decision.action, "stop");
  if (decision.action === "stop") {
    assert.equal(decision.reason, "no_progress");
  }
}

{
  const breaker = makeBreaker({ circuitBreakerMaxRuntimeMs: 1000 }, Date.now() - 2000);
  breaker.recordModelTurn({
    step: 1,
    visibleText: "working",
    toolCalls: [],
  });
  const decision = breaker.evaluate();
  assert.equal(decision.action, "stop");
  if (decision.action === "stop") {
    assert.equal(decision.reason, "runtime_limit");
  }
}

{
  const breaker = makeBreaker({ circuitBreakerTokenBudget: 20 });
  breaker.recordModelTurn({
    step: 1,
    visibleText: "working",
    toolCalls: [],
    usage: { promptTokens: 12, completionTokens: 9 },
  });
  const decision = breaker.evaluate();
  assert.equal(decision.action, "stop");
  if (decision.action === "stop") {
    assert.equal(decision.reason, "token_budget");
  }
}

{
  const breaker = makeBreaker({ circuitBreakerEnabled: false });
  breaker.recordModelTurn({
    step: 1,
    visibleText: "done",
    toolCalls: [],
  });
  const decision = breaker.evaluate();
  assert.equal(decision.action, "continue");
}

console.log("agent circuit breaker verification passed");
