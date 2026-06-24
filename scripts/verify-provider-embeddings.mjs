import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexo-provider-embeddings-"));

process.chdir(tempRoot);
process.env.NEXO_DATA_DIR = path.join(tempRoot, ".nexo-data");

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const headers = init.headers instanceof Headers
    ? init.headers
    : new Headers(init.headers || {});
  const auth = headers.get("authorization") || "";
  const googleApiKey = headers.get("x-goog-api-key") || "";

  if (url === "https://provider.test/v1/models" || url === "https://api.openai.com/v1/models") {
    if (auth !== "Bearer good-key") {
      return Response.json({ error: { message: "bad key" } }, { status: 401 });
    }
    return Response.json({
      data: [
        { id: "gpt-4o", owned_by: "test", modalities: ["text", "vision"] },
        { id: "text-embedding-3-small", owned_by: "test", type: "embedding" },
      ],
    });
  }

  if (
    url === "https://generativelanguage.googleapis.com/v1beta/models"
    || url === "https://dashscope.aliyuncs.com/compatible-mode/v1/models"
  ) {
    return Response.json({ error: { message: "model listing unavailable in this test" } }, { status: 404 });
  }

  if (url === "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings") {
    assert.equal(auth, "Bearer qwen-key");
    const body = JSON.parse(String(init.body || "{}"));
    assert.equal(body.model, "text-embedding-v4");
    assert.ok(Array.isArray(body.input));
    return Response.json({
      data: body.input.map((_, index) => ({
        index,
        embedding: [0.21, 0.43, 0.65],
        object: "embedding",
      })),
    });
  }

  if (url === "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents") {
    assert.equal(googleApiKey, "gem-key");
    const body = JSON.parse(String(init.body || "{}"));
    assert.ok(Array.isArray(body.requests));
    assert.match(body.requests[0]?.content?.parts?.[0]?.text || "", /^(task: search result \| query:|title: none \| text:)/);
    return Response.json({
      embeddings: body.requests.map(() => ({ values: [0.11, 0.22, 0.33] })),
    });
  }

  return originalFetch(input, init);
};

const providerEmbeddings = await import(pathToFileURL(path.join(repoRoot, "dist-electron/electron/server/provider-embeddings.js")));
const modelProfiles = await import(pathToFileURL(path.join(repoRoot, "dist-electron/electron/server/model-profiles.js")));
const memoryModule = await import(pathToFileURL(path.join(repoRoot, "dist-electron/electron/memory.js")));

const geminiAuto = providerEmbeddings.getProviderEmbeddingAutoConfig({
  providerId: "openai-compatible",
  providerName: "Gemini",
  apiBase: "https://api.openai.com/v1",
});
assert.equal(geminiAuto?.apiBase, "https://generativelanguage.googleapis.com/v1beta");
assert.equal(geminiAuto?.model, "gemini-embedding-2");

const qwenRuntime = providerEmbeddings.getProviderEmbeddingRuntimeConfig({
  providerId: "openai-compatible",
  providerName: "Qwen",
  apiBase: "https://dashscope.aliyuncs.com",
});
assert.equal(qwenRuntime?.apiBase, "https://dashscope.aliyuncs.com/compatible-mode/v1");
assert.equal(qwenRuntime?.model, "text-embedding-v4");

const unsupportedClaude = providerEmbeddings.getProviderEmbeddingRuntimeConfig({
  providerId: "anthropic-compatible",
  providerName: "Claude",
  apiBase: "https://api.anthropic.com/v1",
  model: "claude-sonnet-4-5",
});
assert.equal(unsupportedClaude, null);

const geminiProfile = await modelProfiles.ensureCapabilityModelProfile("embedding", {
  providerId: "openai-compatible",
  providerName: "Gemini",
  apiBase: "",
  apiKey: "gem-key",
});
assert.equal(geminiProfile?.apiBase, "https://generativelanguage.googleapis.com/v1beta");
assert.equal(geminiProfile?.model, "gemini-embedding-2");

const qwenProfile = await modelProfiles.ensureCapabilityModelProfile("embedding", {
  providerId: "openai-compatible",
  providerName: "Qwen",
  apiBase: "https://dashscope.aliyuncs.com",
  apiKey: "qwen-key",
});
assert.equal(qwenProfile?.apiBase, "https://dashscope.aliyuncs.com/compatible-mode/v1");
assert.equal(qwenProfile?.model, "text-embedding-v4");

await memoryModule.storeScriptMemory("gemini:embedding", "Gemini provider-specific embeddings work.", {
  embeddingSettings: {
    providerId: "openai-compatible",
    providerName: "Gemini",
    apiBase: "",
    apiKey: "gem-key",
    model: "gemini-2.5-flash",
  },
});
const geminiResults = await memoryModule.searchMemories("provider-specific", {
  providerId: "openai-compatible",
  providerName: "Gemini",
  apiBase: "",
  apiKey: "gem-key",
  model: "gemini-2.5-flash",
}, { kinds: ["script"], k: 5 });
assert.equal(geminiResults.some((entry) => entry.content.includes("Gemini provider-specific embeddings work.")), true);

await memoryModule.storeScriptMemory("qwen:embedding", "Qwen uses the official compatible-mode embeddings path.", {
  embeddingSettings: {
    providerId: "openai-compatible",
    providerName: "Qwen",
    apiBase: "https://dashscope.aliyuncs.com",
    apiKey: "qwen-key",
    model: "qwen-plus",
  },
});
const qwenResults = await memoryModule.searchMemories("compatible-mode", {
  providerId: "openai-compatible",
  providerName: "Qwen",
  apiBase: "https://dashscope.aliyuncs.com",
  apiKey: "qwen-key",
  model: "qwen-plus",
}, { kinds: ["script"], k: 5 });
assert.equal(qwenResults.some((entry) => entry.content.includes("official compatible-mode embeddings path")), true);

console.log("provider embedding verification passed");
