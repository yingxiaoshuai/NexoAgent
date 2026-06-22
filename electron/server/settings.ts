import type { AgentSettings } from "../../src/shared/types";
import { isPreservedApiKeyInput } from "../../src/shared/settings";
import { getProviderDefaultApiBase, getProviderName, normalizeProviderId } from "../../src/shared/providers";

let webSettings: Partial<AgentSettings> = {};

function normalizeSettingsShape<T extends Partial<AgentSettings>>(settings: T): T {
  const providerId = normalizeProviderId(settings.providerId);
  return {
    ...settings,
    providerId,
    providerName: getProviderName(providerId),
    apiBase: (settings.apiBase?.trim() || getProviderDefaultApiBase(providerId)).replace(/\/+$/, ""),
  };
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  providerId: "openai-compatible",
  providerName: getProviderName("openai-compatible"),
  apiBase: "https://api.openai.com/v1",
  apiKey: "",
  hasApiKey: false,
  model: "gpt-4o-mini",
  temperature: 0.4,
  contextWindowTokens: 128_000,
  reservedOutputTokens: 8_192,
  autoCompactTokenLimit: 96_000,
  compactionTargetRatio: 0.6,
  contextWindowSource: "default",
  contextWindowSourceDetail: "runtime-default",
  maxContextTurns: 12,
  enableContextCompaction: true,
  contextCompactionThreshold: 24,
  maxSteps: 20,
  shellCommandTimeoutMs: 300_000,
  planningMode: "balanced",
  circuitBreakerEnabled: true,
  circuitBreakerConsecutiveFailureLimit: 3,
  circuitBreakerRepeatedToolCallLimit: 3,
  circuitBreakerNoProgressLimit: 4,
  circuitBreakerMaxRuntimeMs: 600_000,
  circuitBreakerTokenBudget: 0,
  enableMemory: true,
  enableKnowledge: true,
  workspacePath: "",
  fileAccessRoots: [],
  webHost: "0.0.0.0",
  webPort: 9898,
  webPassword: "",
  channels: { web: true, desktop: true, feishu: false, dingtalk: false, wechat: false, wecom: false },
};

export function getWebSettings() {
  return webSettings;
}

export function mergeWebSettings(overrides: Partial<AgentSettings>) {
  const { apiKey, hasApiKey, ...rest } = overrides;
  webSettings = normalizeSettingsShape({ ...DEFAULT_AGENT_SETTINGS, ...webSettings, ...rest });
  if (hasApiKey !== undefined) {
    webSettings.hasApiKey = hasApiKey;
  }
  if (!isPreservedApiKeyInput(apiKey)) {
    webSettings.apiKey = apiKey!.trim();
    webSettings.hasApiKey = Boolean(webSettings.apiKey);
  }
}

/** Apply settings to the in-process backend cache (disk + HTTP routes share this). */
export function applyAgentSettings(overrides: Partial<AgentSettings>) {
  mergeWebSettings(overrides);
}

export function buildRuntimeSettings(overrides: Partial<AgentSettings> = {}): AgentSettings {
  return normalizeSettingsShape({ ...DEFAULT_AGENT_SETTINGS, ...webSettings, ...overrides }) as AgentSettings;
}
