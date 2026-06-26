import { ChatOpenAI, type ChatOpenAICallOptions } from "@langchain/openai";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { AIMessageChunk } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import {
  getDefaultServiceProviderName,
  normalizeServiceProviderName,
  providerConnectionAllowsEmptyApiKey,
  resolveProviderSdkApiKey,
} from "../../src/shared/providers";
import type { AgentSettings, ChatMessage } from "../../src/shared/types";
import { extractAndStore, recallMemory } from "../memory";
import { loadAttachmentContext } from "./attachments";
import { circuitBreakerInfoFromDecision, createAgentLoopCircuitBreaker } from "./agent-loop-circuit-breaker";
import { retrieveKnowledgeContext } from "./knowledge";
import { resolveMemoryEmbeddingSettings } from "./memory-embedding";
import { resolveAndPersistModelContextBudget, getEnabledModelCapabilitySummary } from "./model-profiles";
import { callChatCompletion, resolvePrimaryModelConfig, resolveThinkingRequestConfig } from "./model-runtime";
import { isRunInterrupted } from "./run-control";
import { pushEvent } from "./sse";
import { getWebSettings } from "./settings";
import { getEnabledSkillInstructions } from "./skills";
import { computePromptBudget, estimateMessagesTokens, estimateSectionTokens, estimateTokens, trimSectionsToBudget, truncateTextToTokenBudget } from "./token-budget";
import { getAllEnabledToolDefs, toLcTool } from "./tools/registry";
import type { ChatAttachment, Session, StreamEvent, ToolDef, ToolExecutionContext } from "./types";
import { decodeHtml, parseToolArgs, toErrorMessage } from "./utils";
import { getWorkspaceRoot } from "./workspace";
import { createSnapshot } from "./snapshot";
const MISSING_PRIMARY_MODEL_MESSAGE = "No primary model is configured. Go to Settings > Models, create a model, add an API key, and mark it as Primary.";
const MISSING_API_KEY_MESSAGE = "The current primary model does not have an API key configured. Add one in Settings > Models and try again.";
const LOOP_GUARD_FALLBACK_MESSAGE = "\n\nThis run entered a repeated loop, so I stopped here for now. The tool results gathered so far are still available. Send \"continue\" if you want me to keep working from the current results.";
const EMPTY_RESPONSE_FALLBACK_MESSAGE = "I did not produce a valid reply. Please try again, or review the model configuration and retry.";
const USER_INTERRUPTED_FALLBACK_MESSAGE = "Stopped the current run.";
const CONTEXT_COMPACTION_NOTICE = [
  "\u5df2\u63a5\u8fd1\u4e0a\u4e0b\u6587\u4e0a\u9650\uff0c\u6211\u5df2\u5c06\u8f83\u65e9\u7684\u5f53\u524d\u4f1a\u8bdd\u5185\u5bb9\u538b\u7f29\u6210\u6458\u8981\uff1b\u63a5\u4e0b\u6765\u4f1a\u7ee7\u7eed\u57fa\u4e8e\u538b\u7f29\u6458\u8981\u3001\u5f53\u524d\u4f1a\u8bdd\u5c3e\u90e8\u548c\u957f\u671f\u8bb0\u5fc6\u5de5\u4f5c\u3002",
  "",
  "---",
  "",
].join("\n");

function buildDoneEvent(
  requestId: string,
  event: Extract<StreamEvent, { type: "done" }>
): Extract<StreamEvent, { type: "done" }> {
  pushEvent(requestId, event);
  return event;
}

function interruptedContent(content: string) {
  return content.trim() ? content : USER_INTERRUPTED_FALLBACK_MESSAGE;
}

function formatCapabilitySummary(summary: Awaited<ReturnType<typeof getEnabledModelCapabilitySummary>>) {
  const lines = Object.entries(summary)
    .filter(([, profiles]) => profiles.length > 0)
    .map(([capability, profiles]) => `- ${capability}: ${profiles.join("; ")}`);
  return lines.length ? lines.join("\n") : "No specialist model profiles are configured.";
}

function buildOpenAIThinkingCallOptions(settings: AgentSettings, model: string): Partial<ChatOpenAICallOptions> {
  const thinking = resolveThinkingRequestConfig(settings, model);
  return thinking.openAIReasoningEffort
    ? { reasoningEffort: thinking.openAIReasoningEffort }
    : {};
}

function withSettingsAwareToolDefs(tools: ToolDef[], settings: AgentSettings): ToolDef[] {
  return tools.map((tool) => {
    if (tool.name === "shell_command") {
      const timeoutSec = Math.round((settings.shellCommandTimeoutMs ?? 300_000) / 1000);
      return {
        ...tool,
        description: [
          tool.description,
          `Default cwd when omitted: ${getWorkspaceRoot(settings)}.`,
          `Configured default timeout: ${timeoutSec}s (${settings.shellCommandTimeoutMs ?? 300_000}ms).`,
          "Omit timeoutMs to use that default.",
          "Never run broad recursive scans from drive or system roots (for example Get-ChildItem C:\\\\ -Recurse, find /, or du -sh /) unless the user explicitly asks and you can narrow the path and depth.",
          "Prefer targeted directory listings in the relevant project path with a small depth limit instead of full-disk enumeration.",
          "Git is allowed for inspection and normal workflows, but do not run commands that discard uncommitted work, such as git checkout --, git restore, git reset --hard, or git clean, unless the user explicitly asks to restore, reset, discard, or clean those changes.",
          "When repairing generated file corruption, preserve unrelated user changes and use targeted edits instead of restoring whole files.",
          "Never run vite/webpack/npm run dev via shell_command. Use build or ask the user to start the dev server.",
        ].join(" "),
      };
    }
    if (tool.name === "invoke_model") {
      return {
        ...tool,
        description: [
          tool.description,
          'Use capability="vision" for image analysis, "image_generation" for text-to-image, "image_editing" for image edits, "speech_to_text" for transcription, and "text_to_speech" for spoken audio generation.',
        ].join(" "),
      };
    }
    return tool;
  });
}

function summarizeTerminalToolOutput(name: string, output: string) {
  void name;
  void output;
  return "";
}

type BufferedToolCall = {
  key: string;
  id: string;
  name: string;
  args: string;
  index?: number;
};

const DSML_TAG = String.raw`(?:\|\|DSML\|\||\uFF5C\uFF5CDSML\uFF5C\uFF5C|\uFFE5\u7CEFDSML\uFFE5\u7CEF|\u95FF\u6FE1\u7CA3\u7F0D\u64E0SML\u95FF\u6FE1\u7CA3\u7F0D?)`;
const DSML_TOOL_BLOCK_RE = new RegExp(String.raw`<\s*${DSML_TAG}tool_calls\s*>([\s\S]*?)<\/\s*${DSML_TAG}tool_calls\s*>`, "g");
const DSML_TOOL_START_RE = new RegExp(String.raw`<\s*${DSML_TAG}tool_calls\s*>`);
const DSML_INVOKE_RE = new RegExp(String.raw`<\s*${DSML_TAG}invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/\s*${DSML_TAG}invoke\s*>`, "g");
const DSML_PARAMETER_RE = new RegExp(String.raw`<\s*${DSML_TAG}parameter\s+name="([^"]+)"(?:\s+string="([^"]+)")?\s*>([\s\S]*?)<\/\s*${DSML_TAG}parameter\s*>`, "g");
const DSML_ANY_TAG_RE = new RegExp(String.raw`<\/?\s*${DSML_TAG}(?:tool_calls|invoke|parameter)\b[^>]*>`, "g");
const DSML_OPENING_PREFIXES = [
  "<||dsml||tool_calls",
  "<｜｜dsml｜｜tool_calls",
  "<锝滐綔dsml锝滐綔tool_calls",
  "<閿濇粣缍擠sml閿濇粣缍攟tool_calls",
  "<閿濇粣缍擠sml閿濇粣缍tool_calls",
];

function stripDsmlArtifacts(content: string) {
  let visibleText = content;
  DSML_TOOL_BLOCK_RE.lastIndex = 0;
  visibleText = visibleText.replace(DSML_TOOL_BLOCK_RE, "");

  const danglingStart = visibleText.search(DSML_TOOL_START_RE);
  if (danglingStart >= 0) {
    visibleText = visibleText.slice(0, danglingStart);
  }

  DSML_ANY_TAG_RE.lastIndex = 0;
  visibleText = visibleText.replace(DSML_ANY_TAG_RE, "");
  return visibleText;
}

function coerceDsmlParameter(value: string, stringAttr?: string) {
  const decoded = decodeHtml(value).trim();
  if (stringAttr === "true") return decoded;
  if (/^(true|false)$/i.test(decoded)) return decoded.toLowerCase() === "true";
  if (/^-?\d+(?:\.\d+)?$/.test(decoded)) return Number(decoded);
  if (/^[\[{"]/.test(decoded)) {
    try {
      return JSON.parse(decoded) as unknown;
    } catch {
      return decoded;
    }
  }
  return decoded;
}

function parseDsmlToolCalls(content: string): { visibleText: string; calls: BufferedToolCall[] } {
  const calls: BufferedToolCall[] = [];
  let visibleText = "";
  let cursor = 0;
  DSML_TOOL_BLOCK_RE.lastIndex = 0;

  for (const blockMatch of content.matchAll(DSML_TOOL_BLOCK_RE)) {
    visibleText += content.slice(cursor, blockMatch.index);
    cursor = (blockMatch.index ?? 0) + blockMatch[0].length;
    const block = blockMatch[1] ?? "";
    DSML_INVOKE_RE.lastIndex = 0;
    for (const invokeMatch of block.matchAll(DSML_INVOKE_RE)) {
      const name = invokeMatch[1]?.trim() ?? "";
      const body = invokeMatch[2] ?? "";
      const args: Record<string, unknown> = {};
      DSML_PARAMETER_RE.lastIndex = 0;
      for (const paramMatch of body.matchAll(DSML_PARAMETER_RE)) {
        const paramName = paramMatch[1]?.trim();
        if (!paramName) continue;
        args[paramName] = coerceDsmlParameter(paramMatch[3] ?? "", paramMatch[2]);
      }
      if (name) {
        const id = `dsml_${Date.now()}_${calls.length}`;
        calls.push({ key: id, id, name, args: JSON.stringify(args) });
      }
    }
  }

  visibleText += content.slice(cursor);
  return { visibleText: stripDsmlArtifacts(visibleText), calls };
}

function normalizePotentialDsmlStart(value: string) {
  return value.replace(/^<\s*/, "<").toLowerCase();
}

function isPotentialDsmlStart(value: string) {
  const normalized = normalizePotentialDsmlStart(value);
  if (normalized === "<") return true;
  return DSML_OPENING_PREFIXES.some((opening) => opening.startsWith(normalized) || normalized.startsWith(opening));
}

function findPotentialDsmlStart(value: string) {
  let index = value.indexOf("<");
  while (index >= 0) {
    if (isPotentialDsmlStart(value.slice(index))) return index;
    index = value.indexOf("<", index + 1);
  }
  return -1;
}

function shouldDropDanglingDsml(value: string) {
  const normalized = normalizePotentialDsmlStart(value);
  return normalized.includes("dsml") || DSML_OPENING_PREFIXES.some((opening) => normalized.startsWith(opening));
}

function createDsmlStreamBuffer() {
  let pending = "";

  const drain = (flush: boolean): { visibleText: string; calls: BufferedToolCall[] } => {
    let visibleText = "";
    const calls: BufferedToolCall[] = [];

    while (pending) {
      DSML_TOOL_BLOCK_RE.lastIndex = 0;
      const blockMatch = DSML_TOOL_BLOCK_RE.exec(pending);
      if (blockMatch) {
        visibleText += pending.slice(0, blockMatch.index);
        calls.push(...parseDsmlToolCalls(blockMatch[0]).calls);
        pending = pending.slice(blockMatch.index + blockMatch[0].length);
        continue;
      }

      const potentialStart = findPotentialDsmlStart(pending);
      if (potentialStart >= 0) {
        visibleText += pending.slice(0, potentialStart);
        const held = pending.slice(potentialStart);
        if (flush) {
          if (!shouldDropDanglingDsml(held)) {
            visibleText += held;
          }
          pending = "";
        } else {
          pending = held;
        }
        break;
      }

      visibleText += pending;
      pending = "";
    }

    return { visibleText: stripDsmlArtifacts(visibleText), calls };
  };

  return {
    push(token: string) {
      pending += token;
      return drain(false);
    },
    flush() {
      return drain(true);
    },
  };
}

function normalizePositiveInteger(value: number | undefined, fallback: number, min = 1) {
  const normalized = Math.floor(Number(value));
  return Number.isFinite(normalized) ? Math.max(min, normalized) : fallback;
}

function trimForPrompt(text: string, maxChars: number) {
  const clean = text.replace(/\s+\n/g, "\n").trim();
  if (clean.length <= maxChars) return clean;
  const half = Math.floor((maxChars - 32) / 2);
  return `${clean.slice(0, half)}\n...[truncated]...\n${clean.slice(-half)}`;
}

function formatMessageForCompaction(message: ChatMessage, index: number) {
  const role = message.role === "assistant" ? "Assistant" : "User";
  const attachmentText = message.attachments?.length
    ? `\nAttachments: ${message.attachments.map((attachment) => `${attachment.name} (${attachment.type}, ${attachment.url})`).join("; ")}`
    : "";
  return `#${index + 1} ${role} at ${message.createdAt}\n${trimForPrompt(message.content, 2400)}${attachmentText}`;
}

function buildCompactionTranscript(messages: ChatMessage[], maxChars = 28_000) {
  const entries = messages.map(formatMessageForCompaction);
  const selected: string[] = [];
  let used = 0;

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    const nextUsed = used + entry.length + 2;
    if (selected.length > 0 && nextUsed > maxChars) break;
    selected.unshift(entry);
    used = nextUsed;
  }

  if (selected.length < entries.length) {
    selected.unshift(`[${entries.length - selected.length} earlier message(s) were omitted before compaction because the transcript was very large.]`);
  }

  return selected.join("\n\n");
}

function formatCurrentSessionContextForRecall(session: Session, maxChars = 28_000) {
  const conversationMessages = session.messages.filter((message) => message.role !== "system");
  const transcript = buildCompactionTranscript(conversationMessages, maxChars);
  return [
    session.threadSummary?.trim()
      ? `Compressed earlier current-session context:\n${session.threadSummary.trim()}`
      : "",
    transcript
      ? `Current-session transcript:\n${transcript}`
      : "",
  ].filter(Boolean).join("\n\n");
}

function fallbackCompactMessages(messages: ChatMessage[]) {
  const transcript = buildCompactionTranscript(messages, 7000);
  return [
    "Automatic summary of earlier conversation:",
    trimForPrompt(transcript, 4000),
  ].join("\n");
}

async function compactOlderMessages(messages: ChatMessage[], summarize: (transcript: string) => Promise<string>) {
  if (messages.length === 0) return "";

  try {
    const transcript = buildCompactionTranscript(messages);
    const content = await summarize(transcript);
    return content || fallbackCompactMessages(messages);
  } catch {
    return fallbackCompactMessages(messages);
  }
}

function formatAuxiliarySection(title: string, content: string) {
  if (!content.trim()) return "";
  return `${title}:\n${content.trim()}`;
}

function mergeMemoryContext(...contexts: string[]) {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const context of contexts) {
    for (const line of context.split(/\r?\n/)) {
      const normalized = line.trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      lines.push(normalized);
    }
  }
  return lines.join("\n");
}

async function buildBudgetAwareConversationContext(
  settings: AgentSettings,
  session: Session,
  summarize: (transcript: string) => Promise<string>,
  baseSections: Array<{ key: string; label: string; content: string }>,
  budgetConfig: ReturnType<typeof computePromptBudget>
) {
  const conversationMessages = session.messages.filter((message) => message.role !== "system");
  const recentWindow = normalizePositiveInteger(settings.maxContextTurns, 12);
  let recentMessages = [...conversationMessages];
  let olderMessages: ChatMessage[] = [];
  let threadSummary = session.threadSummary?.trim() ?? "";
  let compacted = false;
  let passes = 0;

  const estimateBase = () => baseSections.reduce((sum, section) => sum + estimateSectionTokens(section.label, section.content), 0);
  const estimateSummary = () => estimateSectionTokens("Earlier conversation summary", threadSummary);
  const estimateRecent = () => estimateMessagesTokens(recentMessages);
  const estimateTotal = () => estimateBase() + estimateSummary() + estimateRecent();

  while (
    settings.enableContextCompaction
    && estimateTotal() >= budgetConfig.autoCompactTokenLimit
    && passes < 4
  ) {
    const targetRawTurns = Math.max(2, Math.min(recentWindow, Math.floor(recentMessages.length / 2)));
    olderMessages = recentMessages.slice(0, Math.max(0, recentMessages.length - targetRawTurns));
    const summaryInput = olderMessages.length > 0 ? olderMessages : recentMessages.slice(0, Math.max(0, recentMessages.length - 2));
    if (!summaryInput.length) break;

    const nextSummary = await compactOlderMessages(summaryInput, summarize);
    threadSummary = [threadSummary, nextSummary].filter(Boolean).join("\n\n");
    compacted = true;
    passes += 1;
    recentMessages = recentMessages.slice(-Math.max(2, Math.min(recentWindow, recentMessages.length - summaryInput.length)));
    olderMessages = [];

    while (estimateTotal() > budgetConfig.compactionTargetTokens && recentMessages.length > 2) {
      const shifted = recentMessages.shift();
      if (!shifted) break;
      const fragment = await compactOlderMessages([shifted], summarize);
      threadSummary = [threadSummary, fragment].filter(Boolean).join("\n\n");
      compacted = true;
    }

    if (estimateTokens(threadSummary) > Math.max(512, Math.floor(budgetConfig.maxInputTokens * 0.35))) {
      threadSummary = truncateTextToTokenBudget(threadSummary, Math.max(512, Math.floor(budgetConfig.maxInputTokens * 0.3)));
    }
  }

  if (threadSummary && estimateTotal() > budgetConfig.maxInputTokens) {
    threadSummary = truncateTextToTokenBudget(threadSummary, Math.max(384, Math.floor(budgetConfig.compactionTargetTokens * 0.35)));
  }

  session.threadSummary = threadSummary || undefined;
  if (threadSummary) {
    session.threadSummaryUpdatedAt = new Date().toISOString();
    session.threadSummaryVersion = (session.threadSummaryVersion ?? 0) + (compacted ? 1 : 0);
  }

  return {
    compactedSummary: threadSummary,
    estimatedPromptTokens: estimateTotal(),
    compacted,
    recentRawMessages: recentMessages,
    messages: recentMessages.map((message) =>
      message.role === "user" ? new HumanMessage(message.content) : new AIMessage(message.content)
    ),
  };
}

export async function streamFromLLM(
  settings: AgentSettings,
  session: Session,
  requestId: string,
  storedApiKey: string,
  attachments: ChatAttachment[] = [],
  turnId: string = "",
): Promise<Extract<StreamEvent, { type: "done" }>> {
  const messages = session.messages;
  const webSettings = getWebSettings();
  const fallbackApiKey = settings.apiKey || storedApiKey || webSettings.apiKey || "";
  const fallbackApiBase = (settings.apiBase || webSettings.apiBase || "https://api.openai.com/v1").replace(/\/+$/, "");
  const fallbackModel = settings.model || webSettings.model || "gpt-4o-mini";
  const primaryConfig = await resolvePrimaryModelConfig(
    { ...settings, apiBase: fallbackApiBase, model: fallbackModel, apiKey: fallbackApiKey },
    fallbackApiKey
  );
  const effectiveApiKey = primaryConfig.apiKey || fallbackApiKey;
  const apiBase = primaryConfig.apiBase;
  const allowsEmptyPrimaryApiKey = providerConnectionAllowsEmptyApiKey({
    providerId: primaryConfig.providerId,
    providerName: settings.providerName,
    apiBase,
  });

  if (!primaryConfig.model.trim()) {
    return buildDoneEvent(requestId, {
      type: "done",
      content: MISSING_PRIMARY_MODEL_MESSAGE,
      status: "failed",
      stopReason: "precondition_failed",
    });
  }

  if (!effectiveApiKey && !allowsEmptyPrimaryApiKey) {
    return buildDoneEvent(requestId, {
      type: "done",
      content: primaryConfig.name === "default" ? MISSING_PRIMARY_MODEL_MESSAGE : MISSING_API_KEY_MESSAGE,
      status: "failed",
      stopReason: "precondition_failed",
    });
  }

  const model = primaryConfig.model;
  const thinkingConfig = resolveThinkingRequestConfig(settings, model, {
    thinkingEnabled: primaryConfig.thinkingEnabled,
    thinkingEffort: primaryConfig.thinkingEffort,
  });
  const openAiThinkingOptions = buildOpenAIThinkingCallOptions(
    {
      ...settings,
      thinkingEnabled: primaryConfig.thinkingEnabled ?? settings.thinkingEnabled,
      thinkingEffort: primaryConfig.thinkingEffort ?? settings.thinkingEffort,
    },
    model,
  );
  const capabilitySummary = await getEnabledModelCapabilitySummary();
  const skillInstructions = await getEnabledSkillInstructions();
  const enabledToolDefs = withSettingsAwareToolDefs(await getAllEnabledToolDefs(), settings);
  const resolvedBudget = await resolveAndPersistModelContextBudget({
    providerId: primaryConfig.providerId,
    model: primaryConfig.model,
    contextWindowTokens: primaryConfig.contextWindowTokens,
    reservedOutputTokens: primaryConfig.reservedOutputTokens,
    autoCompactTokenLimit: primaryConfig.autoCompactTokenLimit,
    compactionTargetRatio: primaryConfig.compactionTargetRatio,
    contextWindowSource: primaryConfig.contextWindowSource as AgentSettings["contextWindowSource"],
    contextWindowSourceDetail: primaryConfig.contextWindowSourceDetail,
    contextWindowResolvedAt: primaryConfig.contextWindowResolvedAt,
  });
  const budgetConfig = computePromptBudget(settings, resolvedBudget, Math.max(512, enabledToolDefs.length * 180));

  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const currentSessionContext = formatCurrentSessionContextForRecall(session);
  const currentSessionMemoryQuery = [
    "Current user message:",
    lastUserMsg,
    "Current-session context, authoritative for resolving omitted references and current targets:",
    currentSessionContext,
  ].filter((part) => part.trim()).join("\n\n");
  const memoryEmbeddingSettings = await resolveMemoryEmbeddingSettings({
    providerId: primaryConfig.providerId,
    providerName: settings.providerName,
    apiKey: effectiveApiKey,
    apiBase,
    model: primaryConfig.model,
    temperature: primaryConfig.temperature,
  });
  let memoryContext = "";
  if (settings.enableMemory) {
    const operationalMemoryQuery = [
      currentSessionMemoryQuery || lastUserMsg,
      "project path workspace root cwd repository location repo folder client admin management console conventions user preferences",
      "项目路径 工作区 根目录 当前项目 仓库 管理端 客户端 项目规范 用户偏好",
    ].join("\n");
    const [taskMemoryContext, operationalMemoryContext] = await Promise.all([
      recallMemory(currentSessionMemoryQuery || lastUserMsg, memoryEmbeddingSettings, undefined, 6),
      recallMemory(operationalMemoryQuery, memoryEmbeddingSettings, undefined, 6),
    ]);
    memoryContext = mergeMemoryContext(taskMemoryContext, operationalMemoryContext);
  }
  const knowledgeContext = settings.enableKnowledge
    ? await retrieveKnowledgeContext(currentSessionMemoryQuery || lastUserMsg, memoryEmbeddingSettings)
    : "";
  const attachmentContext = await loadAttachmentContext(attachments);

  const trimmedAuxiliarySections = trimSectionsToBudget([
    { key: "skills", label: "Enabled skills", content: skillInstructions || "", minTokens: 128 },
    { key: "memory", label: "Relevant memories about the user", content: memoryContext || "", minTokens: 160 },
    { key: "knowledge", label: "Relevant knowledge base notes", content: knowledgeContext || "", minTokens: 160 },
    { key: "attachments", label: "Current user attachments", content: attachmentContext || "", minTokens: 128 },
  ], Math.max(512, Math.floor(budgetConfig.maxInputTokens * 0.28)));

  const auxiliaryPrompt = trimmedAuxiliarySections
    .map((section) => formatAuxiliarySection(section.label, section.content))
    .filter(Boolean)
    .join("\n\n");

  const systemPrompt = [
    "You are Nexo Agent, a helpful AI assistant.",
    "Answer in the user's language. Be concise and action-oriented.",
    `Planning mode: ${settings.planningMode}.`,
    "If a tool loop starts repeating the same visible response without producing fresh progress, stop calling tools and give the best final answer from the current results.",
    `Default shell_command cwd when omitted: ${getWorkspaceRoot(settings)}.`,
    "Context priority: current user message and the current session transcript are authoritative for resolving omitted references, targets, surfaces, and project context. Current-session compressed summaries come next. Recalled memories, knowledge notes, and skills are background only; ignore them whenever they conflict with or would change the target implied by the current session.",
    "When the current session established a target such as admin, client, server, management console, or a specific page, keep using that target for follow-up requests unless the user explicitly switches it.",
    "Use tools when they are helpful.",
    "Never write DSML/XML-like tool call tags in the user-visible response. Use the provided tool-calling interface only.",
    "Use shell_command for terminal tasks, filesystem inspection, and command-line workflows.",
    "Never run broad recursive filesystem scans from drive or system roots (for example Get-ChildItem C:\\\\ -Recurse, find /, du -sh /, or tree from C:\\\\ or /) unless the user explicitly requests it and you can narrow the target path and depth.",
    "Prefer targeted listings in the relevant project or workspace directory with a small depth limit instead of full-disk enumeration.",
    "Before setting shell_command.cwd for a known external project, prefer recalled project paths from memory; if the path is missing or stale, verify nearby candidate directories with a narrow listing.",
    "Git may be used for status, diff, log, branch, add, commit, and other non-destructive workflows. Do not run commands that discard uncommitted changes, including git checkout --, git restore, git reset --hard, or git clean, unless the user explicitly asks to restore, reset, discard, or clean those changes.",
    "Before changing files in a dirty worktree, inspect relevant diffs and preserve user edits. To fix generated corruption, apply the smallest targeted patch instead of restoring whole files.",
    "For shell_command: omit timeoutMs to use the configured default script timeout (Settings). Do not pass timeoutMs: 6000 or other short values for npm install, build, or dev commands.",
    "Never use shell_command to start vite, webpack, or npm run dev because those processes do not exit and will block until timeout.",
    `Primary model: ${primaryConfig.name} / ${primaryConfig.model}.`,
    `Resolved context budget: window=${budgetConfig.contextWindowTokens}, input=${budgetConfig.maxInputTokens}, compact=${budgetConfig.autoCompactTokenLimit}, source=${resolvedBudget.contextWindowSource ?? "default"}.`,
    "You are the orchestrator. Route specialist work by capability instead of asking the user for a model name.",
    'Use invoke_model with capability="vision" for image analysis, capability="image_generation" for text-to-image, capability="image_editing" for editing existing images, capability="speech_to_text" for transcription, and capability="text_to_speech" for spoken audio generation.',
    "Use invoke_model with a capability when a configured specialist model is better suited for a sub-task.",
    "Use recall_memory when prior durable context could materially improve the answer.",
    `Configured specialist capabilities:\n${formatCapabilitySummary(capabilitySummary)}`,
    ...(auxiliaryPrompt ? [auxiliaryPrompt] : []),
  ].join("\n");

  const summarizeOlderContext = async (transcript: string) => {
    const summaryInstruction = [
      "Summarize the earlier conversation so a new model call can continue with less context.",
      "Preserve user preferences, project constraints, decisions already made, pending tasks, file paths, commands, tool results, errors, attempts, and unfinished work.",
      "Do not invent details. Keep the summary concise but operational.",
    ].join("\n");

    if (primaryConfig.providerId === "anthropic-compatible") {
      const result = await callChatCompletion(primaryConfig, [
        { role: "system", content: summaryInstruction },
        { role: "user", content: transcript },
      ], { temperature: 0, maxTokens: 900 });
      return result.content;
    }

    const summaryLlm = new ChatOpenAI({
      apiKey: resolveProviderSdkApiKey(effectiveApiKey, {
        providerId: primaryConfig.providerId,
        providerName: settings.providerName,
        apiBase,
      }),
      model,
      temperature: 0,
      configuration: { baseURL: apiBase },
    });
    const response = await summaryLlm.invoke([
      new SystemMessage(summaryInstruction),
      new HumanMessage(transcript),
    ]);
    return typeof response.content === "string" ? response.content.trim() : JSON.stringify(response.content);
  };

  const conversationContext = await buildBudgetAwareConversationContext(
    settings,
    session,
    summarizeOlderContext,
    [
      { key: "system", label: "System prompt", content: systemPrompt },
      ...trimmedAuxiliarySections.map((section) => ({ key: section.key, label: section.label, content: section.content })),
    ],
    budgetConfig
  );

  const lcMessages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    ...(conversationContext.compactedSummary
      ? [new SystemMessage(`Earlier conversation summary from automatic context compaction:\n${conversationContext.compactedSummary}`)]
      : []),
    ...conversationContext.messages,
  ];
  let turnSnapshotCreated = false;
  const compactionNotice = conversationContext.compacted ? CONTEXT_COMPACTION_NOTICE : "";
  if (compactionNotice) {
    pushEvent(requestId, { type: "token", content: compactionNotice });
  }

  if (primaryConfig.providerId === "anthropic-compatible") {
    try {
      const result = await callChatCompletion(primaryConfig, [
        { role: "system", content: systemPrompt },
        ...(conversationContext.compactedSummary
          ? [{ role: "system" as const, content: `Earlier conversation summary from automatic context compaction:\n${conversationContext.compactedSummary}` }]
          : []),
        ...conversationContext.recentRawMessages.map((message) => ({
          role: message.role === "assistant" ? "assistant" as const : "user" as const,
          content: message.content,
        })),
      ], {
        temperature: primaryConfig.temperature ?? settings.temperature ?? 0.4,
        maxTokens: resolvedBudget.reservedOutputTokens ?? 2048,
        thinking: thinkingConfig,
      });
      for (const char of result.content) {
        pushEvent(requestId, { type: "token", content: char });
      }
      const finalContent = `${compactionNotice}${result.content}`;
      const doneEvent: Extract<StreamEvent, { type: "done" }> = {
        type: "done",
        hasSnapshot: turnSnapshotCreated,
        content: finalContent,
        status: "completed",
        stopReason: "completed",
        usage: {
          promptTokens: result.usage?.prompt_tokens,
          completionTokens: result.usage?.completion_tokens,
        },
        contextBudget: {
          contextWindowTokens: budgetConfig.contextWindowTokens,
          maxInputTokens: budgetConfig.maxInputTokens,
          autoCompactTokenLimit: budgetConfig.autoCompactTokenLimit,
          estimatedPromptTokens: conversationContext.estimatedPromptTokens,
          source: resolvedBudget.contextWindowSource,
        },
      };
      return buildDoneEvent(requestId, doneEvent);
    } catch (error) {
      return buildDoneEvent(requestId, {
        type: "done",
        hasSnapshot: turnSnapshotCreated,
        content: toErrorMessage(error),
        status: "failed",
        stopReason: "runtime_error",
      });
    }
  }

  const llm = new ChatOpenAI({
    apiKey: resolveProviderSdkApiKey(effectiveApiKey, {
      providerId: primaryConfig.providerId,
      providerName: settings.providerName,
      apiBase,
    }),
    model,
    temperature: primaryConfig.temperature ?? settings.temperature ?? 0.4,
    configuration: { baseURL: apiBase },
    streaming: true,
  });

  const enabledToolMap = new Map(enabledToolDefs.map((tool) => [tool.name, tool]));
  const llmRunner = enabledToolDefs.length > 0
    ? llm.bindTools(enabledToolDefs.map(toLcTool), openAiThinkingOptions)
    : llm.withConfig(openAiThinkingOptions);
  const llmNoTools = llm.withConfig(openAiThinkingOptions);
  const toolCtx: ToolExecutionContext = {
    settings,
    apiKey: effectiveApiKey,
    apiBase,
    capabilitySummary,
  };

  let fullContent = compactionNotice;
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let interruptedByUser = false;
  let breakerInfo: ReturnType<typeof circuitBreakerInfoFromDecision> | undefined;
  const circuitBreaker = settings.circuitBreakerEnabled ? createAgentLoopCircuitBreaker(settings) : null;

  try {
    for (let step = 0; ; step++) {
      if (isRunInterrupted(requestId)) {
        interruptedByUser = true;
        break;
      }

      let turnContent = "";
      const toolCallBuffer: BufferedToolCall[] = [];
      const dsmlBuffer = createDsmlStreamBuffer();
      let terminalSummary = "";

      const stream = await llmRunner.stream(lcMessages);
      for await (const chunk of stream) {
        if (isRunInterrupted(requestId)) {
          interruptedByUser = true;
          await (stream as AsyncIterator<unknown> & { return?: () => Promise<IteratorResult<unknown>> }).return?.();
          break;
        }
        const c = chunk as AIMessageChunk;
        const token = typeof c.content === "string" ? c.content : "";
        if (token) {
          const dsmlChunk = dsmlBuffer.push(token);
          if (dsmlChunk.visibleText) {
            turnContent += dsmlChunk.visibleText;
            fullContent += dsmlChunk.visibleText;
            pushEvent(requestId, { type: "token", content: dsmlChunk.visibleText });
          }
          toolCallBuffer.push(...dsmlChunk.calls);
        }
        if (c.tool_call_chunks?.length) {
          for (const tc of c.tool_call_chunks) {
            const key = typeof tc.index === "number"
              ? `index:${tc.index}`
              : tc.id
                ? `id:${tc.id}`
                : `fallback:${toolCallBuffer.length}`;
            const existing = toolCallBuffer.find((b) => b.key === key || (tc.id && b.id === tc.id));
            if (existing) {
              existing.id = existing.id || tc.id || "";
              existing.name = existing.name || tc.name || "";
              existing.args += tc.args ?? "";
            } else {
              toolCallBuffer.push({
                key,
                id: tc.id ?? `call_${step}_${toolCallBuffer.length}`,
                name: tc.name ?? "",
                args: tc.args ?? "",
                index: tc.index,
              });
            }
          }
        }
        if (c.usage_metadata) {
          promptTokens = c.usage_metadata.input_tokens;
          completionTokens = c.usage_metadata.output_tokens;
        }
      }

      if (interruptedByUser) break;

      const finalDsmlChunk = dsmlBuffer.flush();
      if (finalDsmlChunk.visibleText) {
        turnContent += finalDsmlChunk.visibleText;
        fullContent += finalDsmlChunk.visibleText;
        pushEvent(requestId, { type: "token", content: finalDsmlChunk.visibleText });
      }
      toolCallBuffer.push(...finalDsmlChunk.calls);
      turnContent = stripDsmlArtifacts(turnContent);

      circuitBreaker?.recordModelTurn({
        step: step + 1,
        visibleText: turnContent,
        toolCalls: toolCallBuffer.map((tc) => ({ name: tc.name, args: parseToolArgs(tc.args) })),
        usage: { promptTokens, completionTokens },
      });

      if (toolCallBuffer.length === 0) break;

      const aiMsg = new AIMessage({
        content: turnContent,
        tool_calls: toolCallBuffer.map((tc) => ({
          id: tc.id,
          name: tc.name,
          args: parseToolArgs(tc.args),
          type: "tool_call" as const,
        })),
      });
      lcMessages.push(aiMsg);

      // Create snapshot before first tool execution in this turn
      if (!turnSnapshotCreated && turnId) {
        const workspaceRoot = getWorkspaceRoot(settings);
        const hasShellCmd = toolCallBuffer.some((tc) => tc.name === "shell_command");
        if (hasShellCmd && workspaceRoot) {
          const snapshot = await createSnapshot(session.id, turnId, workspaceRoot).catch(() => null);
          turnSnapshotCreated = Boolean(snapshot);
        }
      }
      for (const tc of toolCallBuffer) {
        if (isRunInterrupted(requestId)) {
          interruptedByUser = true;
          break;
        }
        const parsedArgs = parseToolArgs(tc.args);
        pushEvent(requestId, { type: "tool_call", id: tc.id, name: tc.name, input: parsedArgs });

        const toolFn = enabledToolMap.get(tc.name);
        const t0 = Date.now();
        let output: string;
        try {
          output = toolFn
            ? await toolFn.execute(parsedArgs, toolCtx)
            : `Tool is not enabled or unknown: ${tc.name}`;
        } catch (error) {
          output = `Error: ${toErrorMessage(error)}`;
        }
        const elapsed = (Date.now() - t0) / 1000;

        pushEvent(requestId, { type: "tool_result", id: tc.id, output: String(output), elapsed });
        circuitBreaker?.recordToolResult({
          name: tc.name,
          args: parsedArgs,
          output: String(output),
          elapsedSeconds: elapsed,
        });
        lcMessages.push(new ToolMessage({
          content: truncateTextToTokenBudget(String(output), Math.max(128, Math.floor(budgetConfig.maxInputTokens * 0.08))),
          tool_call_id: tc.id,
        }));

        const summary = summarizeTerminalToolOutput(tc.name, String(output));
        if (summary) {
          terminalSummary = summary;
        }
      }

      if (interruptedByUser) break;

      if (terminalSummary) {
        const finalToken = `\n\n${terminalSummary}`;
        fullContent += finalToken;
        pushEvent(requestId, { type: "token", content: finalToken });
        break;
      }

      const decision = circuitBreaker?.evaluate();
      if (decision?.action === "stop") {
        breakerInfo = circuitBreakerInfoFromDecision(decision);
        break;
      }
    }

    if (!interruptedByUser && breakerInfo) {
      const finalStream = await llmNoTools.stream([
        ...lcMessages,
        new SystemMessage(
          breakerInfo
            ? `The run was stopped by the circuit breaker (${breakerInfo.reason}: ${breakerInfo.detail}). Do not call tools. Based on the available tool results, give the user a concise final response in their language. If work is incomplete, say exactly what remains.`
            : "Do not call tools. Based on the available tool results, give the user a concise final response in their language. If work is incomplete, say exactly what remains."
        ),
      ]);
      let finalContent = "";
      const finalDsmlBuffer = createDsmlStreamBuffer();
      for await (const chunk of finalStream) {
        if (isRunInterrupted(requestId)) {
          interruptedByUser = true;
          await (finalStream as AsyncIterator<unknown> & { return?: () => Promise<IteratorResult<unknown>> }).return?.();
          break;
        }
        const c = chunk as AIMessageChunk;
        const token = typeof c.content === "string" ? c.content : "";
        if (token) {
          const dsmlChunk = finalDsmlBuffer.push(token);
          if (dsmlChunk.visibleText) {
            finalContent += dsmlChunk.visibleText;
            fullContent += dsmlChunk.visibleText;
            pushEvent(requestId, { type: "token", content: dsmlChunk.visibleText });
          }
        }
        if (c.usage_metadata) {
          promptTokens = c.usage_metadata.input_tokens;
          completionTokens = c.usage_metadata.output_tokens;
        }
      }
      if (!interruptedByUser) {
        const finalDsmlChunk = finalDsmlBuffer.flush();
        if (finalDsmlChunk.visibleText) {
          finalContent += finalDsmlChunk.visibleText;
          fullContent += finalDsmlChunk.visibleText;
          pushEvent(requestId, { type: "token", content: finalDsmlChunk.visibleText });
        }
        finalContent = stripDsmlArtifacts(finalContent);
        if (!finalContent.trim()) {
          fullContent += LOOP_GUARD_FALLBACK_MESSAGE;
          pushEvent(requestId, { type: "token", content: LOOP_GUARD_FALLBACK_MESSAGE });
        }
      }
    }
  } catch (error) {
    return buildDoneEvent(requestId, {
      type: "done",
      hasSnapshot: turnSnapshotCreated,
      content: interruptedByUser || isRunInterrupted(requestId) ? interruptedContent(fullContent) : toErrorMessage(error),
      status: interruptedByUser || isRunInterrupted(requestId) ? "interrupted" : "failed",
      stopReason: interruptedByUser || isRunInterrupted(requestId) ? "user_interrupt" : "runtime_error",
    });
  }

  const doneEvent: Extract<StreamEvent, { type: "done" }> = {
    type: "done",
    hasSnapshot: turnSnapshotCreated,
    content: interruptedByUser
      ? interruptedContent(fullContent)
      : fullContent || EMPTY_RESPONSE_FALLBACK_MESSAGE,
    status: interruptedByUser
      ? "interrupted"
      : breakerInfo
        ? "needs_input"
        : "completed",
    usage: { promptTokens, completionTokens },
    ...(interruptedByUser
      ? { stopReason: "user_interrupt" as const }
      : breakerInfo
        ? { stopReason: "circuit_breaker" as const, circuitBreaker: breakerInfo }
        : { stopReason: "completed" as const }),
    contextBudget: {
      contextWindowTokens: budgetConfig.contextWindowTokens,
      maxInputTokens: budgetConfig.maxInputTokens,
      autoCompactTokenLimit: budgetConfig.autoCompactTokenLimit,
      estimatedPromptTokens: conversationContext.estimatedPromptTokens,
      source: resolvedBudget.contextWindowSource,
    },
  };
  return buildDoneEvent(requestId, doneEvent);
}

export async function extractMemoryAfterChat(
  userMessage: string,
  assistantContent: string,
  sessionId: string,
  settings: AgentSettings,
  storedApiKey: string
) {
  const webSettings = getWebSettings();
  const fallbackApiKey = settings.apiKey || storedApiKey || webSettings.apiKey || "";
  const fallbackApiBase = (settings.apiBase || webSettings.apiBase || "https://api.openai.com/v1").replace(/\/+$/, "");
  const fallbackModel = settings.model || webSettings.model || "gpt-4o-mini";
  const primaryConfig = await resolvePrimaryModelConfig(
    { ...settings, apiBase: fallbackApiBase, model: fallbackModel, apiKey: fallbackApiKey },
    fallbackApiKey
  );
  const embeddingProviderName = normalizeServiceProviderName("", primaryConfig.apiBase, primaryConfig.providerId)
    || normalizeServiceProviderName(settings.providerName, primaryConfig.apiBase, primaryConfig.providerId)
    || getDefaultServiceProviderName(primaryConfig.providerId);
  const memoryEmbeddingSettings = await resolveMemoryEmbeddingSettings({
    providerId: primaryConfig.providerId,
    providerName: embeddingProviderName,
    apiKey: primaryConfig.apiKey || fallbackApiKey,
    apiBase: primaryConfig.apiBase,
    model: primaryConfig.model,
    temperature: primaryConfig.temperature,
  });

  const durableMemoryInstruction = [
    "Extract only durable memory candidates.",
    "Prefer stable preferences, recurring workflows, project conventions, and long-lived facts.",
    "Exclude temporary debugging details, one-off command output, transient file paths, and task-local dead ends.",
  ].join("\n");

  await extractAndStore(
    userMessage,
    assistantContent,
    sessionId,
    primaryConfig.apiKey || fallbackApiKey,
    primaryConfig.apiBase,
    async (prompt) => {
      if (primaryConfig.providerId === "anthropic-compatible") {
        const res = await callChatCompletion(primaryConfig, [
          { role: "system", content: durableMemoryInstruction },
          { role: "user", content: prompt },
        ], { temperature: 0, maxTokens: 800 });
        return res.content;
      }

      const llm = new ChatOpenAI({
        apiKey: resolveProviderSdkApiKey(primaryConfig.apiKey || fallbackApiKey, {
          providerId: primaryConfig.providerId,
          providerName: settings.providerName,
          apiBase: primaryConfig.apiBase,
        }),
        model: primaryConfig.model,
        temperature: 0,
        configuration: { baseURL: primaryConfig.apiBase },
      });
      const res = await llm.invoke([
        new SystemMessage(durableMemoryInstruction),
        new HumanMessage(prompt),
      ]);
      return typeof res.content === "string" ? res.content : "";
    },
    {
      model: primaryConfig.model,
      embeddingSettings: memoryEmbeddingSettings,
    }
  );
}
