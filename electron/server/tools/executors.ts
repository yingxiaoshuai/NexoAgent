import { isMemoryKind, recallMemory, type MemoryKind } from "../../memory";
import { resolveMemoryEmbeddingSettings } from "../memory-embedding";
import type { ToolExecutionContext } from "../types";
import { getOptionalNumberArg, getOptionalStringArg, getStringArg } from "../utils";
import { invokeModel } from "./model-call";
import { runShellCommand } from "./shell-command";

export type ToolExecutor = (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<string>;

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

export const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  invoke_model: async (args, ctx) => invokeModel(args, ctx),
  shell_command: async (args, ctx) => runShellCommand(args, ctx),
  recall_memory: async (args, ctx) => {
    const query = getStringArg(args, "query", ["q"]);
    const kinds = readMemoryKinds(args.kinds ?? args.kind);
    const dayKey = getOptionalStringArg(args, "dayKey") || getOptionalStringArg(args, "day_key");
    const k = getOptionalNumberArg(args, "k", 6);
    const embeddingSettings = await resolveToolEmbeddingSettings(ctx);
    const result = await recallMemory(query, embeddingSettings, undefined, k, kinds, dayKey || undefined);
    return result || "No relevant memory found.";
  },
};
