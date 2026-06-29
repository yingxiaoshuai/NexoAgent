import { callChatCompletion, callImageEdit, callImageGeneration, callSpeechToText, callTextToSpeech, modelConfigAllowsEmptyApiKey, resolveModelConfigFromArgs } from "../model-runtime";
import { attachmentToDataUrl, loadSourceBytes, saveGeneratedArtifact } from "../media";
import type { ToolExecutionContext } from "../types";
import { getOptionalNumberArg, getOptionalStringArg, getStringArg } from "../utils";
import type { AttachmentType } from "../../../src/shared/types";

interface ImageApiDataItem {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
}

interface ArtifactResult {
  url: string;
  name: string;
  type: AttachmentType;
  mimeType: string;
  size: number;
  source: "generated";
  path: string;
}

function readStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function dataUrlToBuffer(value: string) {
  const match = value.match(/^data:([^;,]+)?;base64,([\s\S]+)$/i);
  if (!match) return null;
  return {
    mimeType: match[1] || "application/octet-stream",
    buffer: Buffer.from(match[2] || "", "base64"),
  };
}

async function imageItemToArtifact(item: ImageApiDataItem, prefix: string, fallbackMimeType: string): Promise<ArtifactResult> {
  if (item.b64_json) {
    return saveGeneratedArtifact(Buffer.from(item.b64_json, "base64"), fallbackMimeType, prefix);
  }

  if (item.url) {
    if (item.url.startsWith("data:")) {
      const parsed = dataUrlToBuffer(item.url);
      if (parsed) return saveGeneratedArtifact(parsed.buffer, parsed.mimeType, prefix);
    }
    const response = await fetch(item.url);
    if (response.ok) {
      const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || fallbackMimeType;
      return saveGeneratedArtifact(Buffer.from(await response.arrayBuffer()), mimeType, prefix);
    }
    return {
      url: item.url,
      name: item.url,
      type: "image" as const,
      mimeType: fallbackMimeType,
      size: 0,
      source: "generated" as const,
      path: item.url,
    };
  }

  throw new Error("Image API returned no image data.");
}

function formatArtifacts(title: string, artifacts: ArtifactResult[], extraLines: string[] = []) {
  return [
    title,
    ...artifacts.map((artifact, index) => `${index + 1}. ${artifact.name} (${artifact.mimeType}, ${artifact.size} bytes): ${artifact.url}`),
    ...extraLines,
  ].join("\n");
}

export function extractArtifactsFromToolOutput(output: string): ArtifactResult[] {
  const artifacts: ArtifactResult[] = [];
  const seen = new Set<string>();
  const lineRe = /^\d+\.\s+(.+?)\s+\((.+?),\s+(\d+)\s+bytes\):\s+(\/uploads\/\S+)$/;

  for (const rawLine of output.split(/\r?\n/)) {
    const match = rawLine.trim().match(lineRe);
    if (!match) continue;
    const [, name, mimeType, sizeText, url] = match;
    if (seen.has(url)) continue;
    seen.add(url);
    artifacts.push({
      url,
      name,
      type: mimeType.startsWith("audio/") ? "audio" : mimeType.startsWith("image/") ? "image" : "file",
      mimeType,
      size: Number(sizeText) || 0,
      source: "generated",
      path: url,
    });
  }

  return artifacts;
}

export async function analyzeImage(args: Record<string, unknown>, ctx: ToolExecutionContext) {
  const prompt = getStringArg(args, "prompt");
  const images = readStringList(args.images ?? args.image ?? args.imageUrl ?? args.image_url);
  if (!images.length) {
    throw new Error("At least one image URL, upload path, or data URL is required.");
  }

  const config = await resolveModelConfigFromArgs(args, ctx, { capability: "vision", allowDefault: false });
  if (!config.apiKey && !modelConfigAllowsEmptyApiKey(config)) throw new Error(`Model profile "${config.name}" does not have an API key.`);
  const detail = getOptionalStringArg(args, "detail", "auto") as "low" | "high" | "original" | "auto";
  const imageParts = await Promise.all(images.map(async (url) => ({
    type: "image_url" as const,
    image_url: {
      url: url.startsWith("http") || url.startsWith("data:")
        ? url
        : await attachmentToDataUrl({ url, name: url, type: "image" }),
      detail,
    },
  })));

  const result = await callChatCompletion(config, [
    { role: "user", content: [{ type: "text", text: prompt }, ...imageParts] },
  ], { maxTokens: getOptionalNumberArg(args, "maxTokens", 1200) });

  return [
    `Profile: ${config.name}`,
    `Model: ${config.model}`,
    "",
    result.content,
  ].join("\n");
}

export async function generateImage(args: Record<string, unknown>, ctx: ToolExecutionContext) {
  const prompt = getStringArg(args, "prompt");
  const config = await resolveModelConfigFromArgs(args, ctx, { capability: "image_generation", allowDefault: false });
  if (!config.apiKey && !modelConfigAllowsEmptyApiKey(config)) throw new Error(`Model profile "${config.name}" does not have an API key.`);

  const result = await callImageGeneration(config, {
    prompt,
    n: getOptionalNumberArg(args, "n", 1),
    size: getOptionalStringArg(args, "size"),
    quality: getOptionalStringArg(args, "quality"),
    background: getOptionalStringArg(args, "background"),
    outputFormat: getOptionalStringArg(args, "outputFormat") || getOptionalStringArg(args, "output_format"),
  });
  const items = result.data ?? [];
  if (!items.length) throw new Error("Image generation returned no images.");
  const artifacts = await Promise.all(items.map((item) => imageItemToArtifact(item, "image", "image/png")));
  return formatArtifacts(`Generated ${artifacts.length} image artifact(s) with ${config.name} / ${config.model}:`, artifacts);
}

export async function editImage(args: Record<string, unknown>, ctx: ToolExecutionContext) {
  const prompt = getStringArg(args, "prompt");
  const images = readStringList(args.images ?? args.image ?? args.sourceImages ?? args.source_images);
  if (!images.length) {
    throw new Error("At least one source image is required.");
  }
  const config = await resolveModelConfigFromArgs(args, ctx, { capability: "image_editing", allowDefault: false });
  if (!config.apiKey && !modelConfigAllowsEmptyApiKey(config)) throw new Error(`Model profile "${config.name}" does not have an API key.`);

  const sourceImages = await Promise.all(images.map(async (image) => {
    const source = await loadSourceBytes(image);
    return {
      buffer: source.buffer,
      filename: source.filename,
      mimeType: source.mimeType,
    };
  }));
  const inputFidelity = getOptionalStringArg(args, "inputFidelity") || getOptionalStringArg(args, "input_fidelity");
  const result = await callImageEdit(config, {
    prompt,
    images: sourceImages,
    n: getOptionalNumberArg(args, "n", 1),
    size: getOptionalStringArg(args, "size"),
    quality: getOptionalStringArg(args, "quality"),
    background: getOptionalStringArg(args, "background"),
    inputFidelity: inputFidelity === "low" || inputFidelity === "high" ? inputFidelity : undefined,
    outputFormat: getOptionalStringArg(args, "outputFormat") || getOptionalStringArg(args, "output_format"),
  });
  const items = result.data ?? [];
  if (!items.length) throw new Error("Image edit returned no images.");
  const artifacts = await Promise.all(items.map((item) => imageItemToArtifact(item, "edited-image", "image/png")));
  return formatArtifacts(`Edited ${artifacts.length} image artifact(s) with ${config.name} / ${config.model}:`, artifacts);
}

export async function transcribeAudio(args: Record<string, unknown>, ctx: ToolExecutionContext) {
  const source = getStringArg(args, "audio", ["file", "url", "audioUrl", "audio_url"]);
  const prompt = getOptionalStringArg(args, "prompt");
  const config = await resolveModelConfigFromArgs(args, ctx, { capability: "speech_to_text", allowDefault: false });
  if (!config.apiKey && !modelConfigAllowsEmptyApiKey(config)) throw new Error(`Model profile "${config.name}" does not have an API key.`);
  const audio = await loadSourceBytes(source);
  const transcript = await callSpeechToText(config, {
    file: audio.buffer,
    filename: audio.filename,
    mimeType: audio.mimeType,
    prompt,
  });
  return [
    `Profile: ${config.name}`,
    `Model: ${config.model}`,
    `Audio: ${audio.filename}`,
    "",
    transcript,
  ].join("\n");
}

export async function synthesizeSpeech(args: Record<string, unknown>, ctx: ToolExecutionContext) {
  const input = getStringArg(args, "input", ["text"]);
  const config = await resolveModelConfigFromArgs(args, ctx, { capability: "text_to_speech", allowDefault: false });
  if (!config.apiKey && !modelConfigAllowsEmptyApiKey(config)) throw new Error(`Model profile "${config.name}" does not have an API key.`);
  const result = await callTextToSpeech(config, {
    input,
    voice: getOptionalStringArg(args, "voice", "alloy"),
    instructions: getOptionalStringArg(args, "instructions"),
  });
  const artifact = await saveGeneratedArtifact(result.buffer, result.mimeType, "speech");
  return formatArtifacts(`Generated speech artifact with ${config.name} / ${config.model}:`, [artifact]);
}
