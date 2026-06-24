import fs from "node:fs/promises";
import path from "node:path";
import { isMemoryKind, recallMemory, type MemoryKind } from "../../memory";
import { KNOWLEDGE_DIR } from "../config";
import { MAX_FILE_WRITE_BYTES } from "../knowledge";
import type { ToolExecutionContext } from "../types";
import { getOptionalNumberArg, getOptionalStringArg, getStringArg, resolveDataPath } from "../utils";
import { invokeModel } from "./model-call";
import { runShellCommand } from "./shell-command";

export type ToolExecutor = (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<string>;

function readMemoryKinds(value: unknown): MemoryKind[] | undefined {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const kinds = raw.map((item) => String(item).trim()).filter(isMemoryKind);
  return kinds.length ? kinds : undefined;
}

function slugifyKnowledgeTitle(value: string) {
  const ascii = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return ascii || `knowledge-${new Date().toISOString().slice(0, 10)}`;
}

function normalizeKnowledgePath(rawPath: string, title: string) {
  const fallback = path.join("general", `${slugifyKnowledgeTitle(title)}.md`);
  const normalized = (rawPath.trim() || fallback)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  return normalized.toLowerCase().endsWith(".md") ? normalized : `${normalized}.md`;
}

function normalizeKnowledgeContent(content: string, title: string, source: string) {
  const trimmed = content.trim();
  const lines: string[] = [];
  if (!trimmed.startsWith("# ")) {
    lines.push(`# ${title.trim() || "Knowledge Note"}`, "");
  }
  if (source.trim() && !/^>\s*Source:/im.test(trimmed)) {
    lines.push(`> Source: ${source.trim()}`, "");
  }
  lines.push(trimmed);
  return `${lines.join("\n").trim()}\n`;
}

async function updateKnowledgeIndex(relPath: string, title: string, summary: string) {
  const indexPath = resolveDataPath(KNOWLEDGE_DIR, "index.md");
  const displayTitle = title.trim() || path.basename(relPath, ".md");
  const description = summary.trim() || "Agent-created knowledge note";
  const line = `- [${displayTitle}](${relPath.replace(/\\/g, "/")}) — ${description}`;

  let current = await fs.readFile(indexPath, "utf8").catch(() => "# Knowledge Index\n");
  if (!current.trim()) current = "# Knowledge Index\n";
  if (!current.includes(`](${relPath.replace(/\\/g, "/")})`)) {
    current = `${current.trimEnd()}\n${line}\n`;
    await fs.mkdir(path.dirname(indexPath), { recursive: true });
    await fs.writeFile(indexPath, current, "utf8");
  }
}

async function appendKnowledgeLog(relPath: string, title: string, mode: string) {
  const logPath = resolveDataPath(KNOWLEDGE_DIR, "log.md");
  const date = new Date().toISOString().slice(0, 10);
  const displayTitle = title.trim() || path.basename(relPath, ".md");
  const entry = `## [${date}] ${mode === "append" ? "update" : "write"} | ${displayTitle}\n- Path: ${relPath.replace(/\\/g, "/")}\n`;
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `${entry}\n`, "utf8");
}

async function writeKnowledge(args: Record<string, unknown>) {
  const content = getStringArg(args, "content", ["body", "markdown"]);
  const title = getOptionalStringArg(args, "title", "");
  const source = getOptionalStringArg(args, "source", "");
  const summary = getOptionalStringArg(args, "summary", "");
  const mode = getOptionalStringArg(args, "mode", "overwrite").toLowerCase() === "append" ? "append" : "overwrite";
  const relPath = normalizeKnowledgePath(getOptionalStringArg(args, "path", ""), title || summary || content.slice(0, 40));
  const fullPath = resolveDataPath(KNOWLEDGE_DIR, relPath);
  const body = normalizeKnowledgeContent(content, title || path.basename(relPath, ".md"), source);

  if (Buffer.byteLength(body, "utf8") > MAX_FILE_WRITE_BYTES) {
    throw new Error(`Knowledge content exceeds ${MAX_FILE_WRITE_BYTES} bytes.`);
  }

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  if (mode === "append") {
    await fs.appendFile(fullPath, `\n${body}`, "utf8");
  } else {
    await fs.writeFile(fullPath, body, "utf8");
  }

  const updateIndex = args.updateIndex !== false;
  if (updateIndex && relPath !== "index.md" && relPath !== "log.md") {
    await updateKnowledgeIndex(relPath, title, summary);
    await appendKnowledgeLog(relPath, title, mode);
  }

  return [
    "Knowledge note saved.",
    `path: ${relPath.replace(/\\/g, "/")}`,
    `mode: ${mode}`,
  ].join("\n");
}

export const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  invoke_model: async (args, ctx) => invokeModel(args, ctx),
  shell_command: async (args, ctx) => runShellCommand(args, ctx),
  write_knowledge: async (args) => writeKnowledge(args),
  recall_memory: async (args, ctx) => {
    const query = getStringArg(args, "query", ["q"]);
    const kinds = readMemoryKinds(args.kinds ?? args.kind);
    const dayKey = getOptionalStringArg(args, "dayKey") || getOptionalStringArg(args, "day_key");
    const k = getOptionalNumberArg(args, "k", 6);
    const result = await recallMemory(query, {
      providerId: ctx.settings.providerId,
      providerName: ctx.settings.providerName,
      apiKey: ctx.apiKey,
      apiBase: ctx.apiBase,
      model: ctx.settings.model,
      temperature: ctx.settings.temperature,
    }, undefined, k, kinds, dayKey || undefined);
    return result || "No relevant memory found.";
  },
};
