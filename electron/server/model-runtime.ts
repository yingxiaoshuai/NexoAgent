import type { AgentSettings, ChatMessage, ModelCapability, ProviderId } from "../../src/shared/types";
import { isModelCapability } from "../../src/shared/types";
import { findStoredModelProfile, findStoredModelProfileByCapability, getPrimaryModelProfile } from "./model-profiles";
import { resolveStoredModelContextBudget } from "./model-context";
import type { ToolExecutionContext } from "./types";
import { getOptionalStringArg, getStringArg } from "./utils";

const MISSING_PRIMARY_MODEL_MESSAGE = "\u672a\u914d\u7f6e\u4e3b\u6a21\u578b\u3002\u8bf7\u5230 Settings > Models \u65b0\u589e\u4e00\u4e2a\u6a21\u578b\uff0c\u586b\u5199 API Key\uff0c\u5e76\u5c06\u5176\u8bbe\u4e3a Primary\u3002";

export interface ModelRuntimeConfig {
  name: string;
  providerId: ProviderId;
  apiBase: string;
  apiKey: string;
  model: string;
  temperature: number;
  contextWindowTokens?: number;
  reservedOutputTokens?: number;
  autoCompactTokenLimit?: number;
  compactionTargetRatio?: number;
  contextWindowSource?: string;
  contextWindowSourceDetail?: string;
  contextWindowResolvedAt?: string;
}

export interface ChatContentTextPart {
  type: "text";
  text: string;
}

export interface ChatContentImagePart {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "low" | "high" | "original" | "auto";
  };
}

export type ChatContentPart = ChatContentTextPart | ChatContentImagePart;

export type ChatCompletionMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
};

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string };
}

interface OpenAIImageResponse {
  data?: Array<{
    b64_json?: string;
    url?: string;
    revised_prompt?: string;
  }>;
  error?: { message?: string };
}

interface AnthropicMessageContentText {
  type: "text";
  text: string;
}

interface AnthropicMessageResponse {
  content?: AnthropicMessageContentText[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: { message?: string };
}

function toRuntimeConfig(
  name: string,
  providerId: ProviderId,
  apiBase: string,
  apiKey: string,
  model: string,
  temperature: number,
  contextBudget: Partial<ModelRuntimeConfig> = {}
): ModelRuntimeConfig {
  return {
    name,
    providerId,
    apiBase: apiBase.replace(/\/+$/, ""),
    apiKey: apiKey.trim(),
    model: model.trim(),
    temperature,
    contextWindowTokens: contextBudget.contextWindowTokens,
    reservedOutputTokens: contextBudget.reservedOutputTokens,
    autoCompactTokenLimit: contextBudget.autoCompactTokenLimit,
    compactionTargetRatio: contextBudget.compactionTargetRatio,
    contextWindowSource: contextBudget.contextWindowSource,
    contextWindowSourceDetail: contextBudget.contextWindowSourceDetail,
    contextWindowResolvedAt: contextBudget.contextWindowResolvedAt,
  };
}

export async function resolvePrimaryModelConfig(settings: AgentSettings, storedApiKey = ""): Promise<ModelRuntimeConfig> {
  const primary = await getPrimaryModelProfile();
  if (primary) {
    const budget = await resolveStoredModelContextBudget({ profile: primary, settings });
    return toRuntimeConfig(primary.name, primary.providerId, primary.apiBase, primary.apiKey, primary.model, primary.temperature ?? settings.temperature, budget);
  }
  const apiKey = settings.apiKey || storedApiKey || "";
  const model = settings.model?.trim() || "";
  if (!model) {
    throw new Error(MISSING_PRIMARY_MODEL_MESSAGE);
  }
  const budget = await resolveStoredModelContextBudget({ settings });
  return toRuntimeConfig("default", settings.providerId, settings.apiBase, apiKey, model, settings.temperature, budget);
}

export async function resolveModelConfigFromArgs(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
  options: { capability?: ModelCapability; allowDefault?: boolean } = {}
): Promise<ModelRuntimeConfig> {
  const profileQuery = getOptionalStringArg(args, "profile");
  const rawCapability = options.capability ?? (getOptionalStringArg(args, "capability") as ModelCapability | "");
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
    return toRuntimeConfig(profile.name, profile.providerId, profile.apiBase, profile.apiKey, profile.model, profile.temperature ?? ctx.settings.temperature, budget);
  }

  if (capability) {
    const profile = await findStoredModelProfileByCapability(capability)
      ?? (capability === "chat" ? await findStoredModelProfileByCapability("orchestration") : null);
    if (profile) {
      const budget = await resolveStoredModelContextBudget({ profile, settings: ctx.settings });
      return toRuntimeConfig(profile.name, profile.providerId, profile.apiBase, profile.apiKey, profile.model, profile.temperature ?? ctx.settings.temperature, budget);
    }
    if (options.allowDefault === false) {
      throw new Error(`No enabled model profile is configured for capability "${capability}". Configure a specialist model in Settings > Models.`);
    }
  }

  if (!profileQuery || profileQuery === "default" || options.allowDefault !== false) {
    const budget = await resolveStoredModelContextBudget({ settings: ctx.settings });
    return toRuntimeConfig("default", ctx.settings.providerId, ctx.apiBase, ctx.apiKey, ctx.settings.model, ctx.settings.temperature, budget);
  }

  throw new Error(`Unable to resolve model profile: ${profileQuery}`);
}

function normalizeChatContent(content: string | ChatContentPart[]) {
  return typeof content === "string" ? content : content;
}

function imageUrlToAnthropicSource(url: string) {
  const dataUrlMatch = url.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  if (dataUrlMatch) {
    return {
      type: "base64",
      media_type: dataUrlMatch[1],
      data: dataUrlMatch[2],
    };
  }
  if (/^https?:\/\//i.test(url)) {
    return {
      type: "url",
      url,
    };
  }
  throw new Error("Anthropic image inputs must be data URLs or HTTP(S) URLs.");
}

function toAnthropicContent(content: string | ChatContentPart[]) {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  return content.map((part) => {
    if (part.type === "text") {
      return { type: "text", text: part.text };
    }
    return {
      type: "image",
      source: imageUrlToAnthropicSource(part.image_url.url),
    };
  });
}

async function callAnthropicMessages(
  config: ModelRuntimeConfig,
  messages: ChatCompletionMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => typeof message.content === "string" ? message.content : "")
    .filter(Boolean)
    .join("\n\n");
  const anthropicMessages = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: toAnthropicContent(message.content),
    }));

  const response = await fetch(`${config.apiBase}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? config.temperature,
      ...(system ? { system } : {}),
      messages: anthropicMessages,
    }),
  });

  const data = await response.json().catch(() => ({})) as AnthropicMessageResponse;
  if (!response.ok) {
    throw new Error(data.error?.message ?? `Anthropic model call failed: ${response.status}`);
  }

  const content = (data.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
  if (!content) {
    throw new Error("Anthropic model call returned empty content.");
  }

  return {
    content,
    usage: {
      prompt_tokens: data.usage?.input_tokens,
      completion_tokens: data.usage?.output_tokens,
      total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    },
  };
}

export async function callChatCompletion(
  config: ModelRuntimeConfig,
  messages: ChatCompletionMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
) {
  if (config.providerId === "anthropic-compatible") {
    return callAnthropicMessages(config, messages, options);
  }

  const response = await fetch(`${config.apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: options.temperature ?? config.temperature,
      max_tokens: options.maxTokens ?? 1024,
      messages: messages.map((message) => ({
        role: message.role,
        content: normalizeChatContent(message.content),
      })),
    }),
  });

  const data = await response.json().catch(() => ({})) as OpenAIChatResponse;
  if (!response.ok) {
    throw new Error(data.error?.message ?? `Model call failed: ${response.status}`);
  }

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("Model call returned empty content.");
  }

  return {
    content,
    usage: data.usage,
  };
}

export async function callImageGeneration(
  config: ModelRuntimeConfig,
  args: {
    prompt: string;
    n?: number;
    size?: string;
    quality?: string;
    background?: string;
    outputFormat?: string;
  }
) {
  if (config.providerId === "anthropic-compatible") {
    throw new Error("Anthropic compatible protocol does not provide OpenAI image generation endpoints. Configure an OpenAI-compatible image model for image_generation.");
  }

  const body: Record<string, unknown> = {
    model: config.model,
    prompt: args.prompt,
    n: Math.max(1, Math.min(10, args.n ?? 1)),
  };
  if (args.size) body.size = args.size;
  if (args.quality) body.quality = args.quality;
  if (args.background) body.background = args.background;
  if (args.outputFormat) body.output_format = args.outputFormat;
  if (!/^(gpt-image|chatgpt-image)/i.test(config.model)) {
    body.response_format = "b64_json";
  }

  const response = await fetch(`${config.apiBase}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as OpenAIImageResponse;
  if (!response.ok) {
    throw new Error(data.error?.message ?? `Image generation failed: ${response.status}`);
  }
  return data;
}

export async function callImageEdit(
  config: ModelRuntimeConfig,
  args: {
    prompt: string;
    images: Array<{ buffer: Buffer; filename: string; mimeType: string }>;
    n?: number;
    size?: string;
    quality?: string;
    background?: string;
    inputFidelity?: "low" | "high";
    outputFormat?: string;
  }
) {
  if (config.providerId === "anthropic-compatible") {
    throw new Error("Anthropic compatible protocol does not provide OpenAI image editing endpoints. Configure an OpenAI-compatible image editing model for image_editing.");
  }

  const form = new FormData();
  form.append("model", config.model);
  form.append("prompt", args.prompt);
  form.append("n", String(Math.max(1, Math.min(10, args.n ?? 1))));
  for (const image of args.images) {
    form.append("image", new Blob([toBlobPart(image.buffer)], { type: image.mimeType || "application/octet-stream" }), image.filename);
  }
  if (args.size) form.append("size", args.size);
  if (args.quality) form.append("quality", args.quality);
  if (args.background) form.append("background", args.background);
  if (args.inputFidelity) form.append("input_fidelity", args.inputFidelity);
  if (args.outputFormat) form.append("output_format", args.outputFormat);
  if (!/^(gpt-image|chatgpt-image)/i.test(config.model)) {
    form.append("response_format", "b64_json");
  }

  const response = await fetch(`${config.apiBase}/images/edits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: form,
  });
  const data = await response.json().catch(() => ({})) as OpenAIImageResponse;
  if (!response.ok) {
    throw new Error(data.error?.message ?? `Image edit failed: ${response.status}`);
  }
  return data;
}

export async function callSpeechToText(
  config: ModelRuntimeConfig,
  args: {
    file: Buffer;
    filename: string;
    mimeType: string;
    prompt?: string;
    modelOverride?: string;
  }
) {
  if (config.providerId === "anthropic-compatible") {
    throw new Error("Anthropic compatible protocol does not provide OpenAI speech-to-text endpoints. Configure an OpenAI-compatible audio model for speech_to_text.");
  }

  const form = new FormData();
  const blob = new Blob([toBlobPart(args.file)], { type: args.mimeType || "application/octet-stream" });
  form.append("file", blob, args.filename);
  form.append("model", args.modelOverride || config.model);
  form.append("response_format", "text");
  if (args.prompt) form.append("prompt", args.prompt);

  const response = await fetch(`${config.apiBase}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: form,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Speech-to-text failed: ${response.status}`);
  }
  return text.trim();
}

export async function callTextToSpeech(
  config: ModelRuntimeConfig,
  args: {
    input: string;
    voice?: string;
    instructions?: string;
    modelOverride?: string;
  }
) {
  if (config.providerId === "anthropic-compatible") {
    throw new Error("Anthropic compatible protocol does not provide OpenAI text-to-speech endpoints. Configure an OpenAI-compatible audio model for text_to_speech.");
  }

  const response = await fetch(`${config.apiBase}/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: args.modelOverride || config.model,
      input: args.input,
      voice: args.voice || "alloy",
      instructions: args.instructions,
    }),
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(buffer.toString("utf8") || `Text-to-speech failed: ${response.status}`);
  }

  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "audio/mpeg";
  return { buffer, mimeType };
}

export function toBlobPart(buffer: Buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}
