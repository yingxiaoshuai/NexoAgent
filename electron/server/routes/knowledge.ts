import type { Application } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { KNOWLEDGE_DIR } from "../config";
import { buildKnowledgeTree, deleteKnowledgeVectors, upsertKnowledgeFile } from "../knowledge";
import { resolveMemoryEmbeddingSettings } from "../memory-embedding";
import { resolveDataPath } from "../utils";

export function registerKnowledgeRoutes(app: Application) {
  app.get("/api/knowledge/tree", async (_req, res) => {
    res.json(await buildKnowledgeTree(KNOWLEDGE_DIR));
  });

  app.get("/api/knowledge/file", async (req, res) => {
    const relPath = decodeURIComponent((req.query.path || "") as string);
    if (!relPath) return res.status(400).json({ error: "path required" });
    const fullPath = resolveDataPath(KNOWLEDGE_DIR, relPath);
    try {
      const content = await fs.readFile(fullPath, "utf8");
      return res.json({ content, name: path.basename(fullPath) });
    } catch {
      return res.status(404).json({ error: "not found" });
    }
  });

  app.post("/api/knowledge/file", async (req, res) => {
    const { path: relPath, content } = req.body;
    if (!relPath || typeof relPath !== "string") return res.status(400).json({ error: "path required" });
    const fullPath = resolveDataPath(KNOWLEDGE_DIR, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content || "", "utf8");
    const embeddingSettings = await resolveMemoryEmbeddingSettings();
    void upsertKnowledgeFile(relPath, embeddingSettings).catch(() => undefined);
    res.json({ ok: true });
  });

  app.delete("/api/knowledge/file", async (req, res) => {
    const relPath = decodeURIComponent((req.query.path || "") as string);
    const fullPath = resolveDataPath(KNOWLEDGE_DIR, relPath);
    try { await fs.unlink(fullPath); } catch { /* ignore */ }
    void deleteKnowledgeVectors(relPath).catch(() => undefined);
    res.json({ ok: true });
  });
}
