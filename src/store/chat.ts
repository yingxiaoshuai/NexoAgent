import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type { AgentSettings, Attachment as ChatAttachment, ChatMessage } from "../shared/types";
import { apiDelete, apiGet, apiPatch, apiPost, getRuntimeApiBase, setRuntimeApiBase, subscribeStream } from "../services/api";
import { sanitizeApiKeyForSave } from "../shared/settings";
import {
  getDefaultServiceProviderName,
  getProviderDefaultApiBase,
  normalizeProviderId,
  normalizeServiceProviderName,
} from "../shared/providers";
import type { ToolCallEvent } from "../components/ChatPanel/ToolCallSteps";

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export type Attachment = ChatAttachment;

export type MessageToolCalls = Record<string, ToolCallEvent[]>;

export type MessageBlock =
  | { type: "text"; content: string }
  | { type: "tool"; id: string };

export type MessageBlocks = Record<string, MessageBlock[]>;

interface ChatStore {
  sessions: SessionMeta[];
  activeSessionId: string | null;
  messages: ChatMessage[];
  toolCalls: MessageToolCalls;
  messageBlocks: MessageBlocks;
  streaming: boolean;
  settings: AgentSettings;
  ensureRuntimeReady: () => Promise<void>;
  loadSessions: () => Promise<void>;
  newSession: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  sendMessage: (content: string, attachments?: Attachment[]) => Promise<void>;
  cancelStream: () => void;
  loadSettings: () => Promise<void>;
  saveSettings: (partial: Partial<AgentSettings>) => Promise<void>;
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
  maxSteps: 20,
  shellCommandTimeoutMs: 300_000,
  planningMode: "balanced",
  thinkingEnabled: true,
  thinkingEffort: "high",
  circuitBreakerEnabled: true,
  circuitBreakerConsecutiveFailureLimit: 3,
  circuitBreakerRepeatedToolCallLimit: 3,
  circuitBreakerNoProgressLimit: 4,
  circuitBreakerMaxRuntimeMs: 600_000,
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
  const apiBase = (settings.apiBase?.trim() || getProviderDefaultApiBase(providerId)).replace(/\/+$/, "");
  return {
    ...settings,
    providerId,
    providerName: normalizeServiceProviderName(settings.providerName, apiBase, providerId) || getDefaultServiceProviderName(providerId),
    apiBase,
  };
}

type DesktopApi = {
  nexoDesktop: {
    getRuntimeInfo: () => Promise<{ webBaseUrl?: string }>;
    loadSettings: () => Promise<AgentSettings>;
    saveSettings: (settings: AgentSettings) => Promise<AgentSettings>;
    openExternal: (url: string) => Promise<void>;
  };
};

function getDesktopApi(): DesktopApi["nexoDesktop"] | null {
  return "nexoDesktop" in window
    ? (window as unknown as DesktopApi).nexoDesktop
    : null;
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
    streaming: false,
    settings: defaultSettings,
    cancelStream: () => {},
    ensureRuntimeReady,

    loadSessions: async () => {
      await ensureRuntimeReady();
      const sessions = await apiGet<SessionMeta[]>("/api/sessions");
      set({ sessions });
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
      }));
    },

    selectSession: async (id) => {
      await ensureRuntimeReady();
      const messages = await apiGet<ChatMessage[]>(`/api/sessions/${id}/messages`);
      set({ activeSessionId: id, messages, toolCalls: {}, messageBlocks: {} });
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

    sendMessage: async (content, attachments) => {
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
      try {
        const response = await apiPost<{ requestId: string }>("/api/chat", {
          sessionId: activeSessionId,
          message: content,
          settings,
          attachments: attachments || [],
        });
        requestId = response.requestId;
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

      const appendToken = (token: string) => {
        full += token;
        set((state) => {
          const blocks = [...(state.messageBlocks[assistantId] ?? [])];
          const last = blocks[blocks.length - 1];
          if (last?.type === "text") {
            blocks[blocks.length - 1] = { type: "text", content: last.content + token };
          } else {
            blocks.push({ type: "text", content: token });
          }
          return {
            messages: state.messages.map((message) => (message.id === assistantId ? { ...message, content: full } : message)),
            messageBlocks: { ...state.messageBlocks, [assistantId]: blocks },
          };
        });
      };

      const cancel = subscribeStream(requestId, (event) => {
        if (event.type === "token") {
          appendToken(event.content as string);
          return;
        }

        if (event.type === "tool_call") {
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
              [assistantId]: [...(state.toolCalls[assistantId] ?? []), toolCall],
            },
            messageBlocks: {
              ...state.messageBlocks,
              [assistantId]: [...(state.messageBlocks[assistantId] ?? []), { type: "tool", id: toolCall.id }],
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
              [assistantId]: (state.toolCalls[assistantId] ?? []).map((toolCall) =>
                toolCall.id === event.id
                  ? { ...toolCall, output, elapsed, status: isError ? "error" : "done" }
                  : toolCall
              ),
            },
          }));
          return;
        }

        if (event.type === "done") {
          const status = String(event.status ?? "completed") as ChatMessage["status"];
          set((state) => ({
            streaming: false,
            cancelStream: () => {},
            messages: state.messages.map((message) =>
              message.id === assistantId ? { ...message, content: full || (event.content as string), status } : message
            ),
          }));
          void get().loadSessions();
          cancel();
          return;
        }

        if (event.type === "error") {
          set((state) => ({
            streaming: false,
            cancelStream: () => {},
            messages: state.messages.map((message) =>
              message.id === assistantId
                ? { ...message, content: formatAssistantError(String(event.message ?? "")), status: "failed" }
                : message
            ),
          }));
          cancel();
        }
      });

      set({
        cancelStream: () => {
          void apiPost<{ ok: boolean }>(`/api/chat/${requestId}/interrupt`, {}).catch(() => undefined);
          cancel();
          set((state) => ({
            streaming: false,
            cancelStream: () => {},
            messages: state.messages.map((message) =>
              message.id === assistantId && message.status === "sending"
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
