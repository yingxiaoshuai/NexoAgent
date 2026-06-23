import { getApiBase } from "../../services/api";
import type { Attachment } from "../../shared/types";

function inferAttachmentType(file: File, fallback?: string): Attachment["type"] {
  if (fallback === "image" || fallback === "audio" || fallback === "file") {
    return fallback;
  }
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

async function uploadSingleFile(file: File): Promise<Attachment> {
  const form = new FormData();
  form.append("file", file);

  const response = await fetch(`${getApiBase()}/api/upload`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${file.name}`);
  }

  const data = await response.json() as Partial<Attachment>;
  return {
    url: data.url || "",
    name: data.name || file.name,
    type: inferAttachmentType(file, typeof data.type === "string" ? data.type : undefined),
    mimeType: data.mimeType || file.type,
    size: data.size || file.size,
    source: "upload",
  };
}

export async function uploadFiles(files: File[]): Promise<Attachment[]> {
  const validFiles = files.filter((file) => file.size >= 0);
  if (validFiles.length === 0) return [];
  return Promise.all(validFiles.map((file) => uploadSingleFile(file)));
}
