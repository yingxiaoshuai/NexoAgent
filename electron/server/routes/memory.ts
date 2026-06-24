import type { Application } from "express";
import {
  loadMemory,
  getAllMemories,
  deleteMemory,
  clearAllMemory,
  storeScriptMemory,
  searchMemories,
  consolidateDreamForDay,
  normalizeDayKey,
} from "../../memory";
import { getWebSettings } from "../settings";
import { getOptionalNumberArg, parseMemoryKind, parseMemoryKinds } from "../utils";
import type { ServerContext } from "./context";

export function registerMemoryRoutes(app: Application, ctx: ServerContext) {
  const getModelSettings = () => {
    const webSettings = getWebSettings();
    const providerId = webSettings.providerId || "openai-compatible";
    const providerName = webSettings.providerName || "";
    const apiBase = (webSettings.apiBase || "https://api.openai.com/v1").replace(/\/+$/, "");
    const apiKey = webSettings.apiKey || ctx.getStoredApiKey() || "";
    return {
      providerId,
      providerName,
      apiKey,
      apiBase,
      model: webSettings.model || "gpt-4o-mini",
      embeddingSettings: {
        providerId,
        providerName,
        apiKey,
        apiBase,
        model: webSettings.model || "gpt-4o-mini",
        temperature: webSettings.temperature ?? 0,
      },
    };
  };

  app.get("/api/memory", async (req, res) => {
    await loadMemory();
    res.json(getAllMemories({
      kind: parseMemoryKind(req.query.kind),
      dayKey: typeof req.query.dayKey === "string" ? req.query.dayKey : undefined,
    }));
  });

  app.get("/api/memory/search", async (req, res) => {
    const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
    if (!query) return res.status(400).json({ error: "query required" });
    const { embeddingSettings } = getModelSettings();
    const results = await searchMemories(query, embeddingSettings, {
      kinds: parseMemoryKinds(req.query.kinds ?? req.query.kind),
      dayKey: typeof req.query.dayKey === "string" ? req.query.dayKey : undefined,
      k: getOptionalNumberArg(req.query as Record<string, unknown>, "k", 6),
    });
    return res.json(results);
  });

  app.post("/api/memory/script", async (req, res) => {
    const { key, content, scope, metadata, dayKey } = req.body as {
      key?: string;
      content?: string;
      scope?: string;
      metadata?: Record<string, unknown>;
      dayKey?: string;
    };
    if (!key?.trim()) return res.status(400).json({ error: "key required" });
    if (!content?.trim()) return res.status(400).json({ error: "content required" });

    const { embeddingSettings } = getModelSettings();
    const id = await storeScriptMemory(key.trim(), content.trim(), { scope, metadata, embeddingSettings, dayKey });
    return res.json({ ok: true, id });
  });

  app.post("/api/memory/dream/:dayKey/regenerate", async (req, res) => {
    const dayKey = normalizeDayKey(req.params.dayKey);
    const { apiKey, apiBase, model, embeddingSettings } = getModelSettings();
    const result = await consolidateDreamForDay(dayKey, { apiKey, apiBase, model, embeddingSettings });
    return res.status(result.ok ? 200 : 400).json(result);
  });

  app.delete("/api/memory/:id", async (req, res) => {
    await deleteMemory(req.params.id);
    res.json({ ok: true });
  });

  app.delete("/api/memory", async (req, res) => {
    await clearAllMemory({
      kind: parseMemoryKind(req.query.kind),
      dayKey: typeof req.query.dayKey === "string" ? req.query.dayKey : undefined,
    });
    res.json({ ok: true });
  });
}
