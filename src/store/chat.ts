import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type { AgentSettings, Attachment as ChatAttachment, ChatMessage } from "../shared/types";
import { apiGet, apiPost, apiDelete, apiPatch, getRuntimeApiBase, setRuntimeApiBase, subscribeStream } from "../services/api";
import { sanitizeApiKeyForSave } from "../shared/settings";
import { getProviderDefaultApiBase, getProviderName, normalizeProviderId } from "../shared/providers";
import type { ToolCallEvent } from "../components/ChatPanel/ToolCallSteps";

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export type Attachment = ChatAttachment;

// Per-message tool call tracking
export type MessageToolCalls = Record<string, ToolCallEvent[]>;

export type MessageBlock =
  | { type: "text"; content: string }
  | { type: "tool"; id: string };

export type MessageBlocks = Record<string, MessageBlock[]>;

interface ChatStore {
  sessions: SessionMeta[];
  activeSessionId: string | null;
  messages: ChatMessage[];
  toolCalls: MessageToolCalls; // keyed by assistant message id
  messageBlocks: MessageBlocks; // ordered segments for inline tool + text rendering
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
  providerName: getProviderName("openai-compatible"),
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
  return {
    ...settings,
    providerId,
    providerName: getProviderName(providerId),
    apiBase: (settings.apiBase?.trim() || getProviderDefaultApiBase(providerId)).replace(/\/+$/, ""),
  };
}

type DesktopApi = {
  nexoDesktop: {
    getRuntimeInfo: () => Promise<{ webBaseUrl?: string }>;
    loadSettings: () => Promise<AgentSettings>;
    saveSettings: (s: AgentSettings) => Promise<AgentSettings>;
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
    const s = await apiPost<SessionMeta>("/api/sessions", {});
    set((st) => ({ sessions: [s, ...st.sessions], activeSessionId: s.id, messages: [], toolCalls: {}, messageBlocks: {} }));
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
    const next = sessions.filter((s) => s.id !== id);
    const newActive = activeSessionId === id ? (next[0]?.id ?? null) : activeSessionId;
    set({ sessions: next, activeSessionId: newActive, messages: newActive === activeSessionId ? get().messages : [], toolCalls: {}, messageBlocks: {} });
    if (newActive && newActive !== activeSessionId) await get().selectSession(newActive);
  },

  renameSession: async (id, title) => {
    await ensureRuntimeReady();
    await apiPatch(`/api/sessions/${id}`, { title });
    set((st) => ({ sessions: st.sessions.map((s) => (s.id === id ? { ...s, title } : s)) }));
  },

  sendMessage: async (content, attachments) => {
    let { activeSessionId, settings } = get();
    if (!activeSessionId) {
      await get().newSession();
      activeSessionId = get().activeSessionId!;
    }

    const userMsg: ChatMessage = { id: uuid(), role: "user", content, createdAt: new Date().toISOString(), status: "completed", ...{ attachments: attachments || [] } };
    const assistantId = uuid();
    const assistantMsg: ChatMessage = { id: assistantId, role: "assistant", content: "", createdAt: new Date().toISOString(), status: "sending" };

    set((st) => ({ messages: [...st.messages, userMsg, assistantMsg], streaming: true }));

    let requestId: string;
    try {
      const response = await apiPost<{ requestId: string }>("/api/chat", {
        sessionId: activeSessionId, message: content, settings, attachments: attachments || [],
      });
      requestId = response.requestId;
    } catch (error) {
      set((st) => ({
        streaming: false,
        messages: st.messages.map((m) =>
            m.id === assistantId
            ? { ...m, content: formatAssistantError(error instanceof Error ? error.message : String(error)), status: "failed" }
            : m
        ),
      }));
      return;
    }

    // Track tool call start times for elapsed calculation
    const toolStartTimes: Record<string, number> = {};
    let full = "";

    const appendToken = (token: string) => {
      full += token;
      set((st) => {
        const blocks = [...(st.messageBlocks[assistantId] ?? [])];
        const last = blocks[blocks.length - 1];
        if (last?.type === "text") {
          blocks[blocks.length - 1] = { type: "text", content: last.content + token };
        } else {
          blocks.push({ type: "text", content: token });
        }
        return {
          messages: st.messages.map((m) => m.id === assistantId ? { ...m, content: full } : m),
          messageBlocks: { ...st.messageBlocks, [assistantId]: blocks },
        };
      });
    };

    const cancel = subscribeStream(requestId, (event) => {
      if (event.type === "token") {
        appendToken(event.content as string);
      } else if (event.type === "tool_call") {
        const tc: ToolCallEvent = {
          id: event.id as string,
          name: event.name as string,
          input: event.input,
          status: "running",
        };
        toolStartTimes[tc.id] = Date.now();
        set((st) => ({
          toolCalls: {
            ...st.toolCalls,
            [assistantId]: [...(st.toolCalls[assistantId] ?? []), tc],
          },
          messageBlocks: {
            ...st.messageBlocks,
            [assistantId]: [...(st.messageBlocks[assistantId] ?? []), { type: "tool", id: tc.id }],
          },
        }));
      } else if (event.type === "tool_result") {
        const output = String(event.output ?? "");
        const isError = output.trim().startsWith("Error:");
        const elapsed = toolStartTimes[event.id as string]
          ? (Date.now() - toolStartTimes[event.id as string]) / 1000
          : 0;
        set((st) => ({
          toolCalls: {
            ...st.toolCalls,
            [assistantId]: (st.toolCalls[assistantId] ?? []).map((tc) =>
              tc.id === event.id
                ? { ...tc, output, elapsed, status: isError ? "error" as const : "done" as const }
                : tc
            ),
          },
        }));
      } else if (event.type === "done") {
        const status = String(event.status ?? "completed") as ChatMessage["status"];
        set((st) => ({
          streaming: false,
          cancelStream: () => {},
          messages: st.messages.map((m) =>
            m.id === assistantId ? { ...m, content: full || (event.content as string), status } : m
          ),
        }));
        void get().loadSessions();
        cancel();
      } else if (event.type === "error") {
        set((st) => ({
          streaming: false,
          cancelStream: () => {},
          messages: st.messages.map((m) =>
            m.id === assistantId ? { ...m, content: formatAssistantError(String(event.message ?? "")), status: "failed" } : m
          ),
        }));
        cancel();
      }
    });
    set({
      cancelStream: () => {
        void apiPost<{ ok: boolean }>(`/api/chat/${requestId}/interrupt`, {}).catch(() => undefined);
        cancel();
        set((st) => ({
          streaming: false,
          cancelStream: () => {},
          messages: st.messages.map((m) => (
            m.id === assistantId && m.status === "sending"
              ? { ...m, content: m.content || "已停止当前运行。", status: "interrupted" }
              : m
          )),
        }));
      },
    });
  },

  loadSettings: async () => {
    const desktop = getDesktopApi();
    if (desktop) {
      await ensureRuntimeReady();
      const s = await desktop.loadSettings();
      const merged = normalizeSettingsShape({ ...defaultSettings, ...s });
      set({ settings: merged });
      await syncSettingsToServer(merged);
    } else {
      const stored = localStorage.getItem("nexo-settings");
      let merged = { ...defaultSettings } as AgentSettings;
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as AgentSettings;
          const hasApiKey = parsed.hasApiKey || Boolean(parsed.apiKey?.trim());
          merged = normalizeSettingsShape({ ...defaultSettings, ...parsed, apiKey: "", hasApiKey });
          set({ settings: merged });
        } catch { /* ignore */ }
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
      } catch { /* ignore */ }
      await syncSettingsToServer(merged);
    }
  },

  saveSettings: async (partial) => {
    await ensureRuntimeReady();
    const merged = { ...get().settings, ...partial };
    const payload = sanitizeApiKeyForSave(merged);
    const desktop = getDesktopApi();
    if (desktop) {
      const saved = await desktop.saveSettings(payload);
      const next = normalizeSettingsShape({ ...defaultSettings, ...saved });
      set({ settings: next });
      // IPC save already updates backend; also POST so web clients stay in sync.
      await syncSettingsToServer(next);
    } else {
      localStorage.setItem("nexo-settings", JSON.stringify(payload));
      const next = normalizeSettingsShape({
        ...defaultSettings,
        ...payload,
        hasApiKey: Boolean(payload.apiKey) || merged.hasApiKey,
      });
      set({ settings: next });
      await syncSettingsToServer(next);
    }
  },
  };
});
