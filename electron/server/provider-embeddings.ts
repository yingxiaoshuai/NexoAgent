import { getProviderDefaultApiBase, normalizeProviderId, normalizeServiceProviderName } from "../../src/shared/providers";
import type { ProviderId } from "../../src/shared/types";

export type EmbeddingPurpose = "retrieval_query" | "retrieval_document";
export type ProviderEmbeddingTransport = "openai-compatible" | "gemini";

export interface ProviderEmbeddingLookupInput {
  providerId?: ProviderId;
  providerName?: string;
  apiBase?: string;
  model?: string;
}

export interface ResolvedProviderEmbeddingConfig {
  providerId: ProviderId;
  providerName: string;
  apiBase: string;
  model: string;
  transport: ProviderEmbeddingTransport;
}

interface ProviderEmbeddingSupport {
  providerId: ProviderId;
  providerName: string;
  apiBase: string;
  defaultModel?: string;
  transport?: ProviderEmbeddingTransport;
  allowConfiguredModel: boolean;
}

const EMBEDDING_MODEL_PATTERN = /\b(text-embedding|embedding|bge|gte|e5|m3e|voyage|jina)\b/i;
const EMBEDDING_EXCLUSION_PATTERN = /\b(rerank|reranker)\b/i;

function normalizeApiBase(apiBase: string) {
  return apiBase.trim().replace(/\/+$/, "");
}

function isGenericApiPath(pathname: string) {
  const normalized = pathname.replace(/\/+$/, "");
  if (!normalized || normalized === "/") return true;
  const segments = normalized.split("/").filter(Boolean).map((segment) => segment.toLowerCase());
  if (segments.length === 1) {
    return ["api", "compatible-mode", "v1", "v2", "v3", "v4"].includes(segments[0]);
  }
  if (segments.length === 2) {
    const joined = segments.join("/");
    return joined === "api/v1"
      || joined === "api/v2"
      || joined === "api/v3"
      || joined === "api/v4"
      || joined === "compatible-mode/v1";
  }
  return false;
}

function normalizeKnownApiBase(apiBase: string, fallbackBase: string, knownHosts: string[]) {
  const normalized = normalizeApiBase(apiBase);
  if (!normalized) return fallbackBase;

  try {
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();
    const matchesKnownHost = knownHosts.some((knownHost) => hostname === knownHost || hostname.endsWith(`.${knownHost}`));
    if (!matchesKnownHost) return normalized;

    const fallback = new URL(fallbackBase);
    const currentPath = url.pathname.replace(/\/+$/, "");
    const fallbackPath = fallback.pathname.replace(/\/+$/, "");
    if (!currentPath || currentPath === "/" || currentPath === fallbackPath || isGenericApiPath(currentPath)) {
      url.pathname = fallback.pathname;
      url.search = "";
      url.hash = "";
      return normalizeApiBase(url.toString());
    }
    return normalized;
  } catch {
    return normalized;
  }
}

function resolveProviderEmbeddingSupport(input: ProviderEmbeddingLookupInput = {}): ProviderEmbeddingSupport {
  const providerId = normalizeProviderId(input.providerId);
  const fallbackApiBase = normalizeApiBase(getProviderDefaultApiBase(providerId));
  const rawApiBase = normalizeApiBase(input.apiBase || "");
  const normalizedProviderName = normalizeServiceProviderName(
    input.providerName || "",
    rawApiBase || fallbackApiBase,
    providerId,
  );
  const ignoreProtocolDefaultBase = Boolean(rawApiBase)
    && rawApiBase === fallbackApiBase
    && normalizedProviderName !== "OpenAI"
    && normalizedProviderName !== "Custom";
  const effectiveApiBase = ignoreProtocolDefaultBase ? "" : rawApiBase;
  const normalizedApiBase = effectiveApiBase || fallbackApiBase;

  if (providerId === "anthropic-compatible") {
    return {
      providerId,
      providerName: normalizedProviderName || "Claude",
      apiBase: normalizedApiBase || "https://api.anthropic.com/v1",
      allowConfiguredModel: false,
    };
  }

  switch (normalizedProviderName) {
    case "OpenAI":
      return {
        providerId,
        providerName: normalizedProviderName,
        apiBase: normalizeKnownApiBase(effectiveApiBase, "https://api.openai.com/v1", ["api.openai.com"]),
        defaultModel: "text-embedding-3-small",
        transport: "openai-compatible",
        allowConfiguredModel: true,
      };
    case "Qwen":
      return {
        providerId,
        providerName: normalizedProviderName,
        apiBase: normalizeKnownApiBase(
          effectiveApiBase,
          "https://dashscope.aliyuncs.com/compatible-mode/v1",
          ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com", "coding.dashscope.aliyuncs.com"],
        ),
        defaultModel: "text-embedding-v4",
        transport: "openai-compatible",
        allowConfiguredModel: true,
      };
    case "GLM":
      return {
        providerId,
        providerName: normalizedProviderName,
        apiBase: normalizeKnownApiBase(effectiveApiBase, "https://open.bigmodel.cn/api/paas/v4", ["open.bigmodel.cn", "api.z.ai"]),
        defaultModel: "embedding-3",
        transport: "openai-compatible",
        allowConfiguredModel: true,
      };
    case "ERNIE":
      return {
        providerId,
        providerName: normalizedProviderName,
        apiBase: normalizeKnownApiBase(effectiveApiBase, "https://qianfan.baidubce.com/v2", ["qianfan.baidubce.com"]),
        defaultModel: "embedding-v1",
        transport: "openai-compatible",
        allowConfiguredModel: true,
      };
    case "Gemini":
      return {
        providerId,
        providerName: normalizedProviderName,
        apiBase: normalizeKnownApiBase(effectiveApiBase, "https://generativelanguage.googleapis.com/v1beta", ["generativelanguage.googleapis.com"]),
        defaultModel: "gemini-embedding-2",
        transport: "gemini",
        allowConfiguredModel: true,
      };
    case "OpenRouter":
      return {
        providerId,
        providerName: normalizedProviderName,
        apiBase: normalizeKnownApiBase(effectiveApiBase, "https://openrouter.ai/api/v1", ["openrouter.ai"]),
        defaultModel: "openai/text-embedding-3-small",
        transport: "openai-compatible",
        allowConfiguredModel: true,
      };
    case "SiliconFlow":
      return {
        providerId,
        providerName: normalizedProviderName,
        apiBase: normalizeKnownApiBase(effectiveApiBase, "https://api.siliconflow.cn/v1", ["api.siliconflow.cn"]),
        defaultModel: "Qwen/Qwen3-Embedding-8B",
        transport: "openai-compatible",
        allowConfiguredModel: true,
      };
    case "Doubao":
      return {
        providerId,
        providerName: normalizedProviderName,
        apiBase: normalizeKnownApiBase(effectiveApiBase, "https://ark.cn-beijing.volces.com/api/v3", ["ark.cn-beijing.volces.com"]),
        defaultModel: "doubao-embedding-large",
        transport: "openai-compatible",
        allowConfiguredModel: true,
      };
    case "LinkAI":
      return {
        providerId,
        providerName: normalizedProviderName,
        apiBase: normalizeKnownApiBase(effectiveApiBase, "https://api.link-ai.tech", ["api.link-ai.tech"]),
        allowConfiguredModel: false,
      };
    case "DeepSeek":
      return {
        providerId,
        providerName: normalizedProviderName,
        apiBase: normalizeKnownApiBase(effectiveApiBase, "https://api.deepseek.com", ["api.deepseek.com"]),
        transport: "openai-compatible",
        allowConfiguredModel: true,
      };
    case "MiniMax":
      return {
        providerId,
        providerName: normalizedProviderName,
        apiBase: normalizeKnownApiBase(effectiveApiBase, "https://api.minimaxi.com/v1", ["api.minimaxi.com", "api.minimax.io"]),
        transport: "openai-compatible",
        allowConfiguredModel: true,
      };
    case "Kimi":
      return {
        providerId,
        providerName: normalizedProviderName,
        apiBase: normalizeKnownApiBase(effectiveApiBase, "https://api.moonshot.cn/v1", ["api.moonshot.cn", "api.kimi.com"]),
        transport: "openai-compatible",
        allowConfiguredModel: true,
      };
    case "Xiaomi Mimo":
      return {
        providerId,
        providerName: normalizedProviderName,
        apiBase: normalizeKnownApiBase(effectiveApiBase, "https://api.xiaomimimo.com/v1", ["api.xiaomimimo.com"]),
        transport: "openai-compatible",
        allowConfiguredModel: true,
      };
    case "Custom":
      return {
        providerId,
        providerName: normalizedProviderName || "Custom",
        apiBase: normalizedApiBase || fallbackApiBase,
        transport: "openai-compatible",
        allowConfiguredModel: true,
      };
    default:
      return {
        providerId,
        providerName: normalizedProviderName || "Custom",
        apiBase: normalizedApiBase || fallbackApiBase,
        transport: "openai-compatible",
        allowConfiguredModel: true,
      };
  }
}

export function isLikelyEmbeddingModel(model: string) {
  const normalized = model.trim();
  return Boolean(normalized) && EMBEDDING_MODEL_PATTERN.test(normalized) && !EMBEDDING_EXCLUSION_PATTERN.test(normalized);
}

export function getProviderEmbeddingAutoConfig(
  input: ProviderEmbeddingLookupInput = {},
): ResolvedProviderEmbeddingConfig | null {
  const support = resolveProviderEmbeddingSupport(input);
  if (!support.transport || !support.defaultModel) return null;
  return {
    providerId: support.providerId,
    providerName: support.providerName,
    apiBase: support.apiBase,
    model: support.defaultModel,
    transport: support.transport,
  };
}

export function getProviderEmbeddingRuntimeConfig(
  input: ProviderEmbeddingLookupInput = {},
): ResolvedProviderEmbeddingConfig | null {
  const support = resolveProviderEmbeddingSupport(input);
  if (!support.transport) return null;

  const configuredModel = isLikelyEmbeddingModel(input.model || "") ? input.model!.trim() : "";
  const model = configuredModel || (support.allowConfiguredModel ? support.defaultModel || "" : "");
  if (!model) return null;

  return {
    providerId: support.providerId,
    providerName: support.providerName,
    apiBase: support.apiBase,
    model,
    transport: support.transport,
  };
}

export function formatGeminiRetrievalText(text: string, purpose: EmbeddingPurpose) {
  return purpose === "retrieval_query"
    ? `task: search result | query: ${text}`
    : `title: none | text: ${text}`;
}
