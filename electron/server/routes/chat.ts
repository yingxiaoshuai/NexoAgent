import type { Application } from "express";
import { randomUUID } from "node:crypto";
import type { AgentSettings } from "../../../src/shared/types";
import { extractMemoryAfterChat, streamFromLLM } from "../agent";
import { clearRun, interruptRun, registerRun } from "../run-control";
import { buildRuntimeSettings } from "../settings";
import { ensureSessionsLoaded, saveSessionsToDisk, getSessionsMap } from "../sessions";
import { createSseQueue, pushEvent, scheduleSseCleanup } from "../sse";
import type { ChatAttachment } from "../types";
import type { ServerContext } from "./context";

export function registerChatRoutes(app: Application, ctx: ServerContext) {
  app.post("/api/chat/:requestId/interrupt", async (req, res) => {
    interruptRun(req.params.requestId);
    res.json({ ok: true });
  });

  app.post("/api/chat", async (req, res) => {
    await ensureSessionsLoaded();
    const { sessionId, message, settings, attachments } = req.body as {
      sessionId: string;
      message: string;
      settings: AgentSettings;
      attachments?: ChatAttachment[];
    };
    const messageAttachments = attachments ?? [];

    let s = getSessionsMap().get(sessionId);
    if (!s) {
      const now = new Date().toISOString();
      s = { id: sessionId, title: "New Chat", messages: [], createdAt: now, updatedAt: now };
      getSessionsMap().set(sessionId, s);
    }

    const userMsg = {
      id: randomUUID(),
      role: "user" as const,
      content: message,
      createdAt: new Date().toISOString(),
      status: "completed" as const,
      attachments: messageAttachments,
    };
    s.messages.push(userMsg);
    if (s.messages.filter((m) => m.role === "user").length === 1) {
      s.title = message.slice(0, 40) + (message.length > 40 ? "..." : "");
    }

    const requestId = randomUUID();
    registerRun(requestId);
    createSseQueue(requestId);
    const sessionRef = s;

    const runtimeSettings = buildRuntimeSettings(settings ?? {});

    void streamFromLLM(runtimeSettings, sessionRef, requestId, ctx.getStoredApiKey(), messageAttachments)
      .then(async (doneEvent) => {
        sessionRef.messages.push({
          id: randomUUID(),
          role: "assistant",
          content: doneEvent.content,
          createdAt: new Date().toISOString(),
          status: doneEvent.status,
        });
        sessionRef.updatedAt = new Date().toISOString();
        void saveSessionsToDisk();

        if (runtimeSettings.enableMemory && doneEvent.status === "completed") {
          void extractMemoryAfterChat(message, doneEvent.content, sessionId, runtimeSettings, ctx.getStoredApiKey());
        }
      })
      .catch((error) => {
        const content = error instanceof Error ? error.message : String(error);
        pushEvent(requestId, {
          type: "done",
          content,
          status: "failed",
          stopReason: "runtime_error",
        });
        sessionRef.messages.push({
          id: randomUUID(),
          role: "assistant",
          content,
          createdAt: new Date().toISOString(),
          status: "failed",
        });
        sessionRef.updatedAt = new Date().toISOString();
        void saveSessionsToDisk();
      })
      .finally(() => {
        clearRun(requestId);
        scheduleSseCleanup(requestId);
      });

    res.json({ requestId, userMessageId: userMsg.id });
  });
}
