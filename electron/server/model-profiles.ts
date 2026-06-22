import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { getProviderDefaultApiBase, getProviderName, normalizeProviderId, normalizeServiceProviderName } from "../../src/shared/providers";
import { MODEL_CAPABILITIES, type DiscoveredModel, type ModelCapability, type ModelProfile, type ProviderId } from "../../src/shared/types";
import { DATA_DIR, MODEL_PROFILES_FILE } from "./config";
import { deleteStoredModelContextCacheEntry, inferBudgetFromProviderMetadata, isExplicitProfileContextBudget, resolveModelContextBudgetWithLookup, resolveStoredModelContextBudget, upsertStoredModelContextCacheEntry } from "./model-context";

interface StoredModelProfile extends Omit<ModelProfile, "hasApiKey"> {
  hasApiKey?: boolean;
}

const CAPABILITY_KEYWORDS: Array<[ModelCapability, RegExp]> = [
  ["image_generation", /\b(dall|dalle|gpt-image|flux|sdxl|stable-diffusion|midjourney|mj|image-gen|image-generation)\b/i],
  ["image_editing", /\b(edit|edits|inpaint|outpaint|paint|image-edit|gpt-image)\b/i],
  ["vision", /\b(vision|vl|omni|gpt-4o|gpt-4\.1|qwen-vl|glm-4v|gemini|claude-3|internvl|llava)\b/i],
  ["speech_to_text", /\b(whisper|asr|transcribe|speech-to-text|stt)\b/i],
  ["text_to_speech", /\b(tts|speech|voice|audio)\b/i],
  ["embedding", /\b(embed|embedding|text-embedding|bge|gte)\b/i],
];

function uniqueCapabilities(items: ModelCapability[]) {
  return MODEL_CAPABILITIES.filter((capability) => items.includes(capability));
}

export function inferModelCapabilities(modelId: string, metadata: Record<string, unknown> = {}): ModelCapability[] {
  const capabilities = new Set<ModelCapability>();
  const haystack = [
    modelId,
    metadata.owned_by,
    metadata.owner,
    metadata.type,
    metadata.modality,
    metadata.modalities,
    metadata.capabilities,
    metadata.object,
  ].map((item) => Array.isArray(item) ? item.join(" ") : typeof item === "string" ? item : "").join(" ");

  for (const [capability, pattern] of CAPABILITY_KEYWORDS) {
    if (pattern.test(haystack)) capabilities.add(capability);
  }
  if (!capabilities.has("embedding") && !capabilities.has("speech_to_text") && !capabilities.has("text_to_speech")) {
    capabilities.add("chat");
  }
  if (capabilities.has("chat") || capabilities.has("vision")) capabilities.add("orchestration");
  return uniqueCapabilities([...capabilities]);
}

function normalizeCapabilities(value: unknown, fallback: ModelCapability[] = ["chat", "orchestration"]) {
  const allowed = new Set<ModelCapability>(MODEL_CAPABILITIES);
  const items = Array.isArray(value) ? value : [];
  const capabilities = items.filter((item): item is ModelCapability => allowed.has(item as ModelCapability));
  const normalized = capabilities.length ? capabilities : fallback;
  return uniqueCapabilities(normalized);
}

function normalizeProfile(profile: Partial<ModelProfile> & Pick<ModelProfile, "name" | "apiBase" | "model">, existing?: StoredModelProfile): StoredModelProfile {
  const providerId = normalizeProviderId(profile.providerId ?? existing?.providerId);
  const apiBase = (profile.apiBase?.trim() || existing?.apiBase?.trim() || getProviderDefaultApiBase(providerId)).replace(/\/+$/, "");
  const providerName = normalizeServiceProviderName(profile.providerName ?? existing?.providerName, apiBase, providerId);
  const nextApiKey = profile.apiKey?.trim() ? profile.apiKey.trim() : existing?.apiKey?.trim() ?? "";
  const inferredCapabilities = normalizeCapabilities(
    profile.capabilities,
    existing?.capabilities?.length ? existing.capabilities : inferModelCapabilities(profile.model)
  );
  const wantsPrimary = profile.isPrimary ?? existing?.isPrimary ?? false;
  const capabilities = wantsPrimary && !inferredCapabilities.includes("orchestration")
    ? uniqueCapabilities([...inferredCapabilities, "orchestration"])
    : inferredCapabilities;
  return {
    id: profile.id || existing?.id || randomUUID(),
    name: profile.name.trim(),
    providerId,
    providerName,
    apiBase,
    apiKey: nextApiKey,
    model: profile.model.trim(),
    capabilities,
    isPrimary: wantsPrimary,
    temperature: profile.temperature ?? existing?.temperature ?? 0,
    description: profile.description?.trim() || existing?.description || "",
    enabled: profile.enabled ?? existing?.enabled ?? true,
    contextWindowTokens: profile.contextWindowTokens ?? existing?.contextWindowTokens,
    reservedOutputTokens: profile.reservedOutputTokens ?? existing?.reservedOutputTokens,
    autoCompactTokenLimit: profile.autoCompactTokenLimit ?? existing?.autoCompactTokenLimit,
    compactionTargetRatio: profile.compactionTargetRatio ?? existing?.compactionTargetRatio,
    contextWindowSource: profile.contextWindowSource ?? existing?.contextWindowSource,
    contextWindowSourceDetail: profile.contextWindowSourceDetail ?? existing?.contextWindowSourceDetail,
    contextWindowResolvedAt: profile.contextWindowResolvedAt ?? existing?.contextWindowResolvedAt,
  };
}

async function readStoredProfiles(): Promise<StoredModelProfile[]> {
  try {
    const raw = await fs.readFile(MODEL_PROFILES_FILE, "utf8");
    const parsed = JSON.parse(raw) as StoredModelProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeStoredProfiles(profiles: StoredModelProfile[]) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(MODEL_PROFILES_FILE, JSON.stringify(profiles, null, 2), "utf8");
}

async function toPublicProfile(profile: StoredModelProfile, resolvedBudget?: Partial<ModelProfile>): Promise<ModelProfile> {
  const budget = resolvedBudget ?? await resolveStoredModelContextBudget({ profile });
  return {
    ...profile,
    providerName: normalizeServiceProviderName(profile.providerName, profile.apiBase, profile.providerId),
    ...budget,
    apiKey: "",
    hasApiKey: Boolean(profile.apiKey?.trim()),
  };
}

export async function listModelProfiles(): Promise<ModelProfile[]> {
  const profiles = await readStoredProfiles();
  return Promise.all(profiles.map((profile) => toPublicProfile(profile)));
}

export async function getStoredModelProfile(id: string): Promise<StoredModelProfile | null> {
  const profiles = await readStoredProfiles();
  return profiles.find((profile) => profile.id === id) ?? null;
}

export async function getPrimaryModelProfile(): Promise<StoredModelProfile | null> {
  const profiles = await readStoredProfiles();
  return profiles
    .filter((profile) => profile.enabled && profile.isPrimary && profile.capabilities?.includes("orchestration"))
    .sort(compareProfilesForCapability("orchestration"))[0] ?? null;
}

export async function findStoredModelProfile(query: string): Promise<StoredModelProfile | null> {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  const profiles = await readStoredProfiles();
  return profiles.find((profile) => profile.enabled && (profile.id === query || profile.name.trim().toLowerCase() === needle)) ?? null;
}

function compareProfilesForCapability(capability: ModelCapability) {
  return (a: StoredModelProfile, b: StoredModelProfile) => {
    const primaryWeight = capability === "orchestration"
      ? Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary))
      : Number(Boolean(a.isPrimary)) - Number(Boolean(b.isPrimary));
    if (primaryWeight !== 0) return primaryWeight;
    const nameWeight = a.name.localeCompare(b.name);
    if (nameWeight !== 0) return nameWeight;
    const modelWeight = a.model.localeCompare(b.model);
    if (modelWeight !== 0) return modelWeight;
    return a.id.localeCompare(b.id);
  };
}

export async function findStoredModelProfileByCapability(capability: ModelCapability): Promise<StoredModelProfile | null> {
  const profiles = await readStoredProfiles();
  return profiles
    .filter((profile) => profile.enabled && profile.capabilities?.includes(capability))
    .sort(compareProfilesForCapability(capability))[0] ?? null;
}

export async function getEnabledModelCapabilitySummary(): Promise<Record<ModelCapability, string[]>> {
  const summary = Object.fromEntries(MODEL_CAPABILITIES.map((capability) => [capability, [] as string[]])) as unknown as Record<ModelCapability, string[]>;
  const profiles = await readStoredProfiles();
  for (const profile of profiles) {
    if (!profile.enabled) continue;
    const capabilities = normalizeCapabilities(profile.capabilities, inferModelCapabilities(profile.model));
    for (const capability of capabilities) {
      summary[capability].push(profile.isPrimary ? `${profile.name} (${profile.model}, primary)` : `${profile.name} (${profile.model})`);
    }
  }
  for (const capability of MODEL_CAPABILITIES) {
    summary[capability].sort((a, b) => a.localeCompare(b));
  }
  return summary;
}

export async function saveModelProfile(profile: Partial<ModelProfile> & Pick<ModelProfile, "name" | "apiBase" | "model">): Promise<ModelProfile> {
  const profiles = await readStoredProfiles();
  const existingIndex = profile.id ? profiles.findIndex((item) => item.id === profile.id) : -1;
  const existing = existingIndex >= 0 ? profiles[existingIndex] : undefined;
  const normalized = normalizeProfile(profile, existing);
  const hasExplicitBudget = isExplicitProfileContextBudget(profile);

  if (!hasExplicitBudget) {
    normalized.contextWindowTokens = existing && isExplicitProfileContextBudget(existing) ? existing.contextWindowTokens : undefined;
    normalized.reservedOutputTokens = existing && isExplicitProfileContextBudget(existing) ? existing.reservedOutputTokens : undefined;
    normalized.autoCompactTokenLimit = existing && isExplicitProfileContextBudget(existing) ? existing.autoCompactTokenLimit : undefined;
    normalized.compactionTargetRatio = existing && isExplicitProfileContextBudget(existing) ? existing.compactionTargetRatio : undefined;
    normalized.contextWindowSource = existing && isExplicitProfileContextBudget(existing) ? existing.contextWindowSource : undefined;
    normalized.contextWindowSourceDetail = existing && isExplicitProfileContextBudget(existing) ? existing.contextWindowSourceDetail : undefined;
    normalized.contextWindowResolvedAt = existing && isExplicitProfileContextBudget(existing) ? existing.contextWindowResolvedAt : undefined;
  }

  if (normalized.enabled && normalized.isPrimary) {
    for (const item of profiles) {
      if (item.id !== normalized.id) item.isPrimary = false;
    }
  }

  if (existingIndex >= 0) {
    profiles[existingIndex] = normalized;
  } else {
    profiles.push(normalized);
  }

  await writeStoredProfiles(profiles);
  if (normalized.model.trim() && hasExplicitBudget) {
    await upsertStoredModelContextCacheEntry({
      key: `${normalized.providerId}::${normalized.model.trim().toLowerCase()}`,
      model: normalized.model,
      providerId: normalized.providerId,
      contextWindowTokens: normalized.contextWindowTokens,
      reservedOutputTokens: normalized.reservedOutputTokens,
      autoCompactTokenLimit: normalized.autoCompactTokenLimit,
      compactionTargetRatio: normalized.compactionTargetRatio,
      contextWindowSource: normalized.contextWindowSource ?? "profile",
      contextWindowSourceDetail: normalized.contextWindowSourceDetail || "saved-profile-budget",
      contextWindowResolvedAt: normalized.contextWindowResolvedAt,
    });
  }
  return toPublicProfile(normalized);
}

export async function getStoredModelProfileApiKey(id: string): Promise<string> {
  const profile = await getStoredModelProfile(id);
  return profile?.apiKey?.trim() ?? "";
}

export async function refreshModelProfileContext(id: string): Promise<ModelProfile> {
  const profile = await getStoredModelProfile(id);
  if (!profile) {
    throw new Error("Model profile not found.");
  }
  if (!profile.model.trim()) {
    throw new Error("This model profile does not have a model id.");
  }
  if (isExplicitProfileContextBudget(profile)) {
    throw new Error("This profile uses a manual context budget. Clear the manual override before re-detecting.");
  }

  await deleteStoredModelContextCacheEntry(profile.providerId, profile.model);

  const refreshProfile = {
    ...profile,
    contextWindowTokens: undefined,
    reservedOutputTokens: undefined,
    autoCompactTokenLimit: undefined,
    compactionTargetRatio: undefined,
    contextWindowSource: undefined,
    contextWindowSourceDetail: undefined,
    contextWindowResolvedAt: undefined,
  };

  const resolved = await resolveModelContextBudgetWithLookup({
    profile: refreshProfile,
    settings: refreshProfile,
  });

  if (resolved.contextWindowTokens) {
    await upsertStoredModelContextCacheEntry({
      key: `${profile.providerId || "default"}::${profile.model.trim().toLowerCase()}`,
      model: profile.model,
      providerId: profile.providerId,
      ...resolved,
    });
  }

  return toPublicProfile(profile, resolved);
}

export async function deleteModelProfile(id: string) {
  const profiles = await readStoredProfiles();
  const next = profiles.filter((profile) => profile.id !== id);
  await writeStoredProfiles(next);
}

interface OpenAIModelListResponse {
  data?: Array<{ id?: string; owned_by?: string; [key: string]: unknown }>;
  error?: { message?: string };
}

interface AnthropicModelListResponse {
  data?: Array<{
    id?: string;
    display_name?: string;
    created_at?: string;
    type?: string;
    [key: string]: unknown;
  }>;
  error?: { message?: string };
}

async function toDiscoveredModels(
  items: Array<{ id?: string; owned_by?: string; display_name?: string; [key: string]: unknown }>,
  providerId: ProviderId
) {
  const discovered = items
    .filter((item): item is { id: string; owned_by?: string; display_name?: string; [key: string]: unknown } => Boolean(item.id))
    .map((item) => ({
      id: item.id,
      label: item.display_name || item.id,
      ownedBy: item.owned_by,
      capabilities: inferModelCapabilities(item.id, item),
      metadata: item,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return Promise.all(discovered.map(async (model) => {
    const providerBudget = inferBudgetFromProviderMetadata(model);
    const resolved = providerBudget?.contextWindowTokens
      ? providerBudget
      : await resolveStoredModelContextBudget({ discoveredModel: model, settings: { providerId, model: model.id } as Partial<ModelProfile> });
    return { ...model, ...resolved };
  }));
}

export async function discoverModels(apiBase: string, apiKey: string, providerId: ProviderId = "openai-compatible"): Promise<DiscoveredModel[]> {
  const normalizedProvider = normalizeProviderId(providerId);
  const base = (apiBase.trim() || getProviderDefaultApiBase(normalizedProvider)).replace(/\/+$/, "");
  if (!base) throw new Error("API Base is required.");
  if (!/^https?:\/\//i.test(base)) throw new Error("API Base must start with http:// or https://.");
  if (!apiKey.trim()) throw new Error("API Key is required.");

  if (normalizedProvider === "anthropic-compatible") {
    const response = await fetch(`${base}/models`, {
      headers: {
        "x-api-key": apiKey.trim(),
        "anthropic-version": "2023-06-01",
      },
    });
    const data = await response.json().catch(() => ({})) as AnthropicModelListResponse;
    if (!response.ok) {
      throw new Error(data.error?.message ?? `Failed to fetch ${getProviderName(normalizedProvider)} models: ${response.status}`);
    }
    return toDiscoveredModels(data.data ?? [], normalizedProvider);
  }

  const response = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
  });
  const data = await response.json().catch(() => ({})) as OpenAIModelListResponse;
  if (!response.ok) {
    throw new Error(data.error?.message ?? `Failed to fetch ${getProviderName(normalizedProvider)} models: ${response.status}`);
  }

  return toDiscoveredModels(data.data ?? [], normalizedProvider);
}

export async function resolveAndPersistModelContextBudget(profile: Partial<ModelProfile> | null, discoveredModel?: Partial<DiscoveredModel> | null) {
  const resolutionProfile = profile?.contextWindowSource === "default"
    ? {
        ...profile,
        contextWindowTokens: undefined,
        reservedOutputTokens: undefined,
        autoCompactTokenLimit: undefined,
        compactionTargetRatio: undefined,
      }
    : profile;
  const resolved = await resolveModelContextBudgetWithLookup({ profile: resolutionProfile, discoveredModel, settings: profile ?? undefined });
  const model = profile?.model?.trim() || discoveredModel?.id?.trim();
  const providerId = profile?.providerId;
  if (model) {
    await upsertStoredModelContextCacheEntry({
      key: `${providerId || "default"}::${model.toLowerCase()}`,
      model,
      providerId,
      ...resolved,
    });
  }
  return resolved;
}
