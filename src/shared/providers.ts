import type { ProviderId } from "./types";

type ProviderLabelLocale = "zh" | "en";

export interface ServiceProviderPreset {
  label: string;
  providerId: ProviderId;
  apiBase: string;
  aliases?: string[];
  hostnames?: string[];
}

const DEFAULT_PROVIDER_ID: ProviderId = "openai-compatible";
const CUSTOM_SERVICE_PROVIDER_LABEL = "Custom";

const PROVIDER_PROTOCOLS: Record<ProviderId, { en: string; zh: string; apiBase: string }> = {
  "openai-compatible": {
    en: "OpenAI Compatible",
    zh: "OpenAI \u517c\u5bb9\u534f\u8bae",
    apiBase: "https://api.openai.com/v1",
  },
  "anthropic-compatible": {
    en: "Anthropic Compatible",
    zh: "Anthropic \u517c\u5bb9\u534f\u8bae",
    apiBase: "https://api.anthropic.com/v1",
  },
};

export const PROVIDER_DEFAULTS: Record<ProviderId, { name: string; apiBase: string }> = {
  "openai-compatible": {
    name: PROVIDER_PROTOCOLS["openai-compatible"].en,
    apiBase: PROVIDER_PROTOCOLS["openai-compatible"].apiBase,
  },
  "anthropic-compatible": {
    name: PROVIDER_PROTOCOLS["anthropic-compatible"].en,
    apiBase: PROVIDER_PROTOCOLS["anthropic-compatible"].apiBase,
  },
};

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
    aliases: ["glm", "zhipu", "\u667a\u8c31", "\u667a\u8c31ai", "bigmodel"],
    hostnames: ["open.bigmodel.cn", "api.z.ai"],
  },
  {
    label: "Qwen",
    providerId: "openai-compatible",
    apiBase: "",
    aliases: ["qwen", "dashscope", "\u901a\u4e49\u5343\u95ee", "\u901a\u4e49"],
    hostnames: ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com", "coding.dashscope.aliyuncs.com"],
  },
  {
    label: "Doubao",
    providerId: "openai-compatible",
    apiBase: "https://ark.cn-beijing.volces.com/api/v3",
    aliases: ["doubao", "ark", "\u8c46\u5305", "\u706b\u5c71\u65b9\u821f"],
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
    aliases: ["ernie", "qianfan", "\u767e\u5ea6\u5343\u5e06", "\u6587\u5fc3\u4e00\u8a00"],
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
    aliases: ["siliconflow", "\u7845\u57fa\u6d41\u52a8"],
    hostnames: ["api.siliconflow.cn"],
  },
  {
    label: "Xiaomi Mimo",
    providerId: "openai-compatible",
    apiBase: "https://api.xiaomimimo.com/v1",
    aliases: ["mimo", "xiaomimimo", "\u5c0f\u7c73", "\u5c0f\u7c73mimo"],
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
    label: CUSTOM_SERVICE_PROVIDER_LABEL,
    providerId: "openai-compatible",
    apiBase: "",
    aliases: ["custom", "\u81ea\u5b9a\u4e49"],
  },
  {
    label: CUSTOM_SERVICE_PROVIDER_LABEL,
    providerId: "anthropic-compatible",
    apiBase: "",
    aliases: ["custom", "\u81ea\u5b9a\u4e49"],
  },
];

function localizeCustomProviderLabel(locale: ProviderLabelLocale) {
  return locale === "zh" ? "\u81ea\u5b9a\u4e49" : CUSTOM_SERVICE_PROVIDER_LABEL;
}

function localizeServiceProviderLabel(label: string, locale: ProviderLabelLocale) {
  return label === CUSTOM_SERVICE_PROVIDER_LABEL ? localizeCustomProviderLabel(locale) : label;
}

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

export function getProviderProtocolName(
  providerId: unknown = DEFAULT_PROVIDER_ID,
  locale: ProviderLabelLocale = "en",
) {
  const normalizedProviderId = normalizeProviderId(providerId);
  return PROVIDER_PROTOCOLS[normalizedProviderId][locale];
}

export function getProviderName(providerId: unknown = DEFAULT_PROVIDER_ID) {
  return getProviderProtocolName(providerId, "en");
}

export function getProviderOptions(locale: ProviderLabelLocale = "en") {
  return (Object.keys(PROVIDER_PROTOCOLS) as ProviderId[]).map((value) => ({
    value,
    label: PROVIDER_PROTOCOLS[value][locale],
  }));
}

export const PROVIDER_OPTIONS: Array<{ value: ProviderId; label: string }> = getProviderOptions("en");

export function getServiceProviderPresets(providerId: unknown = DEFAULT_PROVIDER_ID) {
  const normalizedProviderId = normalizeProviderId(providerId);
  return SERVICE_PROVIDER_PRESETS.filter((preset) => preset.providerId === normalizedProviderId);
}

export function getServiceProviderOptions(
  providerId: unknown = DEFAULT_PROVIDER_ID,
  locale: ProviderLabelLocale = "en",
) {
  return getServiceProviderPresets(providerId).map((preset) => ({
    value: preset.label,
    label: localizeServiceProviderLabel(preset.label, locale),
  }));
}

export function getDefaultServiceProviderName(providerId: unknown = DEFAULT_PROVIDER_ID) {
  return getServiceProviderPresets(providerId)[0]?.label ?? CUSTOM_SERVICE_PROVIDER_LABEL;
}

export function getServiceProviderDisplayName(
  providerName: unknown,
  locale: ProviderLabelLocale = "en",
  providerId: unknown = DEFAULT_PROVIDER_ID,
) {
  const normalized = normalizeServiceProviderName(providerName, "", providerId);
  if (normalized) {
    return localizeServiceProviderLabel(normalized, locale);
  }
  const explicitName = typeof providerName === "string" ? providerName.trim() : "";
  return explicitName || localizeCustomProviderLabel(locale);
}

export function findServiceProviderPreset(providerName: unknown, providerId: unknown = DEFAULT_PROVIDER_ID) {
  return getServiceProviderPresets(providerId).find((preset) => matchesServiceProvider(preset, providerName));
}

export function findServiceProviderPresetByApiBase(apiBase: string, providerId: unknown = DEFAULT_PROVIDER_ID) {
  const hostname = tryParseHostname(apiBase);
  if (!hostname) return null;

  return getServiceProviderPresets(providerId).find((preset) =>
    (preset.hostnames ?? []).some((item) => {
      const normalizedItem = item.trim().toLowerCase();
      return hostname === normalizedItem || hostname.endsWith(`.${normalizedItem}`);
    }),
  ) ?? null;
}

export function getServiceProviderDefaultApiBase(providerName: unknown, providerId: unknown = DEFAULT_PROVIDER_ID) {
  return findServiceProviderPreset(providerName, providerId)?.apiBase ?? "";
}

export function getProviderDefaultApiBase(providerId: unknown = DEFAULT_PROVIDER_ID) {
  return PROVIDER_DEFAULTS[normalizeProviderId(providerId)]?.apiBase ?? PROVIDER_DEFAULTS[DEFAULT_PROVIDER_ID].apiBase;
}

export function inferServiceProviderName(apiBase: string, providerId: unknown = DEFAULT_PROVIDER_ID) {
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
  providerId: unknown = DEFAULT_PROVIDER_ID,
) {
  const explicitName = typeof providerName === "string" ? providerName.trim() : "";
  const explicitPreset = findServiceProviderPreset(explicitName, providerId);
  if (explicitPreset) return explicitPreset.label;

  const basePreset = findServiceProviderPresetByApiBase(apiBase, providerId);
  if (basePreset) return basePreset.label;

  return explicitName || inferServiceProviderName(apiBase, providerId);
}
