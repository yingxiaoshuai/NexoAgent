import path from "node:path";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { OpenAIEmbeddings } from "@langchain/openai";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { ChromaClient, type Collection, type Metadata, type Where } from "chromadb";
import {
  CHROMA_DIR,
  DATA_DIR,
  MEMORY_DB_FILE,
  MEMORY_JSON_FILE,
  MEMORY_MD_FILE,
} from "./server/config";
const MEMORY_SCHEMA_VERSION = 2;
const CHROMA_COLLECTION = "nexo_memories";
const DREAM_DEBOUNCE_MS = 1200;
const EMBEDDING_TIMEOUT_MS = 8000;

export type MemoryKind = "daily" | "dream" | "long_term" | "script";

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  dayKey: string;
  content: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  key?: string;
  scope?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryFilters {
  kind?: MemoryKind;
  kinds?: MemoryKind[];
  dayKey?: string;
}

export interface RecallOptions extends MemoryFilters {
  k?: number;
}

export interface DreamConsolidationResult {
  ok: boolean;
  id?: string;
  dayKey: string;
  reason?: string;
}

interface StoredMemoryRow {
  id: string;
  kind: MemoryKind;
  day_key: string;
  content: string;
  session_id: string;
  key: string | null;
  scope: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

interface ChromaRuntime {
  client: ChromaClient;
  collection: Collection;
  process?: ChildProcess;
  port: number;
}

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;
let dbReady: Promise<void> | null = null;
let writeQueue = Promise.resolve();
let chromaRuntime: Promise<ChromaRuntime | null> | null = null;
let chromaUnavailable = false;
const pendingChromaUpserts = new Set<string>();
const dreamTimers = new Map<string, NodeJS.Timeout>();
const chromaChildren = new Set<ChildProcess>();

function nowIso() {
  return new Date().toISOString();
}

function createId(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

export function dayKeyFromDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function normalizeDayKey(value?: string | Date | null): string {
  if (value instanceof Date) return dayKeyFromDate(value);
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return dayKeyFromDate();
  const compact = raw.replace(/-/g, "");
  if (/^\d{8}$/.test(compact)) return compact;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return dayKeyFromDate(parsed);
  throw new Error("dayKey must use YYYYMMDD or a parseable date.");
}

export function isMemoryKind(value: unknown): value is MemoryKind {
  return value === "daily" || value === "dream" || value === "long_term" || value === "script";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function getSql() {
  SQL ??= await initSqlJs({
    locateFile: (file) => {
      const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
      const candidates = [
        path.join(process.cwd(), "node_modules", "sql.js", "dist", file),
        path.join(resourcesPath || process.cwd(), "node_modules", "sql.js", "dist", file),
        path.join(__dirname, "..", "..", "node_modules", "sql.js", "dist", file),
      ];
      return candidates.find((candidate) => fsSync.existsSync(candidate)) ?? candidates[0];
    },
  });
  return SQL;
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function saveDb() {
  if (!db) return;
  await fs.mkdir(DATA_DIR, { recursive: true });
  const data = db.export();
  await fs.writeFile(MEMORY_DB_FILE, Buffer.from(data));
}

function enqueueWrite<T>(work: () => Promise<T>) {
  const next = writeQueue.then(work, work);
  writeQueue = next.then(() => undefined, () => undefined);
  return next;
}

function getTableColumns(database: Database, tableName: string) {
  try {
    const rows = database.exec(`PRAGMA table_info(${tableName})`)[0]?.values ?? [];
    return rows.map((row) => String(row[1]));
  } catch {
    return [];
  }
}

function tableExists(database: Database, tableName: string) {
  const result = database.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [tableName]);
  return Boolean(result[0]?.values.length);
}

function readUserVersion(database: Database) {
  const value = database.exec("PRAGMA user_version")[0]?.values[0]?.[0];
  return Number(value ?? 0);
}

function needsSchemaRebuild(database: Database) {
  if (readUserVersion(database) !== MEMORY_SCHEMA_VERSION) return true;
  if (!tableExists(database, "memories")) return true;
  if (tableExists(database, "memory_embeddings")) return true;
  const columns = getTableColumns(database, "memories");
  return !["id", "kind", "day_key", "content", "session_id", "key", "scope", "metadata", "created_at", "updated_at"].every((column) =>
    columns.includes(column)
  );
}

async function resetChromaData() {
  await fs.rm(CHROMA_DIR, { recursive: true, force: true });
  chromaRuntime = null;
  chromaUnavailable = false;
  pendingChromaUpserts.clear();
}

async function removeLegacyMemoryFiles() {
  await fs.rm(MEMORY_JSON_FILE, { force: true });
}

function createSchema(database: Database) {
  database.run(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('daily', 'dream', 'long_term', 'script')),
      day_key TEXT NOT NULL CHECK (length(day_key) = 8),
      content TEXT NOT NULL,
      session_id TEXT NOT NULL DEFAULT '',
      key TEXT,
      scope TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
    CREATE INDEX IF NOT EXISTS idx_memories_day_key ON memories(day_key);
    CREATE INDEX IF NOT EXISTS idx_memories_kind_day_key ON memories(kind, day_key);
    CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(kind, key);
    CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(kind, scope);
    CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_script_memory_key ON memories(kind, key) WHERE kind = 'script' AND key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_dream_memory_key ON memories(kind, key) WHERE kind = 'dream' AND key IS NOT NULL;
    PRAGMA user_version = ${MEMORY_SCHEMA_VERSION};
  `);
}

async function ensureSchema(database: Database) {
  if (needsSchemaRebuild(database)) {
    database.exec(`
      DROP TABLE IF EXISTS memory_embeddings;
      DROP TABLE IF EXISTS memories;
    `);
    createSchema(database);
    await saveDb();
    await resetChromaData();
  } else {
    createSchema(database);
  }
  await removeLegacyMemoryFiles();
}

export async function loadMemory() {
  if (dbReady) return dbReady;
  dbReady = (async () => {
    const sql = await getSql();
    await fs.mkdir(DATA_DIR, { recursive: true });
    if (await fileExists(MEMORY_DB_FILE)) {
      db = new sql.Database(await fs.readFile(MEMORY_DB_FILE));
    } else {
      db = new sql.Database();
    }
    db.run("PRAGMA foreign_keys = ON;");
    await ensureSchema(db);
    await writeMemoryMarkdown();
  })();
  return dbReady;
}

async function getDb() {
  await loadMemory();
  if (!db) throw new Error("Memory database is not initialized.");
  return db;
}

function parseMetadata(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function rowToEntry(row: StoredMemoryRow): MemoryEntry | null {
  if (!isMemoryKind(row.kind)) return null;
  return {
    id: row.id,
    kind: row.kind,
    dayKey: row.day_key,
    content: row.content,
    sessionId: row.session_id,
    key: row.key ?? undefined,
    scope: row.scope ?? undefined,
    metadata: parseMetadata(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildMemoryWhere(filters: MemoryFilters = {}) {
  const clauses: string[] = [];
  const params: string[] = [];
  const kinds = filters.kind ? [filters.kind] : filters.kinds?.filter(isMemoryKind) ?? [];
  if (kinds.length === 1) {
    clauses.push("kind = ?");
    params.push(kinds[0]);
  } else if (kinds.length > 1) {
    clauses.push(`kind IN (${kinds.map(() => "?").join(", ")})`);
    params.push(...kinds);
  }
  if (filters.dayKey) {
    clauses.push("day_key = ?");
    params.push(normalizeDayKey(filters.dayKey));
  }
  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

function allRows(filters: MemoryFilters = {}): MemoryEntry[] {
  if (!db) return [];
  const where = buildMemoryWhere(filters);
  const stmt = db.prepare(`SELECT * FROM memories ${where.sql} ORDER BY updated_at DESC`);
  const rows: MemoryEntry[] = [];
  try {
    if (where.params.length) stmt.bind(where.params);
    while (stmt.step()) {
      const entry = rowToEntry(stmt.getAsObject() as unknown as StoredMemoryRow);
      if (entry) rows.push(entry);
    }
  } finally {
    stmt.free();
  }
  return rows;
}

function getMemoryById(id: string): MemoryEntry | null {
  if (!db) return null;
  const stmt = db.prepare("SELECT * FROM memories WHERE id = ? LIMIT 1");
  try {
    stmt.bind([id]);
    if (!stmt.step()) return null;
    return rowToEntry(stmt.getAsObject() as unknown as StoredMemoryRow);
  } finally {
    stmt.free();
  }
}

function getMemoryIdByKindKey(kind: MemoryKind, key: string): string | null {
  if (!db) return null;
  const result = db.exec("SELECT id FROM memories WHERE kind = ? AND key = ? LIMIT 1", [kind, key]);
  const value = result[0]?.values[0]?.[0];
  return value == null ? null : String(value);
}

async function writeMemoryMarkdown() {
  const database = db;
  if (!database) return;
  const memories = allRows();
  const byDay = new Map<string, MemoryEntry[]>();
  for (const memory of memories) {
    const list = byDay.get(memory.dayKey) ?? [];
    list.push(memory);
    byDay.set(memory.dayKey, list);
  }

  const lines = ["# Nexo Agent Memory", ""];
  const days = Array.from(byDay.keys()).sort((a, b) => b.localeCompare(a));
  if (!days.length) {
    lines.push("_No memory yet_");
  }
  for (const day of days) {
    lines.push(`## ${day}`, "");
    const entries = byDay.get(day) ?? [];
    for (const kind of ["daily", "dream", "long_term", "script"] as MemoryKind[]) {
      const kindEntries = entries.filter((entry) => entry.kind === kind);
      if (!kindEntries.length) continue;
      lines.push(`### ${kind}`, "");
      for (const entry of kindEntries) {
        lines.push(`- ${entry.key ? `[${entry.key}] ` : ""}${entry.content}`);
      }
      lines.push("");
    }
  }
  await fs.writeFile(MEMORY_MD_FILE, lines.join("\n"), "utf8");
}

function buildEmbeddings(apiKey: string, apiBase: string) {
  return new OpenAIEmbeddings({
    apiKey,
    configuration: { baseURL: apiBase },
    model: "text-embedding-3-small",
    maxRetries: 0,
    timeout: EMBEDDING_TIMEOUT_MS,
  });
}

async function embedText(text: string, apiKey: string, apiBase: string) {
  if (!apiKey) return null;
  const embeddings = buildEmbeddings(apiKey, apiBase);
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      embeddings.embedQuery(text),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), EMBEDDING_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isPortFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findFreePort(start = 8123) {
  for (let port = start; port < start + 30; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error("No free local port found for Chroma.");
}

function chromaBindingPackage() {
  if (process.platform === "win32" && process.arch === "x64") return "chromadb-js-bindings-win32-x64-msvc";
  if (process.platform === "win32" && process.arch === "arm64") return "chromadb-js-bindings-win32-arm64-msvc";
  if (process.platform === "darwin" && process.arch === "arm64") return "chromadb-js-bindings-darwin-arm64";
  if (process.platform === "darwin" && process.arch === "x64") return "chromadb-js-bindings-darwin-x64";
  if (process.platform === "linux" && process.arch === "arm64") return "chromadb-js-bindings-linux-arm64-gnu";
  if (process.platform === "linux" && process.arch === "x64") return "chromadb-js-bindings-linux-x64-gnu";
  return null;
}

async function waitForChroma(client: ChromaClient) {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < 10_000) {
    try {
      await client.heartbeat();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Chroma did not become ready.");
}

async function startLocalChromaServer(port: number): Promise<ChildProcess | undefined> {
  if (!(await isPortFree(port))) return undefined;
  const bindingPackage = chromaBindingPackage();
  if (!bindingPackage) return undefined;
  await fs.mkdir(CHROMA_DIR, { recursive: true });
  const script = [
    `const binding = require(${JSON.stringify(bindingPackage)});`,
    `binding.cli(${JSON.stringify(["chroma", "run", "--path", CHROMA_DIR, "--host", "127.0.0.1", "--port", String(port)])});`,
  ].join("\n");
  const child = spawn(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    stdio: "ignore",
    windowsHide: true,
  });
  chromaChildren.add(child);
  child.once("exit", () => chromaChildren.delete(child));
  process.once("exit", () => {
    for (const activeChild of chromaChildren) {
      try {
        activeChild.kill();
      } catch {
        // Best-effort shutdown.
      }
    }
  });
  child.unref();
  return child;
}

async function getChromaRuntime(): Promise<ChromaRuntime | null> {
  if (chromaUnavailable) return null;
  if (chromaRuntime) return chromaRuntime;
  chromaRuntime = (async () => {
    try {
      await fs.mkdir(CHROMA_DIR, { recursive: true });
      const port = await findFreePort();
      const child = await startLocalChromaServer(port);
      const client = new ChromaClient({ host: "127.0.0.1", port });
      await waitForChroma(client);
      const collection = await client.getOrCreateCollection({
        name: CHROMA_COLLECTION,
        embeddingFunction: null,
        metadata: { source: "nexo-agent" },
      });
      return { client, collection, process: child, port };
    } catch {
      chromaUnavailable = true;
      return null;
    }
  })();
  return chromaRuntime;
}

function toChromaMetadata(memory: MemoryEntry): Metadata {
  return {
    memory_id: memory.id,
    kind: memory.kind,
    day_key: memory.dayKey,
    updated_at: memory.updatedAt,
    ...(memory.key ? { key: memory.key } : {}),
    ...(memory.scope ? { scope: memory.scope } : {}),
  };
}

async function upsertChromaMemory(memory: MemoryEntry, apiKey?: string, apiBase?: string) {
  if (!apiKey || !apiBase) {
    pendingChromaUpserts.add(memory.id);
    return false;
  }
  try {
    const vector = await embedText(memory.content, apiKey, apiBase);
    if (!vector?.length) {
      pendingChromaUpserts.add(memory.id);
      return false;
    }
    const runtime = await getChromaRuntime();
    if (!runtime) {
      pendingChromaUpserts.add(memory.id);
      return false;
    }
    await runtime.collection.upsert({
      ids: [memory.id],
      embeddings: [vector],
      metadatas: [toChromaMetadata(memory)],
      documents: [memory.content],
    });
    pendingChromaUpserts.delete(memory.id);
    return true;
  } catch {
    pendingChromaUpserts.add(memory.id);
    return false;
  }
}

async function deleteChromaMemory(id: string) {
  pendingChromaUpserts.delete(id);
  try {
    const runtime = await getChromaRuntime();
    if (runtime) await runtime.collection.delete({ ids: [id] });
  } catch {
    // SQLite remains the source of truth.
  }
}

async function wipeChromaCollection() {
  pendingChromaUpserts.clear();
  try {
    const runtime = await getChromaRuntime();
    if (runtime) {
      await runtime.client.deleteCollection({ name: CHROMA_COLLECTION });
      runtime.collection = await runtime.client.getOrCreateCollection({
        name: CHROMA_COLLECTION,
        embeddingFunction: null,
        metadata: { source: "nexo-agent" },
      });
    }
  } catch {
    await resetChromaData();
  }
}

async function backfillPendingChroma(apiKey: string, apiBase: string) {
  if (!apiKey || !apiBase || pendingChromaUpserts.size === 0) return;
  const ids = Array.from(pendingChromaUpserts).slice(0, 20);
  for (const id of ids) {
    const memory = getMemoryById(id);
    if (memory) await upsertChromaMemory(memory, apiKey, apiBase);
    else pendingChromaUpserts.delete(id);
  }
}

function chromaWhere(options: RecallOptions): Where | undefined {
  const filters: Where[] = [];
  if (options.dayKey) filters.push({ day_key: normalizeDayKey(options.dayKey) });
  const kinds = options.kind ? [options.kind] : options.kinds?.filter(isMemoryKind) ?? [];
  if (kinds.length === 1) filters.push({ kind: kinds[0] });
  else if (kinds.length > 1) filters.push({ kind: { $in: kinds } } as unknown as Where);
  if (filters.length === 0) return undefined;
  if (filters.length === 1) return filters[0];
  return { $and: filters } as unknown as Where;
}

function keywordScore(query: string, content: string) {
  const tokens = Array.from(new Set(query.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? []));
  const haystack = content.toLowerCase();
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function fallbackRank(query: string, options: RecallOptions = {}) {
  const memories = allRows({ kinds: options.kinds, kind: options.kind, dayKey: options.dayKey });
  const k = options.k ?? 6;
  return memories
    .map((entry) => {
      const score = keywordScore(query, entry.content);
      const dreamBoost = entry.kind === "dream" ? 0.2 : 0;
      return { entry, score: score + dreamBoost };
    })
    .filter((item) => item.score > 0 || item.entry.kind === "script" || item.entry.kind === "dream")
    .sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt))
    .slice(0, k)
    .map(({ entry }) => entry);
}

function formatRecallEntry(entry: MemoryEntry) {
  return `- [${entry.kind} ${entry.dayKey}] ${entry.content}`;
}

async function semanticSearchEntries(query: string, apiKey: string, apiBase: string, options: RecallOptions = {}) {
  const k = options.k ?? 6;
  await backfillPendingChroma(apiKey, apiBase);
  const vector = await embedText(query, apiKey, apiBase);
  if (!vector?.length) return null;
  const runtime = await getChromaRuntime();
  if (!runtime) return null;

  const result = await runtime.collection.query({
    queryEmbeddings: [vector],
    nResults: k,
    where: chromaWhere(options),
    include: ["distances", "documents", "metadatas"],
  });
  const ids = result.ids?.[0] ?? [];
  const entries = ids
    .map((id) => getMemoryById(String(id)))
    .filter((entry): entry is MemoryEntry => Boolean(entry));
  return entries.slice(0, k);
}

export async function searchMemories(
  query: string,
  apiKey: string,
  apiBase: string,
  options: RecallOptions = {}
): Promise<MemoryEntry[]> {
  await getDb();
  try {
    const semantic = await semanticSearchEntries(query, apiKey, apiBase, options);
    if (semantic?.length) return semantic;
  } catch {
    // Fall through to SQLite.
  }
  return fallbackRank(query, options);
}

export async function recallMemory(
  query: string,
  apiKey: string,
  apiBase: string,
  k = 6,
  kinds: MemoryKind[] = ["daily", "dream", "long_term", "script"],
  dayKey?: string
): Promise<string> {
  const entries = await searchMemories(query, apiKey, apiBase, { k, kinds, dayKey });
  return entries.map(formatRecallEntry).join("\n");
}

export async function storeMemory(
  kind: MemoryKind,
  content: string,
  options: {
    sessionId?: string;
    key?: string;
    scope?: string;
    metadata?: Record<string, unknown>;
    apiKey?: string;
    apiBase?: string;
    dayKey?: string;
  } = {}
) {
  if (!isMemoryKind(kind)) throw new Error(`Unsupported memory kind: ${kind}`);
  const clean = content.trim();
  if (!clean) return null;
  const database = await getDb();
  const timestamp = nowIso();
  const metadata = options.metadata ? JSON.stringify(options.metadata) : null;
  const normalizedDayKey = normalizeDayKey(options.dayKey);
  const upsertByKey = (kind === "script" || kind === "dream") && options.key;
  const memoryKey = upsertByKey ? options.key! : null;
  let id = memoryKey ? getMemoryIdByKindKey(kind, memoryKey) ?? createId() : createId();

  await enqueueWrite(async () => {
    const existing = getMemoryById(id);
    const dayKey = existing?.dayKey ?? normalizedDayKey;
    if (memoryKey) {
      if (existing) {
        database.run(
          `UPDATE memories
           SET content = ?, session_id = ?, scope = ?, metadata = ?, updated_at = ?
           WHERE id = ?`,
          [clean, options.sessionId || existing.sessionId || "", options.scope || null, metadata, timestamp, id]
        );
      } else {
        database.run(
          `INSERT INTO memories (id, kind, day_key, content, session_id, key, scope, metadata, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, kind, dayKey, clean, options.sessionId || "", memoryKey, options.scope || null, metadata, timestamp, timestamp]
        );
      }
    } else {
      database.run(
        `INSERT INTO memories (id, kind, day_key, content, session_id, key, scope, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, kind, dayKey, clean, options.sessionId || "", options.key || null, options.scope || null, metadata, timestamp, timestamp]
      );
    }
    await saveDb();
    await writeMemoryMarkdown();
  });

  const stored = getMemoryById(id);
  if (stored) await upsertChromaMemory(stored, options.apiKey, options.apiBase);
  return id;
}

export async function storeScriptMemory(
  key: string,
  content: string,
  options: { scope?: string; metadata?: Record<string, unknown>; apiKey?: string; apiBase?: string; dayKey?: string } = {}
) {
  return storeMemory("script", content, { ...options, key });
}

function parseFactList(raw: string): string[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
      : [];
  } catch {
    return [];
  }
}

function scheduleDreamConsolidation(dayKey: string, options: { apiKey: string; apiBase: string; model: string }) {
  const normalized = normalizeDayKey(dayKey);
  const existing = dreamTimers.get(normalized);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    dreamTimers.delete(normalized);
    void consolidateDreamForDay(normalized, options);
  }, DREAM_DEBOUNCE_MS);
  dreamTimers.set(normalized, timer);
}

export async function extractAndStore(
  userMessage: string,
  assistantReply: string,
  sessionId: string,
  apiKey: string,
  apiBase: string,
  callLLM: (prompt: string) => Promise<string>,
  options: { model?: string } = {}
) {
  if (!apiKey) return;

  const prompt = `Extract 0-3 concise memory facts worth remembering from this exchange.
Reply ONLY with a JSON array of strings, e.g. ["fact1","fact2"]. Empty array if nothing worth saving.

User: ${userMessage}
Assistant: ${assistantReply}`;

  try {
    const raw = await callLLM(prompt);
    const facts = parseFactList(raw);
    if (!facts.length) return;
    const dayKey = dayKeyFromDate();
    for (const fact of facts.slice(0, 3)) {
      await storeMemory("daily", fact, {
        sessionId,
        dayKey,
        apiKey,
        apiBase,
        metadata: { source: "extracted_fact" },
      });
    }
    scheduleDreamConsolidation(dayKey, { apiKey, apiBase, model: options.model || "gpt-4o-mini" });
  } catch {
    // Non-fatal: memory extraction should never break chat completion.
  }
}

function summarizeSourceMemories(memories: MemoryEntry[]) {
  return memories.map((entry, index) => `${index + 1}. [${entry.kind}] ${entry.content}`).join("\n");
}

export async function consolidateDreamForDay(
  dayKey: string,
  options: {
    apiKey?: string;
    apiBase?: string;
    model?: string;
    callLLM?: (prompt: string) => Promise<string>;
  } = {}
): Promise<DreamConsolidationResult> {
  const normalized = normalizeDayKey(dayKey);
  if (!options.apiKey || !options.apiBase) return { ok: false, dayKey: normalized, reason: "missing_api_credentials" };

  await getDb();
  const sourceMemories = allRows({ dayKey: normalized, kinds: ["daily", "long_term", "script"] }).filter(
    (entry) => entry.kind !== "dream"
  );
  if (!sourceMemories.length) return { ok: false, dayKey: normalized, reason: "no_source_memories" };

  const prompt = `Create one concise dream memory for the day ${normalized}.
It should summarize the important events, connect related themes, and stay useful for future recall.
Reply as JSON: {"summary":"...","themes":["theme1","theme2"]}.

Memories:
${summarizeSourceMemories(sourceMemories)}`;

  try {
    const raw = options.callLLM
      ? await options.callLLM(prompt)
      : await (async () => {
          const llm = new ChatOpenAI({
            apiKey: options.apiKey,
            model: options.model || "gpt-4o-mini",
            temperature: 0.2,
            configuration: { baseURL: options.apiBase },
          });
          const res = await llm.invoke([new HumanMessage(prompt)]);
          return typeof res.content === "string" ? res.content : "";
        })();

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? (JSON.parse(jsonMatch[0]) as unknown) : {};
    const summary = isRecord(parsed) && typeof parsed.summary === "string" ? parsed.summary.trim() : raw.trim();
    if (!summary) return { ok: false, dayKey: normalized, reason: "empty_summary" };
    const themes =
      isRecord(parsed) && Array.isArray(parsed.themes)
        ? parsed.themes.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 8)
        : [];
    const id = await storeMemory("dream", summary, {
      key: `dream:${normalized}`,
      dayKey: normalized,
      apiKey: options.apiKey,
      apiBase: options.apiBase,
      metadata: {
        source: "dream_consolidation",
        sourceMemoryIds: sourceMemories.map((entry) => entry.id),
        themes,
        generatedAt: nowIso(),
        model: options.model || "gpt-4o-mini",
      },
    });
    return id ? { ok: true, id, dayKey: normalized } : { ok: false, dayKey: normalized, reason: "store_failed" };
  } catch {
    return { ok: false, dayKey: normalized, reason: "generation_failed" };
  }
}

export function getAllMemories(filters?: MemoryFilters): MemoryEntry[] {
  return allRows(filters);
}

export async function deleteMemory(id: string) {
  const database = await getDb();
  await enqueueWrite(async () => {
    database.run("DELETE FROM memories WHERE id = ?", [id]);
    await saveDb();
    await writeMemoryMarkdown();
  });
  await deleteChromaMemory(id);
}

export async function clearAllMemory(filters: MemoryFilters = {}) {
  const database = await getDb();
  const ids = allRows(filters).map((entry) => entry.id);
  const where = buildMemoryWhere(filters);
  await enqueueWrite(async () => {
    database.run(`DELETE FROM memories ${where.sql}`, where.params);
    await saveDb();
    await writeMemoryMarkdown();
  });
  if (!ids.length || (!filters.kind && !filters.kinds?.length && !filters.dayKey)) {
    await wipeChromaCollection();
  } else {
    for (const id of ids) await deleteChromaMemory(id);
  }
}

void loadMemory();
