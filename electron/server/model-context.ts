import fs from "node:fs/promises";
import type { AgentSettings, DiscoveredModel, ModelContextBudget, ModelContextSource, ModelProfile } from "../../src/shared/types";
import { MODEL_CONTEXT_CACHE_FILE, DATA_DIR } from "./config";
import { callChatCompletion, resolvePrimaryModelConfig, type ChatCompletionMessage } from "./model-runtime";
import { getWebSettings } from "./settings";

type ContextDictionaryEntry = {
  pattern: RegExp;
  contextWindowTokens: number;
  reservedOutputTokens?: number;
  autoCompactTokenLimit?: number;
  compactionTargetRatio?: number;
  detail: string;
};

export interface StoredModelContextCacheEntry extends ModelContextBudget {
  key: string;
  model: string;
  providerId: string | undefined;
}

export interface ResolveModelContextOptions {
  profile?: Partial<ModelProfile> | null;
  discoveredModel?: Partial<DiscoveredModel> | null;
  settings?: Partial<AgentSettings> | null;
}

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_RESERVED_OUTPUT = 8_192;
const DEFAULT_TARGET_RATIO = 0.6;

const CONTEXT_DICTIONARY: ContextDictionaryEntry[] = [
  { pattern: /\bgpt-5\.4-(mini|nano)\b/i, contextWindowTokens: 400_000, reservedOutputTokens: 32_768, autoCompactTokenLimit: 280_000, compactionTargetRatio: 0.55, detail: "OpenAI GPT-5.4 mini/nano" },
  { pattern: /\bgpt-5\.4(?:\b|-pro\b)/i, contextWindowTokens: 1_050_000, reservedOutputTokens: 32_768, autoCompactTokenLimit: 735_000, compactionTargetRatio: 0.55, detail: "OpenAI GPT-5.4 / GPT-5.4 Pro" },
  { pattern: /\bgpt-5\.5\b/i, contextWindowTokens: 1_000_000, reservedOutputTokens: 32_768, autoCompactTokenLimit: 700_000, compactionTargetRatio: 0.55, detail: "OpenAI GPT-5.5" },
  { pattern: /\bgpt-5(?:\.\d+)?-chat(?:-latest)?\b/i, contextWindowTokens: 128_000, reservedOutputTokens: 16_384, autoCompactTokenLimit: 96_000, compactionTargetRatio: 0.6, detail: "OpenAI GPT-5 chat bridge models" },
  { pattern: /\bgpt-5(?:\.[12])?(?:-mini|-nano|-codex(?:-max)?)?\b/i, contextWindowTokens: 400_000, reservedOutputTokens: 32_768, autoCompactTokenLimit: 280_000, compactionTargetRatio: 0.55, detail: "OpenAI GPT-5 family" },
  { pattern: /\bgpt-4\.1(-mini|-nano)?\b/i, contextWindowTokens: 1_000_000, reservedOutputTokens: 32_768, autoCompactTokenLimit: 700_000, compactionTargetRatio: 0.55, detail: "OpenAI GPT-4.1 family" },
  { pattern: /\bgpt-4o(-mini)?\b/i, contextWindowTokens: 128_000, reservedOutputTokens: 16_384, autoCompactTokenLimit: 96_000, compactionTargetRatio: 0.6, detail: "OpenAI GPT-4o family" },
  { pattern: /\bo[134]\b/i, contextWindowTokens: 200_000, reservedOutputTokens: 32_768, autoCompactTokenLimit: 140_000, compactionTargetRatio: 0.55, detail: "OpenAI reasoning family" },
  { pattern: /\bclaude-(?:opus-(?:4[-.]?[6-8])|sonnet-4[-.]?6|fable-5|mythos-(?:preview|5))\b/i, contextWindowTokens: 1_000_000, reservedOutputTokens: 32_768, autoCompactTokenLimit: 700_000, compactionTargetRatio: 0.55, detail: "Anthropic Claude long-context family" },
  { pattern: /\bclaude-(3|4|sonnet|opus|haiku)\b/i, contextWindowTokens: 200_000, reservedOutputTokens: 8_192, autoCompactTokenLimit: 140_000, compactionTargetRatio: 0.6, detail: "Anthropic Claude standard family" },
  { pattern: /\bdeepseek-v4-(pro|flash)\b/i, contextWindowTokens: 1_000_000, reservedOutputTokens: 32_768, autoCompactTokenLimit: 700_000, compactionTargetRatio: 0.55, detail: "DeepSeek V4 family" },
  { pattern: /\bdeepseek-(?:v3(?:\.\d+)?(?:-[a-z0-9]+)?|chat|coder|reasoner|r1)\b/i, contextWindowTokens: 128_000, reservedOutputTokens: 8_192, autoCompactTokenLimit: 96_000, compactionTargetRatio: 0.6, detail: "DeepSeek pre-V4 family" },
  { pattern: /\bgemini-(1\.5|2\.0|2\.5).*\b/i, contextWindowTokens: 1_000_000, reservedOutputTokens: 16_384, autoCompactTokenLimit: 700_000, compactionTargetRatio: 0.55, detail: "Gemini long-context family" },
  { pattern: /\bqwen3-coder\b/i, contextWindowTokens: 256_000, reservedOutputTokens: 16_384, autoCompactTokenLimit: 180_000, compactionTargetRatio: 0.55, detail: "Qwen3 Coder" },
  { pattern: /\bqwen3(?:[-./].*)?\b/i, contextWindowTokens: 256_000, reservedOutputTokens: 16_384, autoCompactTokenLimit: 180_000, compactionTargetRatio: 0.55, detail: "Qwen3 family" },
  { pattern: /\b(?:qwen2(?:\.5)?|qwq)(?:[-/].*)?\b/i, contextWindowTokens: 128_000, reservedOutputTokens: 8_192, autoCompactTokenLimit: 96_000, compactionTargetRatio: 0.6, detail: "Qwen2/Qwen2.5/QwQ family" },
  { pattern: /\bglm-5(?:\.\d+)?(?:v-turbo|-turbo)?\b/i, contextWindowTokens: 200_000, reservedOutputTokens: 32_768, autoCompactTokenLimit: 140_000, compactionTargetRatio: 0.55, detail: "GLM-5 family" },
  { pattern: /\bglm-4\.7(?:-[a-z0-9]+)?\b/i, contextWindowTokens: 200_000, reservedOutputTokens: 32_768, autoCompactTokenLimit: 140_000, compactionTargetRatio: 0.55, detail: "GLM-4.7 family" },
  { pattern: /\bglm-4\.6v(?:-[a-z0-9]+)?\b/i, contextWindowTokens: 128_000, reservedOutputTokens: 16_384, autoCompactTokenLimit: 96_000, compactionTargetRatio: 0.6, detail: "GLM-4.6V family" },
  { pattern: /\bglm-4\.6(?:-[a-z0-9]+)?\b/i, contextWindowTokens: 200_000, reservedOutputTokens: 32_768, autoCompactTokenLimit: 140_000, compactionTargetRatio: 0.55, detail: "GLM-4.6 family" },
  { pattern: /\bglm-4\.5(?:-[a-z0-9]+)?\b/i, contextWindowTokens: 128_000, reservedOutputTokens: 16_384, autoCompactTokenLimit: 96_000, compactionTargetRatio: 0.6, detail: "GLM-4.5 family" },
  { pattern: /\bgrok-build-0\.1\b/i, contextWindowTokens: 256_000, reservedOutputTokens: 16_384, autoCompactTokenLimit: 180_000, compactionTargetRatio: 0.55, detail: "xAI Grok Build 0.1" },
  { pattern: /\bgrok-(?:4(?:\.3|\.20|-0709)?(?:-[a-z0-9.-]+)?|4-fast-reasoning|4-1-fast-reasoning)\b/i, contextWindowTokens: 1_000_000, reservedOutputTokens: 32_768, autoCompactTokenLimit: 700_000, compactionTargetRatio: 0.55, detail: "xAI Grok 4 family" },
  { pattern: /\bmistral-large(?:-[a-z0-9.-]+)?\b/i, contextWindowTokens: 256_000, reservedOutputTokens: 16_384, autoCompactTokenLimit: 180_000, compactionTargetRatio: 0.55, detail: "Mistral Large family" },
  { pattern: /\bmistral-small(?:-[a-z0-9.-]+)?\b/i, contextWindowTokens: 256_000, reservedOutputTokens: 16_384, autoCompactTokenLimit: 180_000, compactionTargetRatio: 0.55, detail: "Mistral Small family" },
  { pattern: /\bcodestral(?:-[a-z0-9.-]+)?\b/i, contextWindowTokens: 128_000, reservedOutputTokens: 8_192, autoCompactTokenLimit: 96_000, compactionTargetRatio: 0.6, detail: "Codestral family" },
  { pattern: /\bllama-?4-scout\b/i, contextWindowTokens: 10_000_000, reservedOutputTokens: 65_536, autoCompactTokenLimit: 7_000_000, compactionTargetRatio: 0.5, detail: "Llama 4 Scout" },
  { pattern: /\bllama-?4(?:-(maverick|behemoth))?\b/i, contextWindowTokens: 1_000_000, reservedOutputTokens: 32_768, autoCompactTokenLimit: 700_000, compactionTargetRatio: 0.55, detail: "Llama 4 family" },
  { pattern: /\bllama-?3(\.\d+)?\b/i, contextWindowTokens: 128_000, reservedOutputTokens: 8_192, autoCompactTokenLimit: 96_000, compactionTargetRatio: 0.6, detail: "Llama 3 family" },
];

function nowIso() {
  return new Date().toISOString();
}

function sanitizePositiveInteger(value: unknown) {
  const normalized = Math.floor(Number(value));
  return Number.isFinite(normalized) && normalized > 0 ? normalized : undefined;
}

function sanitizeRatio(value: unknown) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 && normalized <= 1 ? normalized : undefined;
}

function normalizeSource(value: unknown): ModelContextSource | undefined {
  return value === "user"
    || value === "profile"
    || value === "dictionary"
    || value === "provider"
    || value === "lookup"
    || value === "cache"
    || value === "default"
    ? value
    : undefined;
}

function normalizeBudget(input: Partial<ModelContextBudget> = {}): ModelContextBudget {
  return {
    contextWindowTokens: sanitizePositiveInteger(input.contextWindowTokens),
    reservedOutputTokens: sanitizePositiveInteger(input.reservedOutputTokens),
    autoCompactTokenLimit: sanitizePositiveInteger(input.autoCompactTokenLimit),
    compactionTargetRatio: sanitizeRatio(input.compactionTargetRatio),
    contextWindowSource: normalizeSource(input.contextWindowSource),
    contextWindowSourceDetail: typeof input.contextWindowSourceDetail === "string" ? input.contextWindowSourceDetail.trim() || undefined : undefined,
    contextWindowResolvedAt: typeof input.contextWindowResolvedAt === "string" ? input.contextWindowResolvedAt : undefined,
  };
}

function mergeBudgets(...budgets: Array<Partial<ModelContextBudget> | null | undefined>) {
  return budgets.reduce<ModelContextBudget>((merged, budget) => {
    if (!budget) return merged;
    const normalized = normalizeBudget(budget);
    return { ...merged, ...Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== undefined)) };
  }, {});
}

function defaultReservedOutputTokens(contextWindowTokens: number) {
  if (contextWindowTokens >= 1_000_000) return 32_768;
  if (contextWindowTokens >= 200_000) return 24_576;
  if (contextWindowTokens >= 128_000) return 16_384;
  return DEFAULT_RESERVED_OUTPUT;
}

function defaultAutoCompactTokenLimit(contextWindowTokens: number) {
  if (contextWindowTokens >= 1_000_000) return 700_000;
  if (contextWindowTokens >= 400_000) return 280_000;
  if (contextWindowTokens >= 256_000) return 180_000;
  if (contextWindowTokens >= 200_000) return 140_000;
  if (contextWindowTokens >= 128_000) return 96_000;
  return Math.floor(contextWindowTokens * 0.75);
}

function defaultCompactionTargetRatio(contextWindowTokens: number) {
  return contextWindowTokens >= 200_000 ? 0.55 : DEFAULT_TARGET_RATIO;
}

function isFallbackDefaultBudget(budget: Partial<ModelContextBudget> | null | undefined) {
  if (!budget) return false;
  return normalizeSource(budget.contextWindowSource) === "default";
}

export function isExplicitProfileContextBudget(profile: Partial<ModelProfile> | null | undefined) {
  const contextWindowTokens = sanitizePositiveInteger(profile?.contextWindowTokens);
  if (!contextWindowTokens) return false;
  const source = normalizeSource(profile?.contextWindowSource);
  return !source || source === "user" || source === "profile";
}

function cacheKey(providerId: string | undefined, model: string) {
  return `${providerId || "default"}::${model.trim().toLowerCase()}`;
}

async function readContextCache() {
  try {
    const raw = await fs.readFile(MODEL_CONTEXT_CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw) as StoredModelContextCacheEntry[];
    return Array.isArray(parsed) ? parsed.map((entry) => ({ ...normalizeBudget(entry), key: String(entry.key || cacheKey(entry.providerId, entry.model)), model: String(entry.model || ""), providerId: typeof entry.providerId === "string" ? entry.providerId : undefined })) : [];
  } catch {
    return [];
  }
}

async function writeContextCache(entries: StoredModelContextCacheEntry[]) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(MODEL_CONTEXT_CACHE_FILE, JSON.stringify(entries, null, 2), "utf8");
}

export async function deleteStoredModelContextCacheEntry(providerId: string | undefined, model: string) {
  const key = cacheKey(providerId, model);
  const entries = await readContextCache();
  const next = entries.filter((entry) => entry.key !== key);
  if (next.length !== entries.length) {
    await writeContextCache(next.sort((a, b) => a.key.localeCompare(b.key)));
  }
}

export async function getStoredModelContextCacheEntry(providerId: string | undefined, model: string) {
  const key = cacheKey(providerId, model);
  const entries = await readContextCache();
  const entry = entries.find((item) => item.key === key) ?? null;
  return entry && !isFallbackDefaultBudget(entry) ? entry : null;
}

export async function upsertStoredModelContextCacheEntry(entry: StoredModelContextCacheEntry) {
  const entries = await readContextCache();
  const key = cacheKey(entry.providerId, entry.model);
  const next = entries.filter((item) => item.key !== key);

  if (!sanitizePositiveInteger(entry.contextWindowTokens) || isFallbackDefaultBudget(entry)) {
    await writeContextCache(next.sort((a, b) => a.key.localeCompare(b.key)));
    return null;
  }

  const normalized: StoredModelContextCacheEntry = {
    key,
    model: entry.model,
    providerId: entry.providerId,
    ...mergeBudgets(entry, { contextWindowResolvedAt: entry.contextWindowResolvedAt || nowIso() }),
  };
  next.push(normalized);
  await writeContextCache(next.sort((a, b) => a.key.localeCompare(b.key)));
  return normalized;
}

export function findDictionaryBudget(model: string) {
  const needle = model.trim();
  for (const entry of CONTEXT_DICTIONARY) {
    if (entry.pattern.test(needle)) {
      return mergeBudgets(entry, {
        contextWindowSource: "dictionary",
        contextWindowSourceDetail: entry.detail,
        contextWindowResolvedAt: nowIso(),
      });
    }
  }
  return null;
}

export function inferBudgetFromModelNameHint(model: string) {
  const needle = model.trim().toLowerCase();
  if (!needle) return null;

  const matches = [...needle.matchAll(/(?:^|[-_./[\]()\s])(\d+(?:\.\d+)?)\s*([mk])(?:tokens?)?(?=$|[-_./\](),\s])/g)];
  const candidates = matches
    .map((match) => {
      const rawValue = Number(match[1]);
      const unit = match[2];
      if (!Number.isFinite(rawValue) || rawValue <= 0) return undefined;
      const multiplier = unit === "m" ? 1_000_000 : 1_000;
      const contextWindowTokens = Math.round(rawValue * multiplier);
      return contextWindowTokens >= 8_192 && contextWindowTokens <= 10_000_000 ? contextWindowTokens : undefined;
    })
    .filter((value): value is number => Boolean(value));

  const contextWindowTokens = candidates.length ? Math.max(...candidates) : undefined;
  if (!contextWindowTokens) return null;

  return mergeBudgets({
    contextWindowTokens,
    reservedOutputTokens: defaultReservedOutputTokens(contextWindowTokens),
    autoCompactTokenLimit: defaultAutoCompactTokenLimit(contextWindowTokens),
    compactionTargetRatio: defaultCompactionTargetRatio(contextWindowTokens),
    contextWindowSource: "dictionary",
    contextWindowSourceDetail: `model-name token hint (${matches.map((match) => `${match[1]}${match[2]}`).join(", ")})`,
    contextWindowResolvedAt: nowIso(),
  });
}

function maybeReadMetadataNumber(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    const normalized = sanitizePositiveInteger(value);
    if (normalized) return normalized;
    if (typeof value === "string") {
      const match = value.match(/(\d[\d,]*)/);
      if (match) {
        const parsed = sanitizePositiveInteger(match[1].replace(/,/g, ""));
        if (parsed) return parsed;
      }
    }
  }
  return undefined;
}

export function inferBudgetFromProviderMetadata(discoveredModel?: Partial<DiscoveredModel> | null) {
  const metadata = discoveredModel?.metadata;
  if (!metadata) return null;
  const contextWindowTokens = maybeReadMetadataNumber(metadata, [
    "context_window",
    "contextWindow",
    "context_length",
    "contextLength",
    "max_context_tokens",
    "max_input_tokens",
    "input_token_limit",
  ]);
  if (!contextWindowTokens) return null;
  const reservedOutputTokens = maybeReadMetadataNumber(metadata, [
    "max_output_tokens",
    "output_token_limit",
    "completion_token_limit",
  ]);
  return mergeBudgets({
    contextWindowTokens,
    reservedOutputTokens,
    autoCompactTokenLimit: Math.floor(contextWindowTokens * 0.75),
    compactionTargetRatio: DEFAULT_TARGET_RATIO,
    contextWindowSource: "provider",
    contextWindowSourceDetail: "provider-model-metadata",
    contextWindowResolvedAt: nowIso(),
  });
}

export async function resolveStoredModelContextBudget(options: ResolveModelContextOptions = {}) {
  const profile = options.profile ?? null;
  const discoveredModel = options.discoveredModel ?? null;
  const settings = options.settings ?? null;
  const providerId = profile?.providerId || settings?.providerId || undefined;
  const model = profile?.model?.trim() || discoveredModel?.id?.trim() || settings?.model?.trim() || "";

  const explicit = isExplicitProfileContextBudget(profile)
    ? normalizeBudget({
        contextWindowTokens: profile?.contextWindowTokens,
        reservedOutputTokens: profile?.reservedOutputTokens,
        autoCompactTokenLimit: profile?.autoCompactTokenLimit,
        compactionTargetRatio: profile?.compactionTargetRatio,
        contextWindowSource: normalizeSource(profile?.contextWindowSource) ?? "profile",
        contextWindowSourceDetail: profile?.contextWindowSourceDetail || "explicit-profile-override",
        contextWindowResolvedAt: profile?.contextWindowResolvedAt,
      })
    : {};
  if (explicit.contextWindowTokens) {
    return explicit;
  }

  if (model) {
    const cached = await getStoredModelContextCacheEntry(providerId, model);
    if (cached?.contextWindowTokens) {
      return mergeBudgets(cached, {
        contextWindowSource: cached.contextWindowSource === "lookup" ? "cache" : cached.contextWindowSource ?? "cache",
        contextWindowSourceDetail: cached.contextWindowSourceDetail || "persisted-model-context-cache",
      });
    }

    const dictionary = findDictionaryBudget(model);
    if (dictionary?.contextWindowTokens) {
      return dictionary;
    }

    const providerBudget = inferBudgetFromProviderMetadata(discoveredModel);
    if (providerBudget?.contextWindowTokens) {
      return providerBudget;
    }

    const modelNameHint = inferBudgetFromModelNameHint(model);
    if (modelNameHint?.contextWindowTokens) {
      return modelNameHint;
    }
  }

  return mergeBudgets({
    contextWindowTokens: settings?.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW,
    reservedOutputTokens: settings?.reservedOutputTokens ?? DEFAULT_RESERVED_OUTPUT,
    autoCompactTokenLimit: settings?.autoCompactTokenLimit ?? Math.floor((settings?.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW) * 0.75),
    compactionTargetRatio: settings?.compactionTargetRatio ?? DEFAULT_TARGET_RATIO,
    contextWindowSource: "default",
    contextWindowSourceDetail: "fallback-default",
    contextWindowResolvedAt: nowIso(),
  });
}

function parseLookupResult(raw: string) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const contextWindowTokens = sanitizePositiveInteger(parsed.contextWindowTokens);
    if (!contextWindowTokens) return null;
    const reservedOutputTokens = sanitizePositiveInteger(parsed.reservedOutputTokens) ?? DEFAULT_RESERVED_OUTPUT;
    const confidence = typeof parsed.confidence === "string" ? parsed.confidence.trim() : "";
    const rationale = typeof parsed.rationale === "string" ? parsed.rationale.trim() : "";
    return {
      contextWindowTokens,
      reservedOutputTokens,
      autoCompactTokenLimit: Math.floor(contextWindowTokens * 0.75),
      compactionTargetRatio: DEFAULT_TARGET_RATIO,
      contextWindowSource: "lookup" as const,
      contextWindowSourceDetail: [confidence, rationale].filter(Boolean).join(" | ") || "first-use-bootstrap-prompt",
      contextWindowResolvedAt: nowIso(),
    };
  } catch {
    return null;
  }
}

export async function lookupModelContextBudgetWithLLM(
  model: string,
  providerId: string | undefined,
  settings?: Partial<AgentSettings> | null
) {
  const webSettings = getWebSettings();
  const effectiveSettings = { ...webSettings, ...settings } as AgentSettings;
  const apiKey = effectiveSettings.apiKey || "";
  const config = await resolvePrimaryModelConfig(effectiveSettings, apiKey);
  if (!config.apiKey.trim()) {
    return null;
  }

  const instruction = [
    "You are running a one-time bootstrap step for model context budgeting.",
    "This bootstrap is only used when the runtime does not already know the target model's context window.",
    "Return a best-effort context budget for the target model so the runtime can cache it and stop asking on later calls.",
    "Return JSON only with keys: contextWindowTokens, reservedOutputTokens, confidence, rationale.",
    "Use integers for token counts.",
    "If uncertain, make the safest conservative estimate that is still useful.",
  ].join("\n");
  const prompt = [
    `Target provider: ${providerId || "unknown"}`,
    `Target model: ${model}`,
    "Infer the likely context window token limit and a reasonable reserved output token budget for this model.",
    "If the model family is unfamiliar, use the most conservative useful estimate instead of failing.",
  ].join("\n");
  const messages: ChatCompletionMessage[] = [
    { role: "system", content: instruction },
    { role: "user", content: prompt },
  ];
  try {
    const result = await callChatCompletion(config, messages, { temperature: 0, maxTokens: 300 });
    return parseLookupResult(result.content);
  } catch {
    return null;
  }
}

export async function resolveModelContextBudgetWithLookup(options: ResolveModelContextOptions = {}) {
  const resolved = await resolveStoredModelContextBudget(options);
  const profile = options.profile ?? null;
  const discoveredModel = options.discoveredModel ?? null;
  const settings = options.settings ?? null;
  const providerId = profile?.providerId || settings?.providerId || undefined;
  const model = profile?.model?.trim() || discoveredModel?.id?.trim() || settings?.model?.trim() || "";

  if (resolved.contextWindowSource !== "default" || !model) {
    return resolved;
  }

  const lookup = await lookupModelContextBudgetWithLLM(model, providerId, settings);
  if (!lookup?.contextWindowTokens) {
    return resolved;
  }

  await upsertStoredModelContextCacheEntry({
    key: cacheKey(providerId, model),
    model,
    providerId,
    ...lookup,
  });
  return lookup;
}
