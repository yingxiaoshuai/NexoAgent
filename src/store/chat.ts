import { create } from "zustand";
import { v4 as uuid } from "uuid";
import { message as antdMessage } from "antd";
import type {
  AgentSettings,
  Attachment as ChatAttachment,
  ChatMessage,
  ConversationSurface,
  MessageBlock as SharedMessageBlock,
  ModelProfile,
} from "../shared/types";
import { apiDelete, apiGet, apiPatch, apiPost, getRuntimeApiBase, setRuntimeApiBase, subscribeStream } from "../services/api";
import { sanitizeApiKeyForSave } from "../shared/settings";
import type { DesktopApi } from "../shared/desktop";
import {
  getDefaultServiceProviderName,
  getProviderDefaultApiBase,
  normalizeProviderApiBase,
  normalizeProviderId,
  normalizeServiceProviderName,
} from "../shared/providers";
import type { ToolCallEvent } from "../components/ChatPanel/ToolCallSteps";

const TOKEN_FLUSH_INTERVAL_MS = 50;

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export type Attachment = ChatAttachment;

export type MessageToolCalls = Record<string, ToolCallEvent[]>;

export type MessageBlock = SharedMessageBlock;

export type MessageBlocks = Record<string, MessageBlock[]>;

interface SendMessageOptions {
  surface?: ConversationSurface;
}

interface ChatStore {
  sessions: SessionMeta[];
  activeSessionId: string | null;
  messages: ChatMessage[];
  toolCalls: MessageToolCalls;
  messageBlocks: MessageBlocks;
  undoableMessageIds: Set<string>;
  streaming: boolean;
  settings: AgentSettings;
  modelProfiles: ModelProfile[];
  modelProfilesLoaded: boolean;
  modelProfilesLoading: boolean;
  ensureRuntimeReady: () => Promise<void>;
  loadSessions: () => Promise<void>;
  loadModelProfiles: () => Promise<ModelProfile[]>;
  newSession: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  sendMessage: (content: string, attachments?: Attachment[], options?: SendMessageOptions) => Promise<void>;
  cancelStream: () => void;
  undoAssistantMessage: (messageId: string) => Promise<void>;
  loadSettings: () => Promise<void>;
  saveSettings: (partial: Partial<AgentSettings>) => Promise<void>;
}

function replaceMessageId(messages: ChatMessage[], fromId: string, toId: string) {
  return messages.map((message) => (message.id === fromId ? { ...message, id: toId } : message));
}

function replaceMessageBlockKey<T>(record: Record<string, T>, fromId: string, toId: string) {
  if (!(fromId in record)) return record;
  const next = { ...record } as Record<string, T>;
  next[toId] = next[fromId];
  delete next[fromId];
  return next;
}

function buildMessageTraceState(messages: ChatMessage[]) {
  const toolCalls: MessageToolCalls = {};
  const messageBlocks: MessageBlocks = {};

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    if (message.meta?.toolCalls?.length) {
      toolCalls[message.id] = [...message.meta.toolCalls];
    }
    if (message.meta?.messageBlocks?.length) {
      messageBlocks[message.id] = [...message.meta.messageBlocks];
    }
  }

  return { toolCalls, messageBlocks };
}

const defaultSettings: AgentSettings = {
  providerId: "openai-compatible",
  providerName: getDefaultServiceProviderName("openai-compatible"),
  apiBase: "https://api.openai.com/v1",
  apiKey: "",
  hasApiKey: false,
  model: "gpt-4o-mini",
  temperature: 0.4,
  contextWindowTokens: 128_000,
  reservedOutputTokens: 8_192,
  autoCompactTokenLimit: 96_000,
  compactionTargetRatio: 0.6,
  contextWindowSource: "default",
  contextWindowSourceDetail: "client-default",
  maxContextTurns: 12,
  enableContextCompaction: true,
  contextCompactionThreshold: 24,
  shellCommandTimeoutMs: 300_000,
  planningMode: "balanced",
  thinkingEnabled: true,
  thinkingEffort: "high",
  circuitBreakerEnabled: true,
  circuitBreakerConsecutiveFailureLimit: 3,
  circuitBreakerRepeatedToolCallLimit: 10,
  circuitBreakerTokenBudget: 0,
  enableMemory: true,
  enableKnowledge: true,
  workspacePath: "",
  fileAccessRoots: [],
  webHost: "0.0.0.0",
  webPort: 9898,
  webPassword: "",
  channels: { web: true, desktop: true, feishu: false, dingtalk: false, wechat: false, wecom: false },
};

function normalizeSettingsShape<T extends Partial<AgentSettings>>(settings: T): T {
  const providerId = normalizeProviderId(settings.providerId);
  const apiBase = normalizeProviderApiBase(
    settings.apiBase?.trim() || getProviderDefaultApiBase(providerId),
    providerId,
    settings.providerName,
  );
  return {
    ...settings,
    providerId,
    providerName: normalizeServiceProviderName(settings.providerName, apiBase, providerId) || getDefaultServiceProviderName(providerId),
    apiBase,
  };
}

function getDesktopApi(): DesktopApi | null {
  return window.nexoDesktop ?? null;
}

function formatAssistantError(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return "Error";
  return /^error:/i.test(trimmed) ? trimmed : `Error: ${trimmed}`;
}

export const useChatStore = create<ChatStore>((set, get) => {
  let runtimeReadyPromise: Promise<void> | null = null;

  async function ensureRuntimeReady() {
    const explicitRuntimeBase = getRuntimeApiBase();
    if (explicitRuntimeBase) return;
    const desktop = getDesktopApi();
    if (!desktop) return;
    if (runtimeReadyPromise) return runtimeReadyPromise;

    runtimeReadyPromise = desktop.getRuntimeInfo()
      .then((runtime) => {
        setRuntimeApiBase(runtime.webBaseUrl);
      })
      .finally(() => {
        runtimeReadyPromise = null;
      });

    return runtimeReadyPromise;
  }

  async function syncSettingsToServer(settings: AgentSettings) {
    await ensureRuntimeReady();

    const payload = sanitizeApiKeyForSave(settings);
    try {
      const synced = await apiPost<AgentSettings>("/api/settings", {
        ...payload,
        hasApiKey: settings.hasApiKey || Boolean(payload.apiKey),
      });
      set({
        settings: normalizeSettingsShape({
          ...defaultSettings,
          ...synced,
          apiKey: "",
          hasApiKey: synced.hasApiKey ?? settings.hasApiKey,
        }),
      });
    } catch (error) {
      console.warn("[settings] failed to sync to backend:", error);
    }
  }

  return {
    sessions: [],
    activeSessionId: null,
    messages: [],
    toolCalls: {},
    messageBlocks: {},
    undoableMessageIds: new Set(),
    streaming: false,
    settings: defaultSettings,
    modelProfiles: [],
    modelProfilesLoaded: false,
    modelProfilesLoading: false,
    cancelStream: () => {},
    undoAssistantMessage: async (messageId) => {
      const activeSessionId = get().activeSessionId;
      if (!activeSessionId || !messageId) return;
      try {
        const result = await apiPost<{ ok: boolean; restoredCount?: number; reason?: string; message?: string; turnId?: string }>(
          `/api/chat/${activeSessionId}/undo`,
          { messageId }
        );
        if (result.ok) {
          set((state) => {
            const next = new Set(state.undoableMessageIds);
            next.delete(messageId);
            if (result.turnId) next.delete(result.turnId);
            return { undoableMessageIds: next };
          });
          await get().selectSession(activeSessionId);
          void antdMessage.success(`已撤回 ${result.restoredCount ?? 0} 个文件`);
        } else {
          void antdMessage.error(result.message || "撤回失败");
        }
      } catch (err) {
        void antdMessage.error(err instanceof Error ? err.message : "撤回失败");
      }
    },
    ensureRuntimeReady,

    loadSessions: async () => {
      await ensureRuntimeReady();
      const sessions = await apiGet<SessionMeta[]>("/api/sessions");
      set({ sessions });
    },

    loadModelProfiles: async () => {
      await ensureRuntimeReady();
      set({ modelProfilesLoading: true });
      try {
        const profiles = await apiGet<ModelProfile[]>("/api/model-profiles");
        set({
          modelProfiles: profiles,
          modelProfilesLoaded: true,
          modelProfilesLoading: false,
        });
        return profiles;
      } catch (error) {
        set({
          modelProfiles: [],
          modelProfilesLoaded: true,
          modelProfilesLoading: false,
        });
        throw error;
      }
    },

    newSession: async () => {
      await ensureRuntimeReady();
      const session = await apiPost<SessionMeta>("/api/sessions", {});
      set((state) => ({
        sessions: [session, ...state.sessions],
        activeSessionId: session.id,
        messages: [],
        toolCalls: {},
        messageBlocks: {},
    undoableMessageIds: new Set(),
      }));
    },

    selectSession: async (id) => {
      await ensureRuntimeReady();
      const messages = await apiGet<ChatMessage[]>(`/api/sessions/${id}/messages`);
      const traceState = buildMessageTraceState(messages);
      set({ activeSessionId: id, messages, ...traceState, undoableMessageIds: new Set() });
    },

    deleteSession: async (id) => {
      await ensureRuntimeReady();
      await apiDelete(`/api/sessions/${id}`);
      const { sessions, activeSessionId } = get();
      const next = sessions.filter((session) => session.id !== id);
      const newActive = activeSessionId === id ? (next[0]?.id ?? null) : activeSessionId;
      set({
        sessions: next,
        activeSessionId: newActive,
        messages: newActive === activeSessionId ? get().messages : [],
        toolCalls: {},
        messageBlocks: {},
    undoableMessageIds: new Set(),
      });
      if (newActive && newActive !== activeSessionId) {
        await get().selectSession(newActive);
      }
    },

    renameSession: async (id, title) => {
      await ensureRuntimeReady();
      await apiPatch(`/api/sessions/${id}`, { title });
      set((state) => ({ sessions: state.sessions.map((session) => (session.id === id ? { ...session, title } : session)) }));
    },

    sendMessage: async (content, attachments, options) => {
      let { activeSessionId, settings } = get();
      if (!activeSessionId) {
        await get().newSession();
        activeSessionId = get().activeSessionId!;
      }

      const userMessage: ChatMessage = {
        id: uuid(),
        role: "user",
        content,
        createdAt: new Date().toISOString(),
        status: "completed",
        attachments: attachments || [],
      };
      const assistantId = uuid();
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
        status: "sending",
      };

      set((state) => ({ messages: [...state.messages, userMessage, assistantMessage], streaming: true }));

      let requestId: string;
      let serverTurnId = assistantId;
      try {
        const response = await apiPost<{ requestId: string; turnId?: string }>("/api/chat", {
          sessionId: activeSessionId,
          message: content,
          settings,
          attachments: attachments || [],
          surface: options?.surface ?? "chat",
        });
        requestId = response.requestId;
        if (response.turnId && response.turnId !== assistantId) {
          serverTurnId = response.turnId;
          set((state) => ({
            messages: replaceMessageId(state.messages, assistantId, response.turnId!),
            toolCalls: replaceMessageBlockKey(state.toolCalls, assistantId, response.turnId!),
            messageBlocks: replaceMessageBlockKey(state.messageBlocks, assistantId, response.turnId!),
            undoableMessageIds: state.undoableMessageIds.has(assistantId)
              ? new Set([...state.undoableMessageIds].map((id) => (id === assistantId ? response.turnId! : id)))
              : state.undoableMessageIds,
          }));
        }
      } catch (error) {
        set((state) => ({
          streaming: false,
          messages: state.messages.map((message) =>
            message.id === assistantId
              ? { ...message, content: formatAssistantError(error instanceof Error ? error.message : String(error)), status: "failed" }
              : message
          ),
        }));
        return;
      }

      const toolStartTimes: Record<string, number> = {};
      let full = "";
      let pendingToken = "";
      let tokenFlushTimer: ReturnType<typeof setTimeout> | null = null;

      const applyTokenChunk = (chunk: string) => {
        if (!chunk) return;
        set((state) => {
          const blocks = [...(state.messageBlocks[serverTurnId] ?? [])];
          const last = blocks[blocks.length - 1];
          if (last?.type === "text") {
            blocks[blocks.length - 1] = { type: "text", content: last.content + chunk };
          } else {
            blocks.push({ type: "text", content: chunk });
          }
          return {
            messages: state.messages.map((message) => (message.id === serverTurnId ? { ...message, content: full } : message)),
            messageBlocks: { ...state.messageBlocks, [serverTurnId]: blocks },
          };
        });
      };

      const flushPendingTokens = () => {
        if (tokenFlushTimer) {
          clearTimeout(tokenFlushTimer);
          tokenFlushTimer = null;
        }
        const chunk = pendingToken;
        pendingToken = "";
        applyTokenChunk(chunk);
      };

      const scheduleTokenFlush = () => {
        if (tokenFlushTimer) return;
        tokenFlushTimer = setTimeout(() => {
          tokenFlushTimer = null;
          const chunk = pendingToken;
          pendingToken = "";
          applyTokenChunk(chunk);
        }, TOKEN_FLUSH_INTERVAL_MS);
      };

      const appendToken = (token: string) => {
        full += token;
        pendingToken += token;
        scheduleTokenFlush();
      };

      const cancel = subscribeStream(requestId, (event) => {
        if (event.type === "token") {
          appendToken(event.content as string);
          return;
        }

        if (event.type === "tool_call") {
          flushPendingTokens();
          const toolCall: ToolCallEvent = {
            id: event.id as string,
            name: event.name as string,
            input: event.input,
            status: "running",
          };
          toolStartTimes[toolCall.id] = Date.now();
          set((state) => ({
            toolCalls: {
              ...state.toolCalls,
              [serverTurnId]: [...(state.toolCalls[serverTurnId] ?? []), toolCall],
            },
            messageBlocks: {
              ...state.messageBlocks,
              [serverTurnId]: [...(state.messageBlocks[serverTurnId] ?? []), { type: "tool", id: toolCall.id }],
            },
          }));
          return;
        }

        if (event.type === "tool_result") {
          const output = String(event.output ?? "");
          const isError = output.trim().startsWith("Error:");
          const elapsed = toolStartTimes[event.id as string]
            ? (Date.now() - toolStartTimes[event.id as string]) / 1000
            : 0;
          set((state) => ({
            toolCalls: {
              ...state.toolCalls,
              [serverTurnId]: (state.toolCalls[serverTurnId] ?? []).map((toolCall) =>
                toolCall.id === event.id
                  ? { ...toolCall, output, elapsed, status: isError ? "error" : "done" }
                  : toolCall
              ),
            },
          }));
          return;
        }

        if (event.type === "done") {
          flushPendingTokens();
          const status = String(event.status ?? "completed") as ChatMessage["status"];
          const responseAttachments = Array.isArray(event.attachments)
            ? (event.attachments as ChatAttachment[])
            : [];
          const responseToolCalls = Array.isArray(event.toolCalls)
            ? (event.toolCalls as ToolCallEvent[])
            : undefined;
          const responseMessageBlocks = Array.isArray(event.messageBlocks)
            ? (event.messageBlocks as MessageBlock[])
            : undefined;
          set((state) => ({
            streaming: false,
            cancelStream: () => {},
            toolCalls: responseToolCalls
              ? { ...state.toolCalls, [serverTurnId]: responseToolCalls }
              : state.toolCalls,
            messageBlocks: responseMessageBlocks
              ? { ...state.messageBlocks, [serverTurnId]: responseMessageBlocks }
              : state.messageBlocks,
            messages: state.messages.map((message) =>
              message.id === serverTurnId
                ? {
                    ...message,
                    content: full || (event.content as string),
                    status,
                    attachments: responseAttachments.length ? responseAttachments : message.attachments,
                    meta: {
                      ...(message.meta ?? {}),
                      ...(responseToolCalls ? { toolCalls: responseToolCalls } : {}),
                      ...(responseMessageBlocks ? { messageBlocks: responseMessageBlocks } : {}),
                    },
                  }
                : message
            ),
          }));
          const snap = (event as any).hasSnapshot;
          if (snap) {
            set((state) => ({
              undoableMessageIds: new Set([...state.undoableMessageIds, serverTurnId]),
            }));
          }
          void get().loadSessions();
          cancel();
          return;
        }

        if (event.type === "error") {
          flushPendingTokens();
          set((state) => ({
            streaming: false,
            cancelStream: () => {},
            messages: state.messages.map((message) =>
              message.id === serverTurnId
                ? { ...message, content: formatAssistantError(String(event.message ?? "")), status: "failed" }
                : message
            ),
          }));
          cancel();
        }
      });

      set({
        cancelStream: () => {
          flushPendingTokens();
          void apiPost<{ ok: boolean }>(`/api/chat/${requestId}/interrupt`, {}).catch(() => undefined);
          cancel();
          set((state) => ({
            streaming: false,
            cancelStream: () => {},
            messages: state.messages.map((message) =>
              message.id === serverTurnId && message.status === "sending"
                ? { ...message, content: message.content || "\u5df2\u505c\u6b62\u5f53\u524d\u8fd0\u884c\u3002", status: "interrupted" }
                : message
            ),
          }));
        },
      });
    },

    loadSettings: async () => {
      const desktop = getDesktopApi();
      if (desktop) {
        await ensureRuntimeReady();
        const settings = await desktop.loadSettings();
        const merged = normalizeSettingsShape({ ...defaultSettings, ...settings });
        set({ settings: merged });
        await syncSettingsToServer(merged);
        return;
      }

      const stored = localStorage.getItem("nexo-settings");
      let merged = { ...defaultSettings } as AgentSettings;
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as AgentSettings;
          const hasApiKey = parsed.hasApiKey || Boolean(parsed.apiKey?.trim());
          merged = normalizeSettingsShape({ ...defaultSettings, ...parsed, apiKey: "", hasApiKey });
          set({ settings: merged });
        } catch {
          // Ignore invalid local settings.
        }
      }

      try {
        const remote = await apiGet<AgentSettings>("/api/settings");
        merged = normalizeSettingsShape({
          ...merged,
          ...remote,
          apiKey: "",
          hasApiKey: remote.hasApiKey || merged.hasApiKey,
        });
        set({ settings: merged });
      } catch {
        // Ignore remote settings load failures.
      }

      await syncSettingsToServer(merged);
    },

    saveSettings: async (partial) => {
      const current = get().settings;
      const merged = normalizeSettingsShape({ ...current, ...partial }) as AgentSettings;
      set({
        settings: normalizeSettingsShape({
          ...defaultSettings,
          ...merged,
          hasApiKey: partial.hasApiKey ?? (current.hasApiKey || Boolean((partial.apiKey ?? "").trim())),
        }) as AgentSettings,
      });

      await ensureRuntimeReady();
      const payload = sanitizeApiKeyForSave(merged);
      const desktop = getDesktopApi();
      if (desktop) {
        const saved = await desktop.saveSettings(payload);
        const next = normalizeSettingsShape({ ...defaultSettings, ...saved });
        set({ settings: next });
        await syncSettingsToServer(next);
        return;
      }

      localStorage.setItem("nexo-settings", JSON.stringify(payload));
      const next = normalizeSettingsShape({
        ...defaultSettings,
        ...payload,
        hasApiKey: Boolean(payload.apiKey) || merged.hasApiKey,
      });
      set({ settings: next });
      await syncSettingsToServer(next);
    },
  };
});
