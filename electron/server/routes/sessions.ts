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
    const session: Session = { id, title: "New Chat", messages: [], createdAt: now, updatedAt: now };
    getSessionsMap().set(id, session);
    void saveSessionsToDisk();
    res.json(session);
  });

  app.get("/api/sessions/:id/messages", async (req, res) => {
    await ensureSessionsLoaded();
    const session = getSessionsMap().get(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found." });
    return res.json(session.messages);
  });

  app.delete("/api/sessions/:id", async (req, res) => {
    await ensureSessionsLoaded();
    getSessionsMap().delete(req.params.id);
    void saveSessionsToDisk();
    res.json({ ok: true });
  });

  app.patch("/api/sessions/:id", async (req, res) => {
    await ensureSessionsLoaded();
    const session = getSessionsMap().get(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found." });
    const { title } = req.body as { title?: string };
    if (title) {
      session.title = title;
      session.updatedAt = new Date().toISOString();
      void saveSessionsToDisk();
    }
    res.json({ ok: true });
  });
}
