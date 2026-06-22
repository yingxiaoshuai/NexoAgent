import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function uniquePaths(paths: string[]) {
  return [...new Set(paths.map((value) => path.resolve(value)))];
}

function scoreDataDir(dir: string) {
  const markers = [
    "sessions.json",
    "memory.sqlite",
    "skills.json",
    "tasks.json",
    "model-profiles.json",
  ];
  return markers.reduce((score, file) => (
    score + (fs.existsSync(path.join(dir, file)) ? 1 : 0)
  ), 0);
}

function hasDirectoryContents(dir: string) {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

function pickBestLegacyDir(candidates: string[]) {
  const ranked = candidates
    .map((dir) => ({ dir, score: scoreDataDir(dir) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.dir ?? "";
}

function copyLegacyDataDir(sourceDir: string, targetDir: string) {
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.cpSync(sourceDir, targetDir, {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
    return true;
  } catch {
    return false;
  }
}

function resolveDataDir() {
  const envDir = process.env.NEXO_DATA_DIR?.trim();
  if (envDir) {
    return path.resolve(envDir);
  }

  const preferredUserDir = path.join(os.homedir(), ".NexoAgent");
  const legacyAppDataDir = process.env.APPDATA
    ? path.join(process.env.APPDATA, "nexo-agent", ".nexo-data")
    : path.join(os.homedir(), ".nexo-agent", ".nexo-data");
  const legacyCandidates = uniquePaths([
    path.join(process.cwd(), ".nexo-data"),
    path.resolve(__dirname, "..", "..", ".nexo-data"),
    path.resolve(__dirname, "..", "..", "..", ".nexo-data"),
    legacyAppDataDir,
  ]);

  if (scoreDataDir(preferredUserDir) > 0 || hasDirectoryContents(preferredUserDir)) {
    return preferredUserDir;
  }

  const legacyDir = pickBestLegacyDir(legacyCandidates);
  if (legacyDir) {
    if (copyLegacyDataDir(legacyDir, preferredUserDir)) {
      return preferredUserDir;
    }
    return legacyDir;
  }

  return preferredUserDir;
}

export const DATA_DIR = resolveDataDir();
export const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
export const KNOWLEDGE_DIR = path.join(DATA_DIR, "knowledge");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const LOG_FILE = path.join(DATA_DIR, "app.log");
export const TOOL_SETTINGS_FILE = path.join(DATA_DIR, "tools.json");
export const MCP_SERVERS_FILE = path.join(DATA_DIR, "mcp-servers.json");
export const MODEL_PROFILES_FILE = path.join(DATA_DIR, "model-profiles.json");
export const MODEL_CONTEXT_CACHE_FILE = path.join(DATA_DIR, "model-context-cache.json");
export const SKILLS_FILE = path.join(DATA_DIR, "skills.json");
export const SKILL_STATE_FILE = path.join(DATA_DIR, "skill-state.json");
export const MANAGED_SKILLS_DIR = path.join(DATA_DIR, "skills");
export const MANAGED_CUSTOM_SKILLS_DIR = path.join(MANAGED_SKILLS_DIR, "custom");
export const MANAGED_MARKETPLACE_SKILLS_DIR = path.join(MANAGED_SKILLS_DIR, "marketplace");
export const TASKS_FILE = path.join(DATA_DIR, "tasks.json");
