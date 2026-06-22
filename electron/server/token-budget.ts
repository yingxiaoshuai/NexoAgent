import type { AgentSettings, ChatMessage, ModelContextBudget } from "../../src/shared/types";

export interface TokenEstimateDetail {
  chineseChars: number;
  latinChars: number;
  digits: number;
  whitespace: number;
  punctuation: number;
  otherChars: number;
}

export interface PromptBudget {
  contextWindowTokens: number;
  reservedOutputTokens: number;
  toolSchemaReserveTokens: number;
  autoCompactTokenLimit: number;
  compactionTargetTokens: number;
  maxInputTokens: number;
}

const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
const DEFAULT_RESERVED_OUTPUT_TOKENS = 8_192;
const DEFAULT_COMPACTION_TARGET_RATIO = 0.6;
const DEFAULT_TOOL_SCHEMA_RESERVE_TOKENS = 2_048;
const DEFAULT_AUTO_COMPACT_RATIO = 0.75;

function clampInteger(value: number | undefined, fallback: number, min: number, max: number) {
  const normalized = Math.floor(Number(value));
  if (!Number.isFinite(normalized)) return fallback;
  return Math.max(min, Math.min(max, normalized));
}

function clampRatio(value: number | undefined, fallback = DEFAULT_COMPACTION_TARGET_RATIO) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return fallback;
  return Math.max(0.2, Math.min(0.9, normalized));
}

export function inspectTokenEstimate(text: string): TokenEstimateDetail {
  const detail: TokenEstimateDetail = {
    chineseChars: 0,
    latinChars: 0,
    digits: 0,
    whitespace: 0,
    punctuation: 0,
    otherChars: 0,
  };

  for (const char of text) {
    if (/\s/u.test(char)) {
      detail.whitespace += 1;
    } else if (/[\u3400-\u9fff\uf900-\ufaff]/u.test(char)) {
      detail.chineseChars += 1;
    } else if (/[A-Za-z]/u.test(char)) {
      detail.latinChars += 1;
    } else if (/[0-9]/u.test(char)) {
      detail.digits += 1;
    } else if (/[\p{P}\p{S}]/u.test(char)) {
      detail.punctuation += 1;
    } else {
      detail.otherChars += 1;
    }
  }

  return detail;
}

export function estimateTokens(text: string) {
  if (!text.trim()) return 0;
  const detail = inspectTokenEstimate(text);
  const estimated =
    detail.chineseChars * 0.6
    + detail.latinChars * 0.3
    + detail.digits * 0.35
    + detail.punctuation * 0.25
    + detail.whitespace * 0.1
    + detail.otherChars * 0.45;
  return Math.max(1, Math.ceil(estimated));
}

export function estimateMessageTokens(message: Pick<ChatMessage, "role" | "content" | "attachments">) {
  const attachmentText = message.attachments?.length
    ? message.attachments.map((attachment) => `${attachment.type}:${attachment.name}:${attachment.url}`).join("\n")
    : "";
  const roleOverhead = 8;
  return roleOverhead + estimateTokens(`${message.role}\n${message.content}\n${attachmentText}`);
}

export function estimateMessagesTokens(messages: Array<Pick<ChatMessage, "role" | "content" | "attachments">>) {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

export function estimateSectionTokens(label: string, content: string) {
  if (!content.trim()) return 0;
  return estimateTokens(`${label}\n${content}`);
}

export function computePromptBudget(
  settings: AgentSettings,
  budget: ModelContextBudget = {},
  toolSchemaReserveTokens = DEFAULT_TOOL_SCHEMA_RESERVE_TOKENS
): PromptBudget {
  const contextWindowTokens = clampInteger(
    budget.contextWindowTokens ?? settings.contextWindowTokens,
    DEFAULT_CONTEXT_WINDOW_TOKENS,
    8_192,
    10_000_000
  );
  const reservedOutputTokens = clampInteger(
    budget.reservedOutputTokens ?? settings.reservedOutputTokens,
    DEFAULT_RESERVED_OUTPUT_TOKENS,
    512,
    Math.max(1_024, Math.floor(contextWindowTokens * 0.5))
  );
  const safeToolSchemaReserve = clampInteger(
    toolSchemaReserveTokens,
    DEFAULT_TOOL_SCHEMA_RESERVE_TOKENS,
    256,
    Math.max(512, Math.floor(contextWindowTokens * 0.2))
  );
  const maxInputTokens = Math.max(2_048, contextWindowTokens - reservedOutputTokens - safeToolSchemaReserve);
  const autoCompactTokenLimit = clampInteger(
    budget.autoCompactTokenLimit ?? settings.autoCompactTokenLimit,
    Math.floor(maxInputTokens * DEFAULT_AUTO_COMPACT_RATIO),
    1_024,
    maxInputTokens
  );
  const compactionTargetRatio = clampRatio(budget.compactionTargetRatio ?? settings.compactionTargetRatio);
  const compactionTargetTokens = Math.max(768, Math.min(autoCompactTokenLimit, Math.floor(maxInputTokens * compactionTargetRatio)));

  return {
    contextWindowTokens,
    reservedOutputTokens,
    toolSchemaReserveTokens: safeToolSchemaReserve,
    autoCompactTokenLimit,
    compactionTargetTokens,
    maxInputTokens,
  };
}

export function truncateTextToTokenBudget(text: string, tokenBudget: number, suffix = "\n...[truncated]") {
  if (!text.trim()) return "";
  if (tokenBudget <= 0) return "";
  if (estimateTokens(text) <= tokenBudget) return text.trim();

  let low = 0;
  let high = text.length;
  let best = "";
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = `${text.slice(0, mid).trimEnd()}${suffix}`;
    const candidateTokens = estimateTokens(candidate);
    if (candidateTokens <= tokenBudget) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best || text.slice(0, Math.max(1, Math.floor(text.length / 4))).trimEnd();
}

export function trimSectionsToBudget(
  sections: Array<{ key: string; label: string; content: string; minTokens?: number }>,
  availableTokens: number
) {
  const normalized = sections
    .map((section) => ({
      ...section,
      content: section.content.trim(),
      tokens: estimateSectionTokens(section.label, section.content),
      minTokens: Math.max(64, section.minTokens ?? 128),
    }))
    .filter((section) => section.content && section.tokens > 0);

  let total = normalized.reduce((sum, section) => sum + section.tokens, 0);
  if (total <= availableTokens) {
    return normalized.map(({ key, label, content, tokens }) => ({ key, label, content, tokens, trimmed: false }));
  }

  const trimmed = normalized.map((section) => ({ ...section, trimmed: false }));
  while (total > availableTokens) {
    const candidate = trimmed
      .filter((section) => section.tokens > section.minTokens)
      .sort((a, b) => b.tokens - a.tokens)[0];
    if (!candidate) break;
    const nextBudget = Math.max(candidate.minTokens, Math.floor(candidate.tokens * 0.8));
    const nextContent = truncateTextToTokenBudget(candidate.content, nextBudget);
    const nextTokens = estimateSectionTokens(candidate.label, nextContent);
    if (nextTokens >= candidate.tokens) break;
    candidate.content = nextContent;
    candidate.tokens = nextTokens;
    candidate.trimmed = true;
    total = trimmed.reduce((sum, section) => sum + section.tokens, 0);
  }

  return trimmed.map(({ key, label, content, tokens, trimmed: wasTrimmed }) => ({
    key,
    label,
    content,
    tokens,
    trimmed: wasTrimmed,
  }));
}
