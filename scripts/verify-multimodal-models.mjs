import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexo-multimodal-"));
const sampleImage = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const sampleAudio = Buffer.from("fake audio bytes").toString("base64");

process.chdir(tempRoot);
process.env.NEXO_DATA_DIR = path.join(tempRoot, ".nexo-data");

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const headers = init.headers instanceof Headers
    ? init.headers
    : new Headers(init.headers || {});
  const auth = headers.get("authorization") || "";

  if (url === "https://provider.test/v1/models" || url === "https://api.openai.com/v1/models") {
    if (auth !== "Bearer good-key") {
      return Response.json({ error: { message: "bad key" } }, { status: 401 });
    }
    return Response.json({
      data: [
        { id: "gpt-4o", owned_by: "test", modalities: ["text", "vision"] },
        { id: "text-embedding-3-small", owned_by: "test", type: "embedding" },
        { id: "gpt-image-1", owned_by: "test", type: "image-generation" },
        { id: "whisper-1", owned_by: "test", type: "speech-to-text" },
        { id: "tts-1", owned_by: "test", type: "text-to-speech" },
      ],
    });
  }

  if (url.endsWith("/embeddings")) {
    return Response.json({
      data: [
        {
          embedding: [0.12, 0.34, 0.56],
          index: 0,
          object: "embedding",
        },
      ],
      model: "text-embedding-3-small",
      object: "list",
      usage: { prompt_tokens: 3, total_tokens: 3 },
    });
  }

  if (url.endsWith("/chat/completions")) {
    return Response.json({ choices: [{ message: { content: "vision analysis ok" } }] });
  }

  if (url.endsWith("/images/generations") || url.endsWith("/images/edits")) {
    return Response.json({ data: [{ b64_json: sampleImage }] });
  }

  if (url.endsWith("/audio/transcriptions")) {
    return new Response("transcript ok", { headers: { "content-type": "text/plain" } });
  }

  if (url.endsWith("/audio/speech")) {
    return new Response(Buffer.from("speech bytes"), { headers: { "content-type": "audio/mpeg" } });
  }

  return originalFetch(input, init);
};

const modelProfiles = await import(pathToFileURL(path.join(repoRoot, "dist-electron/electron/server/model-profiles.js")));
const multimodal = await import(pathToFileURL(path.join(repoRoot, "dist-electron/electron/server/tools/multimodal.js")));
const modelCall = await import(pathToFileURL(path.join(repoRoot, "dist-electron/electron/server/tools/model-call.js")));

const discovered = await modelProfiles.discoverModels("https://provider.test/v1/", "good-key");
assert.equal(discovered.length, 5);
assert.equal(discovered.some((model) => model.id === "gpt-4o" && model.capabilities.includes("vision")), true);
assert.equal(discovered.some((model) => model.id === "gpt-image-1" && model.capabilities.includes("image_generation")), true);
assert.equal(discovered.some((model) => model.id === "text-embedding-3-small" && model.capabilities.includes("embedding")), true);
await assert.rejects(() => modelProfiles.discoverModels("https://provider.test/v1", "bad-key"), /bad key/);
const discoveredWithDefaultBase = await modelProfiles.discoverModels("", "good-key", "openai-compatible");
assert.equal(discoveredWithDefaultBase.length, 5);

const primaryA = await modelProfiles.saveModelProfile({
  name: "Primary A",
  providerId: "openai-compatible",
  apiBase: "https://provider.test/v1",
  apiKey: "good-key",
  model: "gpt-4o",
  capabilities: ["chat", "orchestration"],
  isPrimary: true,
  enabled: true,
});
const primaryB = await modelProfiles.saveModelProfile({
  name: "Primary B",
  providerId: "openai-compatible",
  apiBase: "https://provider.test/v1",
  apiKey: "good-key",
  model: "gpt-4o-mini",
  capabilities: ["chat", "orchestration"],
  isPrimary: true,
  enabled: true,
});
let profiles = await modelProfiles.listModelProfiles();
assert.equal(profiles.filter((profile) => profile.isPrimary).length, 1);
assert.equal(profiles.find((profile) => profile.id === primaryB.id)?.isPrimary, true);
assert.equal(profiles.find((profile) => profile.id === primaryA.id)?.isPrimary, false);

await modelProfiles.saveModelProfile({
  ...primaryB,
  apiKey: "",
  description: "edited without key",
});
const storedPrimaryB = await modelProfiles.getStoredModelProfile(primaryB.id);
assert.equal(storedPrimaryB.apiKey, "good-key");

const settings = {
  providerId: "openai-compatible",
  providerName: "OpenAI 兼容协议",
  apiBase: "https://provider.test/v1",
  apiKey: "good-key",
  hasApiKey: true,
  model: "gpt-4o",
  temperature: 0,
  maxContextTurns: 12,
  enableContextCompaction: true,
  contextCompactionThreshold: 24,
  maxSteps: 20,
  shellCommandTimeoutMs: 300000,
  planningMode: "balanced",
  enableMemory: false,
  enableKnowledge: false,
  workspacePath: "",
  fileAccessRoots: [],
  webHost: "127.0.0.1",
  webPort: 9898,
  webPassword: "",
  channels: { web: true, desktop: true, feishu: false, dingtalk: false, wechat: false, wecom: false },
};
const ctx = { settings, apiKey: "good-key", apiBase: "https://provider.test/v1" };

await assert.rejects(() => multimodal.generateImage({ prompt: "test" }, ctx), /image_generation/);

await modelProfiles.saveModelProfile({
  name: "Vision Specialist",
  providerId: "openai-compatible",
  apiBase: "https://provider.test/v1",
  apiKey: "good-key",
  model: "gpt-4o",
  capabilities: ["vision"],
  enabled: true,
});
await modelProfiles.saveModelProfile({
  name: "Image Specialist",
  providerId: "openai-compatible",
  apiBase: "https://provider.test/v1",
  apiKey: "good-key",
  model: "gpt-image-1",
  capabilities: ["image_generation", "image_editing"],
  enabled: true,
});
await modelProfiles.saveModelProfile({
  name: "STT Specialist",
  providerId: "openai-compatible",
  apiBase: "https://provider.test/v1",
  apiKey: "good-key",
  model: "whisper-1",
  capabilities: ["speech_to_text"],
  enabled: true,
});
await modelProfiles.saveModelProfile({
  name: "TTS Specialist",
  providerId: "openai-compatible",
  apiBase: "https://provider.test/v1",
  apiKey: "good-key",
  model: "tts-1",
  capabilities: ["text_to_speech"],
  enabled: true,
});

const autoEmbedding = await modelProfiles.ensureCapabilityModelProfile("embedding", {
  providerId: "openai-compatible",
  apiBase: "https://provider.test/v1",
  apiKey: "good-key",
});
assert.equal(autoEmbedding?.model, "text-embedding-3-small");

const memoryModule = await import(pathToFileURL(path.join(repoRoot, "dist-electron/electron/memory.js")));
await memoryModule.storeScriptMemory("embedding:auto", "Provider embedding auto provisioning works.", {
  embeddingSettings: {
    providerId: "openai-compatible",
    providerName: "OpenAI Compatible",
    apiBase: "https://provider.test/v1",
    apiKey: "good-key",
    model: "gpt-4o",
  },
});
const memoryResults = await memoryModule.searchMemories("provisioning", {
  providerId: "openai-compatible",
  providerName: "OpenAI Compatible",
  apiBase: "https://provider.test/v1",
  apiKey: "good-key",
  model: "gpt-4o",
}, { kinds: ["script"], k: 5 });
assert.equal(memoryResults.some((entry) => entry.content.includes("auto provisioning works")), true);

const imageDataUrl = `data:image/png;base64,${sampleImage}`;
const audioDataUrl = `data:audio/mpeg;base64,${sampleAudio}`;

const visionOutput = await modelCall.invokeModel({ capability: "vision", prompt: "what is this?", images: [imageDataUrl] }, ctx);
assert.match(visionOutput, /vision analysis ok/);

const generatedImage = await modelCall.invokeModel({ capability: "image_generation", prompt: "draw a square" }, ctx);
assert.match(generatedImage, /\/uploads\/generated\/image-/);

const editedImage = await modelCall.invokeModel({ capability: "image_editing", prompt: "make it brighter", images: [imageDataUrl] }, ctx);
assert.match(editedImage, /\/uploads\/generated\/edited-image-/);

const transcript = await modelCall.invokeModel({ capability: "speech_to_text", audio: audioDataUrl }, ctx);
assert.match(transcript, /transcript ok/);

const speech = await modelCall.invokeModel({ capability: "text_to_speech", input: "hello" }, ctx);
assert.match(speech, /\/uploads\/generated\/speech-/);

const generatedDir = path.join(tempRoot, ".nexo-data", "uploads", "generated");
assert.equal(fs.existsSync(generatedDir), true);
assert.equal(fs.readdirSync(generatedDir).length >= 3, true);

console.log("multimodal model verification passed");
