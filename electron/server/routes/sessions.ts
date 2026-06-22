import type { Application } from "express";
import { randomUUID } from "node:crypto";
import { ensureSessionsLoaded, getSessionsMap, saveSessionsToDisk } from "../sessions";
import type { Session } from "../types";

export function registerSessionRoutes(app: Application) {
  app.get("/api/sessions", async (_req, res) => {
    await ensureSessionsLoaded();
    const list = [...getSessionsMap().values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }));
    res.json(list);
  });

  app.post("/api/sessions", async (_req, res) => {
    await ensureSessionsLoaded();
    const id = randomUUID();
    const now = new Date().toISOString();
    const s: Session = { id, title: "\u65b0\u5bf9\u8bdd", messages: [], createdAt: now, updatedAt: now };
    getSessionsMap().set(id, s);
    void saveSessionsToDisk();
    res.json(s);
  });

  app.get("/api/sessions/:id/messages", async (req, res) => {
    await ensureSessionsLoaded();
    const s = getSessionsMap().get(req.params.id);
    if (!s) return res.status(404).json({ error: "\u4f1a\u8bdd\u4e0d\u5b58\u5728" });
    return res.json(s.messages);
  });

  app.delete("/api/sessions/:id", async (req, res) => {
    await ensureSessionsLoaded();
    getSessionsMap().delete(req.params.id);
    void saveSessionsToDisk();
    res.json({ ok: true });
  });

  app.patch("/api/sessions/:id", async (req, res) => {
    await ensureSessionsLoaded();
    const s = getSessionsMap().get(req.params.id);
    if (!s) return res.status(404).json({ error: "\u4f1a\u8bdd\u4e0d\u5b58\u5728" });
    const { title } = req.body as { title?: string };
    if (title) {
      s.title = title;
      s.updatedAt = new Date().toISOString();
      void saveSessionsToDisk();
    }
    res.json({ ok: true });
  });
}
