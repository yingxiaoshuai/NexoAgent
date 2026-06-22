import type { ToolExecutionContext } from "../types";
import { findStoredModelProfile, findStoredModelProfileByCapability } from "../model-profiles";
import { getOptionalNumberArg, getOptionalStringArg, getStringArg } from "../utils";
import { isModelCapability, type ModelCapability } from "../../../src/shared/types";
import { resolveStoredModelContextBudget } from "../model-context";

interface OpenAICompatibleResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

async function resolveModelConfig(args: Record<string, unknown>, ctx: ToolExecutionContext) {
  const profileQuery = getOptionalStringArg(args, "profile");
  const rawCapability = getOptionalStringArg(args, "capability");
  const capability = rawCapability && isModelCapability(rawCapability) ? rawCapability : "";
  if (rawCapability && !capability) {
    throw new Error(`Unknown model capability: ${rawCapability}`);
  }

  if (profileQuery && profileQuery !== "default") {
    const profile = await findStoredModelProfile(profileQuery);
    if (!profile) {
      throw new Error(`Unknown model profile: ${profileQuery}`);
    }
    const budget = await resolveStoredModelContextBudget({ profile, settings: ctx.settings });

    return {
      name: profile.name,
      apiBase: profile.apiBase,
      apiKey: profile.apiKey,
      model: profile.model,
      temperature: profile.temperature ?? ctx.settings.temperature,
      budget,
    };
  }

  if (capability) {
    const profile = await findStoredModelProfileByCapability(capability)
      ?? (capability === "chat" ? await findStoredModelProfileByCapability("orchestration") : null);
    if (profile) {
      const budget = await resolveStoredModelContextBudget({ profile, settings: ctx.settings });
      return {
        name: profile.name,
        apiBase: profile.apiBase,
        apiKey: profile.apiKey,
        model: profile.model,
        temperature: profile.temperature ?? ctx.settings.temperature,
        budget,
      };
    }
    throw new Error(`No enabled model profile is configured for capability "${capability}". Configure a specialist model in Settings > Models.`);
  }

  if (!profileQuery || profileQuery === "default") {
    const budget = await resolveStoredModelContextBudget({ settings: ctx.settings });
    return {
      name: "default",
      apiBase: ctx.apiBase,
      apiKey: ctx.apiKey,
      model: ctx.settings.model,
      temperature: ctx.settings.temperature,
      budget,
    };
  }

  throw new Error(`Unable to resolve model profile: ${profileQuery}`);
}

export async function invokeModel(args: Record<string, unknown>, ctx: ToolExecutionContext) {
  const prompt = getStringArg(args, "prompt");
  const system = getOptionalStringArg(args, "system");
  const maxTokens = Math.max(64, Math.min(8192, getOptionalNumberArg(args, "maxTokens", 1024)));
  const requestedTemperature = Math.max(0, Math.min(2, getOptionalNumberArg(args, "temperature", Number.NaN)));
  const config = await resolveModelConfig(args, ctx);

  if (!config.apiKey.trim()) {
    throw new Error(`Model profile "${config.name}" does not have an API key.`);
  }

  const response = await fetch(`${config.apiBase.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: Number.isFinite(requestedTemperature) ? requestedTemperature : config.temperature,
      max_tokens: maxTokens,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        { role: "user", content: prompt },
      ],
    }),
  });

  const data = await response.json() as OpenAICompatibleResponse;
  if (!response.ok) {
    throw new Error(data.error?.message ?? `Model call failed: ${response.status}`);
  }

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("Model call returned empty content.");
  }

  return [
    `Profile: ${config.name}`,
    `Model: ${config.model}`,
    ...(config.budget?.contextWindowTokens ? [`Context budget: window=${config.budget.contextWindowTokens}, reserved_output=${config.budget.reservedOutputTokens ?? 0}, source=${config.budget.contextWindowSource ?? "default"}`] : []),
    ...(data.usage ? [`Usage: prompt=${data.usage.prompt_tokens ?? 0}, completion=${data.usage.completion_tokens ?? 0}, total=${data.usage.total_tokens ?? 0}`] : []),
    "",
    content,
  ].join("\n");
}
