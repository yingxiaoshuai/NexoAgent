import type { CircuitBreakerInfo, CircuitBreakerReason, AgentSettings } from "../../src/shared/types";

export interface CircuitBreakerUsageSnapshot {
  promptTokens?: number;
  completionTokens?: number;
}

export interface CircuitBreakerToolCall {
  name: string;
  args: unknown;
}

export interface CircuitBreakerToolResult {
  name: string;
  args: unknown;
  output: string;
  elapsedSeconds: number;
}

export interface CircuitBreakerModelTurn {
  step: number;
  visibleText: string;
  toolCalls: CircuitBreakerToolCall[];
  usage?: CircuitBreakerUsageSnapshot;
}

export type CircuitBreakerDecision =
  | { action: "continue" }
  | {
      action: "stop";
      reason: CircuitBreakerReason;
      detail: string;
      step: number;
    };

interface CircuitBreakerState {
  consecutiveFailureCount: number;
  noProgressCount: number;
  accumulatedTokens: number;
  lastFingerprint: string;
  repeatedFingerprintCount: number;
  lastVisibleOutputSignature: string;
  repeatedVisibleOutputCount: number;
  lastUsefulOutputSignature: string;
}

const DEFAULT_STATE: CircuitBreakerState = {
  consecutiveFailureCount: 0,
  noProgressCount: 0,
  accumulatedTokens: 0,
  lastFingerprint: "",
  repeatedFingerprintCount: 0,
  lastVisibleOutputSignature: "",
  repeatedVisibleOutputCount: 0,
  lastUsefulOutputSignature: "",
};

const REPEATED_VISIBLE_OUTPUT_LIMIT = 4;

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function normalizeText(value: string) {
  return value.replace(/\r/g, "").replace(/\s+/g, " ").trim();
}

function summarizeToolCalls(calls: CircuitBreakerToolCall[]) {
  return calls
    .map((call) => `${call.name}:${stableSerialize(call.args)}`)
    .sort()
    .join("|");
}

function fingerprintToolCalls(calls: CircuitBreakerToolCall[]) {
  if (!calls.length) return "";
  return summarizeToolCalls(calls);
}

function isFailureOutput(output: string) {
  const normalized = normalizeText(output);
  return normalized.startsWith("Error:")
    || normalized.includes("[BLOCKED]")
    || normalized.includes("exit_code: timeout")
    || normalized.includes("timed_out_after_ms:");
}

function usefulOutputSignature(output: string) {
  const normalized = normalizeText(output);
  if (!normalized || isFailureOutput(output)) return "";
  return normalized.slice(0, 400);
}

function visibleOutputSignature(output: string) {
  const normalized = normalizeText(output);
  if (!normalized) return "";
  return normalized.slice(0, 400);
}

export function circuitBreakerInfoFromDecision(decision: Extract<CircuitBreakerDecision, { action: "stop" }>): CircuitBreakerInfo {
  return {
    reason: decision.reason,
    detail: decision.detail,
    step: decision.step,
  };
}

export class AgentLoopCircuitBreaker {
  private readonly settings: AgentSettings;
  private readonly startedAt: number;
  private readonly state: CircuitBreakerState;
  private lastStep = 0;

  constructor(settings: AgentSettings, startedAt = Date.now()) {
    this.settings = settings;
    this.startedAt = startedAt;
    this.state = { ...DEFAULT_STATE };
  }

  recordModelTurn(turn: CircuitBreakerModelTurn) {
    this.lastStep = Math.max(this.lastStep, turn.step);

    const usageTotal = (turn.usage?.promptTokens ?? 0) + (turn.usage?.completionTokens ?? 0);
    this.state.accumulatedTokens += usageTotal;

    const fingerprint = fingerprintToolCalls(turn.toolCalls);
    if (fingerprint && fingerprint === this.state.lastFingerprint) {
      this.state.repeatedFingerprintCount += 1;
    } else if (fingerprint) {
      this.state.lastFingerprint = fingerprint;
      this.state.repeatedFingerprintCount = 1;
    } else {
      this.state.lastFingerprint = "";
      this.state.repeatedFingerprintCount = 0;
    }

    const visibleSignature = turn.toolCalls.length > 0 ? visibleOutputSignature(turn.visibleText) : "";
    if (visibleSignature && visibleSignature === this.state.lastVisibleOutputSignature) {
      this.state.repeatedVisibleOutputCount += 1;
    } else if (visibleSignature) {
      this.state.lastVisibleOutputSignature = visibleSignature;
      this.state.repeatedVisibleOutputCount = 1;
    } else {
      this.state.lastVisibleOutputSignature = "";
      this.state.repeatedVisibleOutputCount = 0;
    }

    const madeVisibleProgress = normalizeText(turn.visibleText).length > 0;
    if (madeVisibleProgress) {
      this.state.noProgressCount = 0;
    } else if (turn.toolCalls.length > 0) {
      this.state.noProgressCount += 1;
    }
  }

  recordToolResult(result: CircuitBreakerToolResult) {
    const outputSignature = usefulOutputSignature(result.output);
    if (isFailureOutput(result.output)) {
      this.state.consecutiveFailureCount += 1;
    } else {
      this.state.consecutiveFailureCount = 0;
    }

    if (outputSignature && outputSignature !== this.state.lastUsefulOutputSignature) {
      this.state.lastUsefulOutputSignature = outputSignature;
      this.state.repeatedVisibleOutputCount = 0;
      this.state.noProgressCount = 0;
    } else if (!outputSignature) {
      this.state.noProgressCount += 1;
    }
  }

  evaluate(): CircuitBreakerDecision {
    const step = this.lastStep;
    const failureLimit = Math.max(1, this.settings.circuitBreakerConsecutiveFailureLimit ?? 3);
    if (this.state.consecutiveFailureCount >= failureLimit) {
      return {
        action: "stop",
        reason: "consecutive_failures",
        detail: `Tool execution failed or was blocked ${this.state.consecutiveFailureCount} times in a row.`,
        step,
      };
    }

    if (this.state.repeatedVisibleOutputCount >= REPEATED_VISIBLE_OUTPUT_LIMIT && this.state.lastVisibleOutputSignature) {
      return {
        action: "stop",
        reason: "repeated_visible_output",
        detail: `The model produced the same visible output ${this.state.repeatedVisibleOutputCount} times in a row while still trying to continue.`,
        step,
      };
    }

    const repeatedToolLimit = Math.max(1, this.settings.circuitBreakerRepeatedToolCallLimit ?? 3);
    if (this.state.repeatedFingerprintCount >= repeatedToolLimit && this.state.lastFingerprint) {
      return {
        action: "stop",
        reason: "repeated_tool_calls",
        detail: `Equivalent tool calls repeated ${this.state.repeatedFingerprintCount} times without enough progress.`,
        step,
      };
    }

    const noProgressLimit = Math.max(1, this.settings.circuitBreakerNoProgressLimit ?? 4);
    if (this.state.noProgressCount >= noProgressLimit) {
      return {
        action: "stop",
        reason: "no_progress",
        detail: `The run made no useful visible progress for ${this.state.noProgressCount} consecutive checks.`,
        step,
      };
    }

    const runtimeLimit = Math.max(1_000, this.settings.circuitBreakerMaxRuntimeMs ?? 600_000);
    const elapsedMs = Date.now() - this.startedAt;
    if (elapsedMs >= runtimeLimit) {
      return {
        action: "stop",
        reason: "runtime_limit",
        detail: `The run exceeded the configured runtime limit of ${runtimeLimit}ms.`,
        step,
      };
    }

    const tokenBudget = Math.max(0, this.settings.circuitBreakerTokenBudget ?? 0);
    if (tokenBudget > 0 && this.state.accumulatedTokens >= tokenBudget) {
      return {
        action: "stop",
        reason: "token_budget",
        detail: `The run exceeded the configured token budget of ${tokenBudget}.`,
        step,
      };
    }

    return { action: "continue" };
  }
}

export function createAgentLoopCircuitBreaker(settings: AgentSettings, startedAt = Date.now()) {
  return new AgentLoopCircuitBreaker(settings, startedAt);
}
