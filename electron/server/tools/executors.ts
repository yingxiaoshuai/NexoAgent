import { isMemoryKind, recallMemory, storeScriptMemory, type MemoryKind } from "../../memory";
import { browserManager } from "../browser-manager";
import { resolveMemoryEmbeddingSettings } from "../memory-embedding";
import type { ToolExecutionContext } from "../types";
import { getOptionalNumberArg, getOptionalStringArg, getStringArg } from "../utils";
import { invokeModel } from "./model-call";
import { runShellCommand } from "./shell-command";

export type ToolExecutor = (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<string>;

function readObjectArg<T extends Record<string, unknown>>(args: Record<string, unknown>, key: string): T | undefined {
  const value = args[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as T
    : undefined;
}

function readArrayArg<T>(args: Record<string, unknown>, key: string): T[] | undefined {
  const value = args[key];
  return Array.isArray(value) ? value as T[] : undefined;
}

function readMemoryKinds(value: unknown): MemoryKind[] | undefined {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const kinds = raw.map((item) => String(item).trim()).filter(isMemoryKind);
  return kinds.length ? kinds : undefined;
}

async function resolveToolEmbeddingSettings(ctx: ToolExecutionContext) {
  return resolveMemoryEmbeddingSettings({
    providerId: ctx.settings.providerId,
    providerName: ctx.settings.providerName,
    apiKey: ctx.apiKey,
    apiBase: ctx.apiBase,
    model: ctx.settings.model,
    temperature: ctx.settings.temperature,
  });
}

function readMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return { note: value.trim() };
  }
}

function formatBrowserResult(result: Awaited<ReturnType<typeof browserManager.executeAction>>) {
  return JSON.stringify(result, null, 2);
}

function hasOwnValue(args: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(args, key) && args[key] !== undefined;
}

function rejectLegacyBrowserActionArgs(args: Record<string, unknown>) {
  const legacyRootFields = ["ref", "query", "role", "bounds", "relativePosition"].filter((key) => hasOwnValue(args, key));
  if (legacyRootFields.length) {
    throw new Error(
      `browser_action no longer accepts top-level ${legacyRootFields.join(", ")}. Put locators and coordinates under target instead.`,
    );
  }

  const steps = Array.isArray(args.steps) ? args.steps : [];
  const legacyStepIndex = steps.findIndex((step) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) return false;
    const record = step as Record<string, unknown>;
    return hasOwnValue(record, "ref") || hasOwnValue(record, "query") || hasOwnValue(record, "role");
  });
  if (legacyStepIndex >= 0) {
    throw new Error(
      `browser_action.run steps no longer accept ref/query/role at the step root. Move them under steps[${legacyStepIndex}].target instead.`,
    );
  }
}

export const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  invoke_model: async (args, ctx) => invokeModel(args, ctx),
  shell_command: async (args, ctx) => runShellCommand(args, ctx),
  browser_action: async (args) => {
    rejectLegacyBrowserActionArgs(args);
    const limit = args.limit === undefined ? undefined : getOptionalNumberArg(args, "limit", 5);
    const minConfidence = args.minConfidence === undefined ? undefined : getOptionalNumberArg(args, "minConfidence", 0.82);
    const result = await browserManager.executeAction({
      action: getStringArg(args, "action") as Parameters<typeof browserManager.executeAction>[0]["action"],
      url: getOptionalStringArg(args, "url"),
      text: getOptionalStringArg(args, "text"),
      goal: getOptionalStringArg(args, "goal"),
      target: readObjectArg(args, "target"),
      steps: readArrayArg(args, "steps"),
      strategy: getOptionalStringArg(args, "strategy") as Parameters<typeof browserManager.executeAction>[0]["strategy"],
      onFailure: readObjectArg(args, "onFailure"),
      key: getOptionalStringArg(args, "key"),
      submit: Boolean(args.submit),
      direction: getOptionalStringArg(args, "direction", "down") as "up" | "down" | "left" | "right",
      amount: getOptionalNumberArg(args, "amount", 720),
      deltaX: args.deltaX === undefined ? undefined : getOptionalNumberArg(args, "deltaX", 0),
      deltaY: args.deltaY === undefined ? undefined : getOptionalNumberArg(args, "deltaY", 0),
      waitMs: args.waitMs === undefined ? undefined : getOptionalNumberArg(args, "waitMs", 0),
      durationMs: args.durationMs === undefined ? undefined : getOptionalNumberArg(args, "durationMs", 0),
      limit,
      minConfidence,
    });
    return formatBrowserResult(result);
  },
  recall_memory: async (args, ctx) => {
    const query = getStringArg(args, "query", ["q"]);
    const kinds = readMemoryKinds(args.kinds ?? args.kind);
    const dayKey = getOptionalStringArg(args, "dayKey") || getOptionalStringArg(args, "day_key");
    const k = getOptionalNumberArg(args, "k", 6);
    const embeddingSettings = await resolveToolEmbeddingSettings(ctx);
    const result = await recallMemory(query, embeddingSettings, undefined, k, kinds, dayKey || undefined);
    return result || "No relevant memory found.";
  },
  store_script_memory: async (args, ctx) => {
    const key = getStringArg(args, "key");
    const content = getStringArg(args, "content");
    const scope = getOptionalStringArg(args, "scope");
    const dayKey = getOptionalStringArg(args, "dayKey") || getOptionalStringArg(args, "day_key");
    const metadata = readMetadata(args.metadata);
    const embeddingSettings = await resolveToolEmbeddingSettings(ctx);
    const id = await storeScriptMemory(key, content, {
      scope: scope || undefined,
      metadata,
      dayKey: dayKey || undefined,
      embeddingSettings,
    });

    return id
      ? `Stored script memory '${key}' with id ${id}.`
      : `No script memory stored for '${key}' because the content was empty.`;
  },
};
