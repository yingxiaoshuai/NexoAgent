import type { ProviderId } from "./types";

export interface ServiceProviderPreset {
  label: string;
  providerId: ProviderId;
  apiBase: string;
  aliases?: string[];
  hostnames?: string[];
}

export const PROVIDER_DEFAULTS: Record<ProviderId, { name: string; apiBase: string }> = {
  "openai-compatible": {
    name: "OpenAI 兼容协议",
    apiBase: "https://api.openai.com/v1",
  },
  "anthropic-compatible": {
    name: "Anthropic 兼容协议",
    apiBase: "https://api.anthropic.com/v1",
  },
};

export const PROVIDER_OPTIONS: Array<{ value: ProviderId; label: string }> = Object.entries(PROVIDER_DEFAULTS).map(
  ([value, config]) => ({
    value: value as ProviderId,
    label: config.name,
  })
);

export const SERVICE_PROVIDER_PRESETS: ServiceProviderPreset[] = [
  {
    label: "OpenAI",
    providerId: "openai-compatible",
    apiBase: "https://api.openai.com/v1",
    aliases: ["openai", "gpt"],
    hostnames: ["api.openai.com"],
  },
  {
    label: "DeepSeek",
    providerId: "openai-compatible",
    apiBase: "https://api.deepseek.com/v1",
    aliases: ["deepseek"],
    hostnames: ["api.deepseek.com"],
  },
  {
    label: "MiniMax",
    providerId: "openai-compatible",
    apiBase: "https://api.minimaxi.com/v1",
    aliases: ["minimax"],
    hostnames: ["api.minimaxi.com", "api.minimax.io"],
  },
  {
    label: "GLM",
    providerId: "openai-compatible",
    apiBase: "https://open.bigmodel.cn/api/paas/v4",
    aliases: ["glm", "zhipu", "智谱", "智谱ai", "bigmodel"],
    hostnames: ["open.bigmodel.cn", "api.z.ai"],
  },
  {
    label: "Qwen",
    providerId: "openai-compatible",
    apiBase: "",
    aliases: ["qwen", "dashscope", "通义千问", "通义"],
    hostnames: ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com", "coding.dashscope.aliyuncs.com"],
  },
  {
    label: "Doubao",
    providerId: "openai-compatible",
    apiBase: "https://ark.cn-beijing.volces.com/api/v3",
    aliases: ["doubao", "ark", "豆包", "火山方舟"],
    hostnames: ["ark.cn-beijing.volces.com"],
  },
  {
    label: "Kimi",
    providerId: "openai-compatible",
    apiBase: "https://api.moonshot.cn/v1",
    aliases: ["kimi", "moonshot"],
    hostnames: ["api.moonshot.cn", "api.kimi.com"],
  },
  {
    label: "ERNIE",
    providerId: "openai-compatible",
    apiBase: "https://qianfan.baidubce.com/v2",
    aliases: ["ernie", "qianfan", "百度千帆", "文心一言"],
    hostnames: ["qianfan.baidubce.com"],
  },
  {
    label: "Gemini",
    providerId: "openai-compatible",
    apiBase: "https://generativelanguage.googleapis.com",
    aliases: ["gemini", "google"],
    hostnames: ["generativelanguage.googleapis.com"],
  },
  {
    label: "LinkAI",
    providerId: "openai-compatible",
    apiBase: "https://api.link-ai.tech",
    aliases: ["linkai"],
    hostnames: ["api.link-ai.tech"],
  },
  {
    label: "OpenRouter",
    providerId: "openai-compatible",
    apiBase: "https://openrouter.ai/api/v1",
    aliases: ["openrouter"],
    hostnames: ["openrouter.ai"],
  },
  {
    label: "SiliconFlow",
    providerId: "openai-compatible",
    apiBase: "https://api.siliconflow.cn/v1",
    aliases: ["siliconflow", "硅基流动"],
    hostnames: ["api.siliconflow.cn"],
  },
  {
    label: "小米 Mimo",
    providerId: "openai-compatible",
    apiBase: "https://api.xiaomimimo.com/v1",
    aliases: ["mimo", "xiaomimimo", "小米", "小米mimo"],
    hostnames: ["api.xiaomimimo.com"],
  },
  {
    label: "Claude",
    providerId: "anthropic-compatible",
    apiBase: "https://api.anthropic.com/v1",
    aliases: ["claude", "anthropic"],
    hostnames: ["api.anthropic.com"],
  },
  {
    label: "自定义",
    providerId: "openai-compatible",
    apiBase: "",
    aliases: ["custom", "自定义"],
  },
  {
    label: "自定义",
    providerId: "anthropic-compatible",
    apiBase: "",
    aliases: ["custom", "自定义"],
  },
];

export function normalizeProviderId(providerId: unknown): ProviderId {
  if (providerId === "anthropic-compatible" || providerId === "anthropic") {
    return "anthropic-compatible";
  }
  return "openai-compatible";
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function tryParseHostname(apiBase: string) {
  try {
    return new URL(apiBase.trim()).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function matchesServiceProvider(preset: ServiceProviderPreset, candidate: unknown) {
  const normalizedCandidate = normalizeText(candidate);
  if (!normalizedCandidate) return false;
  return [preset.label, ...(preset.aliases ?? [])]
    .map((item) => item.trim().toLowerCase())
    .includes(normalizedCandidate);
}

export function getServiceProviderPresets(providerId: unknown = "openai-compatible") {
  const normalizedProviderId = normalizeProviderId(providerId);
  return SERVICE_PROVIDER_PRESETS.filter((preset) => preset.providerId === normalizedProviderId);
}

export function getServiceProviderOptions(providerId: unknown = "openai-compatible") {
  return getServiceProviderPresets(providerId).map((preset) => ({
    value: preset.label,
    label: preset.label,
  }));
}

export function getDefaultServiceProviderName(providerId: unknown = "openai-compatible") {
  return getServiceProviderPresets(providerId)[0]?.label ?? "自定义";
}

export function findServiceProviderPreset(providerName: unknown, providerId: unknown = "openai-compatible") {
  return getServiceProviderPresets(providerId).find((preset) => matchesServiceProvider(preset, providerName));
}

export function findServiceProviderPresetByApiBase(apiBase: string, providerId: unknown = "openai-compatible") {
  const hostname = tryParseHostname(apiBase);
  if (!hostname) return null;

  return getServiceProviderPresets(providerId).find((preset) =>
    (preset.hostnames ?? []).some((item) => {
      const normalizedItem = item.trim().toLowerCase();
      return hostname === normalizedItem || hostname.endsWith(`.${normalizedItem}`);
    })
  ) ?? null;
}

export function getServiceProviderDefaultApiBase(providerName: unknown, providerId: unknown = "openai-compatible") {
  return findServiceProviderPreset(providerName, providerId)?.apiBase ?? "";
}

export function getProviderDefaultApiBase(providerId: unknown = "openai-compatible") {
  return PROVIDER_DEFAULTS[normalizeProviderId(providerId)]?.apiBase ?? PROVIDER_DEFAULTS["openai-compatible"].apiBase;
}

export function getProviderName(providerId: unknown = "openai-compatible") {
  return PROVIDER_DEFAULTS[normalizeProviderId(providerId)]?.name ?? PROVIDER_DEFAULTS["openai-compatible"].name;
}

export function inferServiceProviderName(apiBase: string, providerId: unknown = "openai-compatible") {
  const preset = findServiceProviderPresetByApiBase(apiBase, providerId);
  if (preset) return preset.label;

  const trimmed = apiBase.trim();
  if (!trimmed) return "";

  try {
    const hostname = new URL(trimmed).hostname
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/^api\./, "");
    return hostname.split(".")[0] ?? "";
  } catch {
    return "";
  }
}

export function normalizeServiceProviderName(
  providerName: unknown,
  apiBase: string,
  providerId: unknown = "openai-compatible"
) {
  const explicitName = typeof providerName === "string" ? providerName.trim() : "";
  const explicitPreset = findServiceProviderPreset(explicitName, providerId);
  if (explicitPreset) return explicitPreset.label;

  const basePreset = findServiceProviderPresetByApiBase(apiBase, providerId);
  if (basePreset) return basePreset.label;

  return explicitName || inferServiceProviderName(apiBase, providerId);
}
