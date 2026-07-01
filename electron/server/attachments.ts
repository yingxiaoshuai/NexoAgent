import fs from "node:fs/promises";
import path from "node:path";
import { UPLOADS_DIR } from "./config";
import type { ChatAttachment } from "./types";
import { MAX_FILE_READ_BYTES } from "./knowledge";
import { resolveDataPath } from "./utils";

export async function loadAttachmentContext(attachments: ChatAttachment[] = []) {
  const parts: string[] = [];
  for (const attachment of attachments) {
    if (attachment.type === "image") {
      parts.push(`Image attachment: ${attachment.name} (${attachment.url}). The image is attached directly to the current user message for multimodal models; analyze it directly instead of calling a vision tool.`);
      continue;
    }
    if (attachment.type === "audio") {
      parts.push(`Audio attachment: ${attachment.name} (${attachment.url}). Use invoke_model with capability="speech_to_text" and audio="${attachment.url}" for transcription.`);
      continue;
    }
    const fileName = path.basename(attachment.url);
    const fullPath = resolveDataPath(UPLOADS_DIR, fileName);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat?.isFile()) continue;
    if (stat.size > MAX_FILE_READ_BYTES) {
      parts.push(`File attachment: ${attachment.name}, ${stat.size} bytes. Too large to inline.`);
      continue;
    }
    const content = await fs.readFile(fullPath, "utf8").catch(() => "");
    parts.push(`File attachment: ${attachment.name}\n${content}`);
  }
  return parts.join("\n\n---\n\n");
}
