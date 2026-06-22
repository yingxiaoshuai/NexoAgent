import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { AIMessageChunk } from "@langchain/core/messages";
import type { AgentSettings, ChatMessage } from "../../src/shared/types";
import { extractAndStore, recallMemory } from "../memory";
import { loadAttachmentContext } from "./attachments";
import { circuitBreakerInfoFromDecision, createAgentLoopCircuitBreaker } from "./agent-loop-circuit-breaker";
import { retrieveKnowledgeContext } from "./knowledge";
import { resolveAndPersistModelContextBudget, getEnabledModelCapabilitySummary } from "./model-profiles";
import { callChatCompletion, resolvePrimaryModelConfig } from "./model-runtime";
import { pushEvent } from "./sse";
import { getWebSettings } from "./settings";
import { getEnabledSkillInstructions } from "./skills";
import { computePromptBudget, estimateMessagesTokens, estimateSectionTokens, estimateTokens, trimSectionsToBudget, truncateTextToTokenBudget } from "./token-budget";
import { getEnabledToolDefs, toLcTool } from "./tools/registry";
import type { ChatAttachment, Session, StreamEvent, ToolDef, ToolExecutionContext } from "./types";
import { decodeHtml, parseToolArgs, toErrorMessage } from "./utils";
import { getAllowedFileRoots, getWorkspaceRoot, isPathInsideWorkspace, workspaceBoundaryError } from "./workspace";

const FILE_TOOL_NAMES = new Set(["file_read", "file_write"]);
const MISSING_PRIMARY_MODEL_MESSAGE = "\u672a\u914d\u7f6e\u4e3b\u6a21\u578b\u3002\u8bf7\u5230 Settings > Models \u65b0\u589e\u4e00\u4e2a\u6a21\u578b\uff0c\u586b\u5199 API Key\uff0c\u5e76\u5c06\u5176\u8bbe\u4e3a Primary\u3002";
const MISSING_API_KEY_MESSAGE = "\u5f53\u524d\u4e3b\u6a21\u578b\u672a\u914d\u7f6e API Key\u3002\u8bf7\u5230 Settings > Models \u8865\u5145\u540e\u518d\u8bd5\u3002";
const MAX_STEPS_FALLBACK_MESSAGE = "\n\n\u5df2\u8fbe\u5230\u5de5\u5177\u8c03\u7528\u6b65\u6570\u4e0a\u9650\u3002\u6211\u5df2\u6267\u884c\u5b8c\u524d\u9762\u7684\u5de5\u5177\u6b65\u9aa4\uff0c\u4f46\u8fd8\u6ca1\u62ff\u5230\u6a21\u578b\u7684\u6700\u7ec8\u603b\u7ed3\u3002\u8bf7\u7ee7\u7eed\u53d1\u9001\u201c\u7ee7\u7eed\u201d\uff0c\u6211\u4f1a\u57fa\u4e8e\u5df2\u6709\u7ed3\u679c\u63a5\u7740\u5904\u7406\u3002";
const EMPTY_RESPONSE_FALLBACK_MESSAGE = "\u6211\u6ca1\u6709\u751f\u6210\u6709\u6548\u56de\u590d\u3002\u8bf7\u518d\u53d1\u4e00\u6b21\uff0c\u6216\u68c0\u67e5\u6a21\u578b\u914d\u7f6e\u540e\u91cd\u8bd5\u3002";

function formatCapabilitySummary(summary: Awaited<ReturnType<typeof getEnabledModelCapabilitySummary>>) {
  const lines = Object.entries(summary)
    .filter(([, profiles]) => profiles.length > 0)
    .map(([capability, profiles]) => `- ${capability}: ${profiles.join("; ")}`);
  return lines.length ? lines.join("\n") : "No specialist model profiles are configured.";
}

function withSettingsAwareToolDefs(tools: ToolDef[], settings: AgentSettings): ToolDef[] {
  const roots = getAllowedFileRoots(settings).join("; ");
  return tools.map((tool) => {
    if (!FILE_TOOL_NAMES.has(tool.name)) {
      if (tool.name === "shell_command") {
        const timeoutSec = Math.round((settings.shellCommandTimeoutMs ?? 300_000) / 1000);
        return {
          ...tool,
          description: [
            tool.description,
            `Configured default timeout: ${timeoutSec}s (${settings.shellCommandTimeoutMs ?? 300_000}ms).`,
            "Omit timeoutMs to use that default.",
            "Never run vite/webpack/npm run dev via shell_command. Use build or ask the user to start the dev server.",
          ].join(" "),
        };
      }
      return tool;
    }
    return {
      ...tool,
      description: [
        tool.description,
        `Current allowed roots: ${roots}.`,
        "If the target path is outside these roots, do not call this tool because it will always fail.",
        "Use shell_command for paths outside allowed roots.",
      ].join(" "),
    };
  });
}

function getFileToolPath(args: Record<string, unknown>) {
  const raw = args.path ?? args.file_path;
  return typeof raw === "string" ? raw.trim() : "";
}

function summarizeTerminalToolOutput(name: string, output: string) {
  const cleaned = output.replace(/\r/g, "").trim();
  if (!cleaned || cleaned.startsWith("Error:")) return "";

  const firstLine = cleaned.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  if (name === "install_skill") {
    const match = firstLine.match(/^Installed skill:\s*(.+?)\s*\((.+?)\)$/i);
    if (!match) return "";
    const marketplace = cleaned.match(/^Marketplace:\s*(.+)$/im)?.[1]?.trim();
    return `Installed: ${match[1]} (${match[2]})${marketplace ? `, source: ${marketplace}` : ""}.`;
  }

  if (name === "create_skill") {
    const match = firstLine.match(/^Saved skill:\s*(.+?)\s*\((.+?)\)$/i);
    if (!match) return "";
    return `Created: ${match[1]} (${match[2]}).`;
  }

  return "";
}

type BufferedToolCall = {
  key: string;
  id: string;
  name: string;
  args: string;
  index?: number;
};

const DSML_TAG = String.raw`(?:锝滐綔DSML锝滐綔|\|\|DSML\|\|)`;
const DSML_TOOL_BLOCK_RE = new RegExp(String.raw`<\s*${DSML_TAG}tool_calls\s*>([\s\S]*?)<\/\s*${DSML_TAG}tool_calls\s*>`, "g");
const DSML_TOOL_START_RE = new RegExp(String.raw`<\s*${DSML_TAG}tool_calls\s*>`);
const DSML_INVOKE_RE = new RegExp(String.raw`<\s*${DSML_TAG}invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/\s*${DSML_TAG}invoke\s*>`, "g");
const DSML_PARAMETER_RE = new RegExp(String.raw`<\s*${DSML_TAG}parameter\s+name="([^"]+)"(?:\s+string="([^"]+)")?\s*>([\s\S]*?)<\/\s*${DSML_TAG}parameter\s*>`, "g");

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
  const danglingStart = visibleText.search(DSML_TOOL_START_RE);
  if (danglingStart >= 0) {
    visibleText = visibleText.slice(0, danglingStart);
  }
  return { visibleText, calls };
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

async function buildBudgetAwareConversationContext(
  settings: AgentSettings,
  session: Session,
  summarize: (transcript: string) => Promise<string>,
  baseSections: Array<{ key: string; label: string; content: string }>,
  budgetConfig: ReturnType<typeof computePromptBudget>
) {
  const conversationMessages = session.messages.filter((message) => message.role !== "system");
  const recentWindow = normalizePositiveInteger(settings.maxContextTurns, 12);
  let recentMessages = conversationMessages.slice(-recentWindow);
  let olderMessages = conversationMessages.slice(0, Math.max(0, conversationMessages.length - recentMessages.length));
  let threadSummary = session.threadSummary?.trim() ?? "";
  let compacted = false;
  let passes = 0;

  const estimateBase = () => baseSections.reduce((sum, section) => sum + estimateSectionTokens(section.label, section.content), 0);
  const estimateSummary = () => estimateSectionTokens("Earlier conversation summary", threadSummary);
  const estimateRecent = () => estimateMessagesTokens(recentMessages);
  const estimateTotal = () => estimateBase() + estimateSummary() + estimateRecent();

  while (
    settings.enableContextCompaction
    && (estimateTotal() >= budgetConfig.autoCompactTokenLimit || (passes === 0 && olderMessages.length > 0 && conversationMessages.length > Math.max(recentWindow + 1, settings.contextCompactionThreshold)))
    && passes < 4
  ) {
    const summaryInput = olderMessages.length > 0
      ? olderMessages
      : recentMessages.slice(0, Math.max(0, recentMessages.length - Math.max(2, Math.floor(recentWindow / 2))));
    if (!summaryInput.length) break;

    const nextSummary = await compactOlderMessages(summaryInput, summarize);
    threadSummary = [threadSummary, nextSummary].filter(Boolean).join("\n\n");
    compacted = true;
    passes += 1;

    if (olderMessages.length > 0) {
      olderMessages = [];
    } else {
      recentMessages = recentMessages.slice(-Math.max(2, Math.floor(recentWindow / 2)));
    }

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
  attachments: ChatAttachment[] = []
): Promise<Extract<StreamEvent, { type: "done" }> | null> {
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

  if (!primaryConfig.model.trim()) {
    throw new Error(MISSING_PRIMARY_MODEL_MESSAGE);
  }

  if (!effectiveApiKey) {
    throw new Error(primaryConfig.name === "default" ? MISSING_PRIMARY_MODEL_MESSAGE : MISSING_API_KEY_MESSAGE);
  }

  const apiBase = primaryConfig.apiBase;
  const model = primaryConfig.model;
  const capabilitySummary = await getEnabledModelCapabilitySummary();
  const skillInstructions = await getEnabledSkillInstructions();
  const enabledToolDefs = withSettingsAwareToolDefs(getEnabledToolDefs(), settings);
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
  let memoryContext = "";
  if (settings.enableMemory) {
    memoryContext = await recallMemory(lastUserMsg, effectiveApiKey, apiBase);
  }
  const knowledgeContext = settings.enableKnowledge ? await retrieveKnowledgeContext(lastUserMsg) : "";
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
    `Planning mode: ${settings.planningMode}. Max steps: ${settings.maxSteps}.`,
    `Workspace root for file tools: ${getWorkspaceRoot(settings)}.`,
    `Allowed file roots: ${getAllowedFileRoots(settings).join("; ")}.`,
    "Tool budget matters: never call file_read or file_write unless you have verified the path is inside allowed roots.",
    "If a path is outside allowed roots, do NOT call file_read/file_write. Use shell_command or ask the user to update Settings first.",
    "After one file-tool boundary failure, do not call file_read/file_write again in the same reply.",
    "Use tools when they are helpful. For web_search or http_request, cite useful result links in your answer when available.",
    "Never write DSML/XML-like tool call tags in the user-visible response. Use the provided tool-calling interface only.",
    "Use shell_command for terminal tasks and for listing or inspecting paths outside the workspace.",
    "For shell_command: omit timeoutMs to use the configured default script timeout (Settings). Do not pass timeoutMs: 6000 or other short values for npm install, build, or dev commands.",
    "Never use shell_command to start vite, webpack, or npm run dev because those processes do not exit and will block until timeout.",
    `Primary model: ${primaryConfig.name} / ${primaryConfig.model}.`,
    `Resolved context budget: window=${budgetConfig.contextWindowTokens}, input=${budgetConfig.maxInputTokens}, compact=${budgetConfig.autoCompactTokenLimit}, source=${resolvedBudget.contextWindowSource ?? "default"}.`,
    "You are the orchestrator. Route specialist work by capability instead of asking the user for a model name.",
    "Use analyze_image for image recognition or visual question answering.",
    "Use generate_image for text-to-image requests and edit_image when the user wants to modify an existing image.",
    "Use transcribe_audio for speech-to-text and synthesize_speech for text-to-speech.",
    "Use invoke_model with a capability when a configured specialist model is better suited for a non-media sub-task.",
    `Configured specialist capabilities:\n${formatCapabilitySummary(capabilitySummary)}`,
    "For file_write, only write files when the user explicitly asks you to create or modify files.",
    "When the user wants to create, search, or install a skill, prefer the dedicated search_skills, install_skill, and create_skill tools instead of sending them to the Skills page UI.",
    "When the user asks to find a skill, treat internet skill marketplaces as the default search surface unless they explicitly ask for local-only skills.",
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
      apiKey: effectiveApiKey,
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

  const lcMessages = [
    new SystemMessage(systemPrompt),
    ...(conversationContext.compactedSummary
      ? [new SystemMessage(`Earlier conversation summary from automatic context compaction:\n${conversationContext.compactedSummary}`)]
      : []),
    ...conversationContext.messages,
  ];

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
      ], { temperature: primaryConfig.temperature ?? settings.temperature ?? 0.4, maxTokens: resolvedBudget.reservedOutputTokens ?? 2048 });
      for (const char of result.content) {
        pushEvent(requestId, { type: "token", content: char });
      }
      const doneEvent: Extract<StreamEvent, { type: "done" }> = {
        type: "done",
        content: result.content,
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
      pushEvent(requestId, doneEvent);
      return doneEvent;
    } catch (error) {
      pushEvent(requestId, { type: "error", message: toErrorMessage(error) });
      return null;
    }
  }

  const llm = new ChatOpenAI({
    apiKey: effectiveApiKey,
    model,
    temperature: primaryConfig.temperature ?? settings.temperature ?? 0.4,
    configuration: { baseURL: apiBase },
    streaming: true,
  });

  const enabledToolMap = new Map(enabledToolDefs.map((tool) => [tool.name, tool]));
  const llmRunner = enabledToolDefs.length > 0 ? llm.bindTools(enabledToolDefs.map(toLcTool)) : llm;
  const toolCtx: ToolExecutionContext = {
    settings,
    apiKey: effectiveApiKey,
    apiBase,
    capabilitySummary,
  };

  let fullContent = "";
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  const maxSteps = settings.maxSteps ?? 20;
  let reachedToolStepLimit = false;
  let fileToolsBlocked = false;
  let breakerInfo: ReturnType<typeof circuitBreakerInfoFromDecision> | undefined;
  const circuitBreaker = settings.circuitBreakerEnabled ? createAgentLoopCircuitBreaker(settings) : null;

  try {
    for (let step = 0; step < maxSteps; step++) {
      let turnContent = "";
      let rawTurnContent = "";
      const toolCallBuffer: BufferedToolCall[] = [];
      let terminalSummary = "";

      const stream = await llmRunner.stream(lcMessages);
      for await (const chunk of stream) {
        const c = chunk as AIMessageChunk;
        const token = typeof c.content === "string" ? c.content : "";
        if (token) {
          rawTurnContent += token;
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

      const parsedDsml = parseDsmlToolCalls(rawTurnContent);
      turnContent = parsedDsml.visibleText;
      if (turnContent) {
        fullContent += turnContent;
        pushEvent(requestId, { type: "token", content: turnContent });
      }
      toolCallBuffer.push(...parsedDsml.calls);

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

      for (const tc of toolCallBuffer) {
        const parsedArgs = parseToolArgs(tc.args);
        pushEvent(requestId, { type: "tool_call", id: tc.id, name: tc.name, input: parsedArgs });

        const toolFn = enabledToolMap.get(tc.name);
        const t0 = Date.now();
        let output: string;
        try {
          if (FILE_TOOL_NAMES.has(tc.name)) {
            if (fileToolsBlocked) {
              output = [
                "[BLOCKED] file_read/file_write skipped to avoid wasting tool steps.",
                "A previous file-tool call already failed the workspace boundary check in this reply.",
                "Use shell_command instead, or ask the user to add the folder in Settings.",
              ].join(" ");
            } else {
              const requestedPath = getFileToolPath(parsedArgs);
              if (!requestedPath) {
                output = "Error: Missing required argument: path";
              } else if (!isPathInsideWorkspace(requestedPath, settings)) {
                output = workspaceBoundaryError(requestedPath, settings);
                fileToolsBlocked = true;
              } else {
                output = toolFn
                  ? await toolFn.execute(parsedArgs, toolCtx)
                  : `Tool is not enabled or unknown: ${tc.name}`;
              }
            }
          } else {
            output = toolFn
              ? await toolFn.execute(parsedArgs, toolCtx)
              : `Tool is not enabled or unknown: ${tc.name}`;
          }
        } catch (error) {
          output = `Error: ${toErrorMessage(error)}`;
          if (FILE_TOOL_NAMES.has(tc.name) && output.includes("outside allowed file roots")) {
            fileToolsBlocked = true;
          }
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

      if (terminalSummary) {
        const finalToken = `\n\n${terminalSummary}`;
        fullContent += finalToken;
        pushEvent(requestId, { type: "token", content: finalToken });
        break;
      }

      const decision = circuitBreaker?.evaluate();
      if (decision?.action === "stop") {
        breakerInfo = circuitBreakerInfoFromDecision(decision);
        reachedToolStepLimit = false;
        break;
      }

      if (step === maxSteps - 1) {
        reachedToolStepLimit = true;
      }
    }

    if (reachedToolStepLimit || breakerInfo) {
      const finalStream = await llm.stream([
        ...lcMessages,
        new SystemMessage(
          breakerInfo
            ? `The run was stopped by the circuit breaker (${breakerInfo.reason}: ${breakerInfo.detail}). Do not call tools. Based on the available tool results, give the user a concise final response in their language. If work is incomplete, say exactly what remains.`
            : "The tool step limit has been reached. Do not call tools. Based on the available tool results, give the user a concise final response in their language. If work is incomplete, say exactly what remains."
        ),
      ]);
      let finalContent = "";
      let rawFinalContent = "";
      for await (const chunk of finalStream) {
        const c = chunk as AIMessageChunk;
        const token = typeof c.content === "string" ? c.content : "";
        if (token) {
          rawFinalContent += token;
        }
        if (c.usage_metadata) {
          promptTokens = c.usage_metadata.input_tokens;
          completionTokens = c.usage_metadata.output_tokens;
        }
      }
      finalContent = parseDsmlToolCalls(rawFinalContent).visibleText;
      if (finalContent) {
        fullContent += finalContent;
        pushEvent(requestId, { type: "token", content: finalContent });
      }
      if (!finalContent.trim()) {
        fullContent += MAX_STEPS_FALLBACK_MESSAGE;
        pushEvent(requestId, { type: "token", content: MAX_STEPS_FALLBACK_MESSAGE });
      }
    }
  } catch (error) {
    pushEvent(requestId, { type: "error", message: toErrorMessage(error) });
    return null;
  }

  const doneEvent: Extract<StreamEvent, { type: "done" }> = {
    type: "done",
    content: fullContent || EMPTY_RESPONSE_FALLBACK_MESSAGE,
    usage: { promptTokens, completionTokens },
    ...(breakerInfo
      ? { stopReason: "circuit_breaker" as const, circuitBreaker: breakerInfo }
      : reachedToolStepLimit
        ? { stopReason: "max_steps" as const }
        : {}),
    contextBudget: {
      contextWindowTokens: budgetConfig.contextWindowTokens,
      maxInputTokens: budgetConfig.maxInputTokens,
      autoCompactTokenLimit: budgetConfig.autoCompactTokenLimit,
      estimatedPromptTokens: conversationContext.estimatedPromptTokens,
      source: resolvedBudget.contextWindowSource,
    },
  };
  pushEvent(requestId, doneEvent);
  return doneEvent;
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
        apiKey: primaryConfig.apiKey || fallbackApiKey,
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
    { model: primaryConfig.model }
  );
}
