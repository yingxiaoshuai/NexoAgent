import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function uniquePaths(paths: string[]) {
  return [...new Set(paths.map((value) => path.resolve(value)))];
}

function legacyDataDirCandidates() {
  const legacyAppDataDir = process.env.APPDATA
    ? path.join(process.env.APPDATA, "nexo-agent", ".nexo-data")
    : path.join(os.homedir(), ".nexo-agent", ".nexo-data");
  return uniquePaths([
    path.join(process.cwd(), ".nexo-data"),
    path.resolve(__dirname, "..", "..", ".nexo-data"),
    path.resolve(__dirname, "..", "..", "..", ".nexo-data"),
    legacyAppDataDir,
  ]);
}

export function getDefaultDataDir() {
  return path.join(os.homedir(), ".NexoAgent");
}

function mergeLegacyDataDirs(targetDir: string) {
  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch {
    return;
  }

  for (const legacyDir of legacyDataDirCandidates()) {
    if (path.resolve(legacyDir) === path.resolve(targetDir)) continue;
    if (!fs.existsSync(legacyDir)) continue;
    try {
      fs.cpSync(legacyDir, targetDir, {
        recursive: true,
        force: false,
        errorOnExist: false,
      });
    } catch {
      // Best-effort migration; ~/.NexoAgent remains the canonical location.
    }
  }
}

function resolveDataDir() {
  const envDir = process.env.NEXO_DATA_DIR?.trim();
  if (envDir) {
    return path.resolve(envDir);
  }

  const dataDir = getDefaultDataDir();
  mergeLegacyDataDirs(dataDir);
  return dataDir;
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
export const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
export const MEMORY_DB_FILE = path.join(DATA_DIR, "memory.sqlite");
export const MEMORY_JSON_FILE = path.join(DATA_DIR, "memory.json");
export const MEMORY_MD_FILE = path.join(DATA_DIR, "MEMORY.md");
export const CHROMA_DIR = path.join(DATA_DIR, "chroma");
