import type { Application } from "express";
import { randomUUID } from "node:crypto";
import type { AgentSettings, ConversationSurface } from "../../../src/shared/types";
import { extractMemoryAfterChat, streamFromLLM } from "../agent";
import { getLatestSnapshotTurnId, getSnapshotMeta, restoreSnapshot } from "../snapshot";
import { clearRun, interruptRun, registerRun } from "../run-control";
import { buildRuntimeSettings } from "../settings";
import { ensureSessionsLoaded, getSessionsMap, saveSessionsToDisk } from "../sessions";
import { createSseQueue, pushEvent, scheduleSseCleanup } from "../sse";
import type { ChatAttachment } from "../types";
import type { ServerContext } from "./context";

function findAssistantMessageIndexById(messages: Array<{ id: string; role: string }>, messageId: string) {
  return messages.findIndex((message) => message.role === "assistant" && message.id === messageId);
}

function normalizeConversationSurface(value: unknown): ConversationSurface {
  return value === "browser" ? "browser" : "chat";
}

export function registerChatRoutes(app: Application, ctx: ServerContext) {
  app.post("/api/chat/:requestId/interrupt", async (req, res) => {
    interruptRun(req.params.requestId);
    res.json({ ok: true });
  });

  app.post("/api/chat", async (req, res) => {
    await ensureSessionsLoaded();
    const { sessionId, message, settings, attachments, surface } = req.body as {
      sessionId: string;
      message: string;
      settings: AgentSettings;
      attachments?: ChatAttachment[];
      surface?: ConversationSurface;
    };
    const messageAttachments = attachments ?? [];
    const conversationSurface = normalizeConversationSurface(surface);

    let session = getSessionsMap().get(sessionId);
    if (!session) {
      const now = new Date().toISOString();
      session = { id: sessionId, title: "New Chat", messages: [], createdAt: now, updatedAt: now };
      getSessionsMap().set(sessionId, session);
    }

    const userMsg = {
      id: randomUUID(),
      role: "user" as const,
      content: message,
      createdAt: new Date().toISOString(),
      status: "completed" as const,
      attachments: messageAttachments,
    };
    session.messages.push(userMsg);
    if (session.messages.filter((item) => item.role === "user").length === 1) {
      session.title = message.slice(0, 40) + (message.length > 40 ? "..." : "");
    }

    const requestId = randomUUID();
    const turnId = randomUUID();
    registerRun(requestId);
    createSseQueue(requestId);

    const runtimeSettings = buildRuntimeSettings(settings ?? {});
    const sessionRef = session;

    void streamFromLLM(runtimeSettings, sessionRef, requestId, ctx.getStoredApiKey(), messageAttachments, turnId, conversationSurface)
      .then(async (doneEvent) => {
        sessionRef.messages.push({
          id: turnId,
          role: "assistant",
          content: doneEvent.content,
          createdAt: new Date().toISOString(),
          status: doneEvent.status,
          attachments: doneEvent.attachments ?? [],
          meta: {
            toolCalls: doneEvent.toolCalls,
            messageBlocks: doneEvent.messageBlocks,
          },
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
          id: turnId,
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

    res.json({ requestId, userMessageId: userMsg.id, turnId });
  });

  app.post("/api/chat/:sessionId/undo", async (req, res) => {
    await ensureSessionsLoaded();
    const { sessionId } = req.params;
    const { messageId } = req.body as { messageId?: string };
    const session = getSessionsMap().get(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const targetTurnId = typeof messageId === "string" && messageId.trim()
      ? messageId.trim()
      : await getLatestSnapshotTurnId(sessionId);

    if (!targetTurnId) {
      res.json({ ok: false, reason: "no_snapshot" });
      return;
    }

    const meta = await getSnapshotMeta(sessionId, targetTurnId);
    if (!meta) {
      res.json({ ok: false, reason: "no_snapshot" });
      return;
    }

    const assistantIdx = findAssistantMessageIndexById(session.messages, targetTurnId);
    if (assistantIdx === -1) {
      res.json({ ok: false, reason: "message_not_found" });
      return;
    }

    try {
      const result = await restoreSnapshot(sessionId, targetTurnId, meta.workspaceRoot);
      const undoneAt = new Date().toISOString();
      const undoneMessage = "This turn was undone and its file changes were restored.";
      const relatedIndexes = assistantIdx > 0 && session.messages[assistantIdx - 1]?.role === "user"
        ? [assistantIdx - 1, assistantIdx]
        : [assistantIdx];

      for (const index of relatedIndexes) {
        const message = session.messages[index];
        if (!message) continue;
        session.messages[index] = {
          ...message,
          status: "undone",
          meta: {
            ...(message.meta ?? {}),
            undoneAt,
            undoneMessage,
          },
        };
      }

      session.updatedAt = new Date().toISOString();
      await saveSessionsToDisk();
      res.json({ ok: true, restoredCount: result.restoredCount, turnId: targetTurnId });
    } catch (error) {
      if (error instanceof Error && error.message === "no_snapshot") {
        res.json({ ok: false, reason: "no_snapshot" });
        return;
      }
      res.json({ ok: false, reason: "restore_failed", message: error instanceof Error ? error.message : String(error) });
    }
  });
}
