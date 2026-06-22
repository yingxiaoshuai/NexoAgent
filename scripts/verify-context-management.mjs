import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distRoot = path.join(repoRoot, "dist-electron", "electron", "server");

const tokenBudgetModule = await import(pathToFileURL(path.join(distRoot, "token-budget.js")));
const modelContextModule = await import(pathToFileURL(path.join(distRoot, "model-context.js")));
const settingsModule = await import(pathToFileURL(path.join(distRoot, "settings.js")));
const configModule = await import(pathToFileURL(path.join(distRoot, "config.js")));

const {
  estimateTokens,
  computePromptBudget,
  truncateTextToTokenBudget,
} = tokenBudgetModule;
const {
  findDictionaryBudget,
  inferBudgetFromModelNameHint,
  resolveStoredModelContextBudget,
  upsertStoredModelContextCacheEntry,
  getStoredModelContextCacheEntry,
} = modelContextModule;
const { DEFAULT_AGENT_SETTINGS } = settingsModule;
const { MODEL_CONTEXT_CACHE_FILE } = configModule;

async function cleanupCache() {
  await fs.rm(MODEL_CONTEXT_CACHE_FILE, { force: true }).catch(() => {});
}

await cleanupCache();

{
  const mixed = "你好hello123";
  const tokens = estimateTokens(mixed);
  assert.ok(tokens >= 4 && tokens <= 8, `unexpected mixed token estimate: ${tokens}`);
}

{
  const budget = computePromptBudget(DEFAULT_AGENT_SETTINGS, {
    contextWindowTokens: 200_000,
    reservedOutputTokens: 10_000,
    autoCompactTokenLimit: 120_000,
    compactionTargetRatio: 0.5,
  }, 2_000);
  assert.equal(budget.contextWindowTokens, 200_000);
  assert.equal(budget.reservedOutputTokens, 10_000);
  assert.equal(budget.autoCompactTokenLimit, 120_000);
  assert.equal(budget.compactionTargetTokens, 94_000);
}

{
  const dictionary = findDictionaryBudget("gpt-4.1");
  assert.ok(dictionary);
  assert.equal(dictionary?.contextWindowTokens, 1_000_000);
  assert.equal(dictionary?.contextWindowSource, "dictionary");
}

{
  const dictionary = findDictionaryBudget("deepseek-v4-pro");
  assert.ok(dictionary);
  assert.equal(dictionary?.contextWindowTokens, 1_000_000);
  assert.equal(dictionary?.contextWindowSource, "dictionary");
}

{
  const dictionary = findDictionaryBudget("gpt-5-codex");
  assert.ok(dictionary);
  assert.equal(dictionary?.contextWindowTokens, 400_000);
}

{
  const dictionary = findDictionaryBudget("llama-4-scout");
  assert.ok(dictionary);
  assert.equal(dictionary?.contextWindowTokens, 10_000_000);
}

{
  const hint = inferBudgetFromModelNameHint("my-proxy-model-256k");
  assert.ok(hint);
  assert.equal(hint?.contextWindowTokens, 256_000);
  assert.equal(hint?.contextWindowSource, "dictionary");
}

{
  const hint = inferBudgetFromModelNameHint("openrouter/custom-1m-preview");
  assert.ok(hint);
  assert.equal(hint?.contextWindowTokens, 1_000_000);
}

{
  await upsertStoredModelContextCacheEntry({
    key: "openai-compatible::custom-model-x",
    model: "custom-model-x",
    providerId: "openai-compatible",
    contextWindowTokens: 65432,
    reservedOutputTokens: 4096,
    contextWindowSource: "lookup",
    contextWindowSourceDetail: "test-cache",
    contextWindowResolvedAt: new Date().toISOString(),
  });
  const cached = await getStoredModelContextCacheEntry("openai-compatible", "custom-model-x");
  assert.equal(cached?.contextWindowTokens, 65432);
  const resolved = await resolveStoredModelContextBudget({
    profile: { providerId: "openai-compatible", model: "custom-model-x" },
  });
  assert.equal(resolved.contextWindowTokens, 65432);
}

{
  await upsertStoredModelContextCacheEntry({
    key: "openai-compatible::unknown-fallback",
    model: "unknown-fallback",
    providerId: "openai-compatible",
    contextWindowTokens: 128000,
    reservedOutputTokens: 8192,
    contextWindowSource: "default",
    contextWindowSourceDetail: "fallback-default",
    contextWindowResolvedAt: new Date().toISOString(),
  });
  const cached = await getStoredModelContextCacheEntry("openai-compatible", "unknown-fallback");
  assert.equal(cached, null);
  const rawCache = JSON.parse(await fs.readFile(MODEL_CONTEXT_CACHE_FILE, "utf8").catch(() => "[]"));
  assert.equal(rawCache.some((entry) => entry?.model === "unknown-fallback"), false);
}

{
  const metadataResolved = await resolveStoredModelContextBudget({
    discoveredModel: {
      id: "provider-metadata-model",
      metadata: { context_window: 32000, max_output_tokens: 4096 },
    },
    settings: { providerId: "openai-compatible", model: "provider-metadata-model" },
  });
  assert.equal(metadataResolved.contextWindowTokens, 32000);
  assert.equal(metadataResolved.contextWindowSource, "provider");
}

{
  const hintedResolved = await resolveStoredModelContextBudget({
    profile: { providerId: "openai-compatible", model: "vendor/custom-context-512k" },
  });
  assert.equal(hintedResolved.contextWindowTokens, 512_000);
  assert.equal(hintedResolved.contextWindowSource, "dictionary");
}

{
  const longText = "abc ".repeat(3000);
  const truncated = truncateTextToTokenBudget(longText, 300);
  assert.ok(estimateTokens(truncated) <= 300);
}

await cleanupCache();
console.log("context management verification passed");
