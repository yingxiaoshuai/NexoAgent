import type { AgentSettings, ChatMessage, ModelCapability, TurnCompletionStatus } from "../../src/shared/types";

export type TurnStopReason =
  | "completed"
  | "user_interrupt"
  | "circuit_breaker"
  | "precondition_failed"
  | "runtime_error";

export type StreamEvent =
  | { type: "token"; content: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; output: string; elapsed: number }
  | {
      type: "done";
      content: string;
      status: TurnCompletionStatus;
      usage?: { promptTokens?: number; completionTokens?: number };
      stopReason?: TurnStopReason;
      hasSnapshot?: boolean;
      attachments?: ChatAttachment[];
      circuitBreaker?: {
        reason: string;
        detail: string;
        step: number;
      };
      contextBudget?: {
        contextWindowTokens?: number;
        maxInputTokens?: number;
        autoCompactTokenLimit?: number;
        estimatedPromptTokens?: number;
        source?: string;
      };
    }
  | { type: "error"; message: string };

export interface Session {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  threadSummary?: string;
  threadSummaryUpdatedAt?: string;
  threadSummaryVersion?: number;
}

export interface ToolExecutionContext {
  settings: AgentSettings;
  apiKey: string;
  apiBase: string;
  capabilitySummary?: Record<ModelCapability, string[]>;
}

export interface ToolDef {
  name: string;
  label: string;
  group: string;
  description: string;
  parameters: Record<string, unknown>;
  sourceServerName?: string;
  execute: (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<string>;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  enabled: boolean;
  runOnce?: boolean;
  runAt?: string;
  createdAt: string;
  lastRun?: string;
  lastRunStatus?: TurnCompletionStatus;
  lastError?: string;
}

export type ChatAttachment = NonNullable<ChatMessage["attachments"]>[number];

export interface StoredArtifact extends ChatAttachment {
  path: string;
}
