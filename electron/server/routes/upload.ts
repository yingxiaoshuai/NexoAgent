import type { Application } from "express";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { UPLOADS_DIR } from "../config";
import { guessAttachmentType } from "../media";
import { resolveDataPath } from "../utils";

const EAST_ASIAN_CHAR_RE = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u;
const INVALID_STORED_FILENAME_RE = /[<>:"/\\|?*#%\u0000-\u001F]/g;
const INVALID_DOWNLOAD_FILENAME_RE = /[/\\\u0000-\u001F]/g;

function decodeMultipartFilename(filename: string) {
  const trimmed = filename.trim();
  if (!trimmed) return "file";

  const normalized = trimmed.normalize("NFC");
  if (EAST_ASIAN_CHAR_RE.test(normalized)) return normalized;

  const decoded = Buffer.from(normalized, "latin1").toString("utf8").trim().normalize("NFC");
  if (decoded && EAST_ASIAN_CHAR_RE.test(decoded) && !decoded.includes("\uFFFD")) {
    return decoded;
  }
  return normalized;
}

function sanitizeStoredFilename(filename: string) {
  const parsed = path.parse(filename.replace(INVALID_STORED_FILENAME_RE, "_"));
  const base = parsed.name.replace(/\s+/g, " ").trim().slice(0, 120) || "file";
  const ext = parsed.ext.slice(0, 24);
  return `${base}${ext}`;
}

function sanitizeDownloadFilename(filename: string, fallback: string) {
  const clean = filename.replace(INVALID_DOWNLOAD_FILENAME_RE, "_").trim();
  return clean || fallback;
}

function stripUploadPrefix(url: string) {
  const normalized = url.replace(/^https?:\/\/[^/]+/i, "").replace(/^\/+/, "");
  if (normalized.startsWith("uploads/")) return normalized.slice("uploads/".length);
  if (normalized.startsWith("uploads\\")) return normalized.slice("uploads\\".length);
  return normalized;
}

function resolveUploadFilePath(url: string) {
  const relative = stripUploadPrefix(url);
  const decoded = (() => {
    try {
      return decodeURIComponent(relative);
    } catch {
      return relative;
    }
  })();
  return resolveDataPath(UPLOADS_DIR, decoded);
}

export function registerUploadRoutes(app: Application) {
  app.use("/uploads", express.static(UPLOADS_DIR));

  app.get("/api/uploads/download", async (req, res) => {
    const url = typeof req.query.url === "string" ? req.query.url : "";
    if (!url) return res.status(400).json({ error: "url required" });

    const fullPath = resolveUploadFilePath(url);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat?.isFile()) return res.status(404).json({ error: "file not found" });

    const fallbackName = path.basename(fullPath);
    const requestedName = typeof req.query.name === "string" ? req.query.name : fallbackName;
    return res.download(fullPath, sanitizeDownloadFilename(requestedName, fallbackName));
  });

  app.post("/api/upload", async (req, res) => {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) return res.status(400).json({ error: "multipart required" });
    const Busboy = (await import("busboy")).default;
    const bb = Busboy({ headers: req.headers });
    const files: Array<{ url: string; name: string; type: string; mimeType: string; size: number }> = [];
    const pendingWrites: Promise<void>[] = [];
    await new Promise((resolve, reject) => {
      bb.on("file", (_field, stream, info) => {
        const decodedName = decodeMultipartFilename(info.filename);
        const safe = sanitizeStoredFilename(decodedName);
        const id = randomUUID().slice(0, 8);
        const fname = id + "_" + safe;
        const fullPath = path.join(UPLOADS_DIR, fname);
        const mime = info.mimeType || "";
        const fileType = guessAttachmentType(mime);
        const chunks: Buffer[] = [];
        stream.on("data", (d) => chunks.push(d));
        stream.on("end", () => {
          const body = Buffer.concat(chunks);
          pendingWrites.push(
            fs.writeFile(fullPath, body).then(() => {
              files.push({ url: "/uploads/" + fname, name: decodedName, type: fileType, mimeType: mime, size: body.byteLength });
            })
          );
        });
      });
      bb.on("finish", resolve);
      bb.on("error", reject);
      req.pipe(bb);
    });
    await Promise.all(pendingWrites);
    res.json(files[0] || { error: "no file" });
  });
}
