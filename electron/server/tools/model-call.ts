import type { ToolExecutionContext } from "../types";
import { callChatCompletion, resolveModelConfigFromArgs, resolveThinkingRequestConfig } from "../model-runtime";
import { getOptionalNumberArg, getOptionalStringArg, getStringArg } from "../utils";
import { isModelCapability, type ModelCapability } from "../../../src/shared/types";
import { analyzeImage, editImage, generateImage, synthesizeSpeech, transcribeAudio } from "./multimodal";

function readCapability(args: Record<string, unknown>): ModelCapability | "" {
  const rawCapability = getOptionalStringArg(args, "capability");
  if (!rawCapability) return "";
  if (!isModelCapability(rawCapability)) {
    throw new Error(`Unknown model capability: ${rawCapability}`);
  }
  return rawCapability;
}

function readStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function inferCapability(args: Record<string, unknown>, explicitCapability: ModelCapability | ""): ModelCapability | "" {
  if (explicitCapability) return explicitCapability;
  if (readStringList(args.images ?? args.image ?? args.imageUrl ?? args.image_url).length > 0) {
    return "vision";
  }
  if (getOptionalStringArg(args, "audio") || getOptionalStringArg(args, "audioUrl") || getOptionalStringArg(args, "audio_url")) {
    return "speech_to_text";
  }
  if ((getOptionalStringArg(args, "input") || getOptionalStringArg(args, "text")) && (getOptionalStringArg(args, "voice") || getOptionalStringArg(args, "instructions"))) {
    return "text_to_speech";
  }
  return "";
}

export async function invokeModel(args: Record<string, unknown>, ctx: ToolExecutionContext) {
  const explicitCapability = readCapability(args);
  const capability = inferCapability(args, explicitCapability);

  if (capability === "vision") {
    const prompt = getOptionalStringArg(args, "prompt", "Describe the provided image.");
    return analyzeImage({ ...args, prompt }, ctx);
  }

  if (capability === "image_generation") {
    const prompt = getStringArg(args, "prompt");
    return generateImage({ ...args, prompt }, ctx);
  }

  if (capability === "image_editing") {
    const prompt = getStringArg(args, "prompt");
    return editImage({ ...args, prompt }, ctx);
  }

  if (capability === "speech_to_text") {
    return transcribeAudio(args, ctx);
  }

  if (capability === "text_to_speech") {
    const input = getStringArg(args, "input", ["text", "prompt"]);
    return synthesizeSpeech({ ...args, input }, ctx);
  }

  if (capability === "embedding") {
    throw new Error("invoke_model does not support embedding output.");
  }

  const prompt = getStringArg(args, "prompt", ["input", "text"]);
  const system = getOptionalStringArg(args, "system");
  const maxTokens = Math.max(64, Math.min(8192, getOptionalNumberArg(args, "maxTokens", 1024)));
  const requestedTemperature = Math.max(0, Math.min(2, getOptionalNumberArg(args, "temperature", Number.NaN)));
  const config = await resolveModelConfigFromArgs(args, ctx, { allowDefault: true });

  if (!config.apiKey.trim()) {
    throw new Error(`Model profile "${config.name}" does not have an API key.`);
  }

  const result = await callChatCompletion(config, [
    ...(system ? [{ role: "system" as const, content: system }] : []),
    { role: "user" as const, content: prompt },
  ], {
    temperature: Number.isFinite(requestedTemperature) ? requestedTemperature : config.temperature,
    maxTokens,
    thinking: resolveThinkingRequestConfig(ctx.settings, config.model, {
      thinkingEnabled: config.thinkingEnabled,
      thinkingEffort: config.thinkingEffort,
    }),
  });

  return [
    `Profile: ${config.name}`,
    `Model: ${config.model}`,
    ...(config.contextWindowTokens ? [`Context budget: window=${config.contextWindowTokens}, reserved_output=${config.reservedOutputTokens ?? 0}, source=${config.contextWindowSource ?? "default"}`] : []),
    ...(result.usage ? [`Usage: prompt=${result.usage.prompt_tokens ?? 0}, completion=${result.usage.completion_tokens ?? 0}, total=${result.usage.total_tokens ?? 0}`] : []),
    "",
    result.content,
  ].join("\n");
}
