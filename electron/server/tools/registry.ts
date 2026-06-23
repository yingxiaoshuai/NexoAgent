import fs from "node:fs/promises";
import { readBundledJson } from "../bundled-config";
import { DATA_DIR, TOOL_SETTINGS_FILE } from "../config";
import { getMcpToolDefs, getMcpToolMap } from "../mcp-runtime";
import type { ToolDef } from "../types";
import { TOOL_EXECUTORS } from "./executors";

interface BundledToolMeta {
  name: string;
  label: string;
  group: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface BundledToolsFile {
  version: number;
  defaultEnabled: string[];
  tools: BundledToolMeta[];
}

let bundledToolsFile: BundledToolsFile | null = null;
let toolDefs: ToolDef[] = [];
let toolMap = new Map<string, ToolDef>();
const enabledTools = new Set<string>();

const TOOL_SETTINGS_VERSION = 9;
const DEFAULT_TOOL_MIGRATIONS: Record<number, string[]> = {
  9: ["shell_command", "invoke_model", "recall_memory"],
};

async function loadBundledToolsFile() {
  if (bundledToolsFile) return bundledToolsFile;
  bundledToolsFile = await readBundledJson<BundledToolsFile>("tools.json");
  return bundledToolsFile;
}

async function buildToolRegistry() {
  const bundled = await loadBundledToolsFile();
  toolDefs = bundled.tools.map((tool) => {
    const execute = TOOL_EXECUTORS[tool.name];
    if (!execute) {
      throw new Error(`Missing executor for bundled tool: ${tool.name}`);
    }
    return { ...tool, execute };
  });
  toolMap = new Map(toolDefs.map((tool) => [tool.name, tool]));
  return bundled;
}

export const toLcTool = (tool: ToolDef) => ({
  type: "function" as const,
  function: { name: tool.name, description: tool.description, parameters: tool.parameters },
});

export async function loadToolSettings() {
  const bundled = await buildToolRegistry();

  try {
    const raw = await fs.readFile(TOOL_SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw) as string[] | { version?: number; enabled?: string[] };
    const names = Array.isArray(parsed) ? parsed : Array.isArray(parsed.enabled) ? parsed.enabled : [];
    const settingsVersion = Array.isArray(parsed) ? 1 : typeof parsed.version === "number" ? parsed.version : 1;
    enabledTools.clear();
    let normalized = false;
    for (const name of names) {
      if (toolMap.has(name)) enabledTools.add(name);
      else normalized = true;
    }

    let migrated = false;
    for (const [versionText, toolNames] of Object.entries(DEFAULT_TOOL_MIGRATIONS)) {
      const migrationVersion = Number(versionText);
      if (settingsVersion >= migrationVersion) continue;
      for (const name of toolNames) {
        if (bundled.defaultEnabled.includes(name) && toolMap.has(name) && !enabledTools.has(name)) {
          enabledTools.add(name);
          migrated = true;
        }
      }
    }

    if (normalized || migrated || settingsVersion < TOOL_SETTINGS_VERSION) {
      await saveToolSettings();
    }
  } catch {
    enabledTools.clear();
    for (const name of bundled.defaultEnabled) {
      if (toolMap.has(name)) enabledTools.add(name);
    }
    await saveToolSettings();
  }
}

export async function saveToolSettings() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    TOOL_SETTINGS_FILE,
    JSON.stringify({ version: TOOL_SETTINGS_VERSION, enabled: [...enabledTools] }, null, 2),
    "utf8"
  );
}

export async function ensureToolsLoaded() {
  if (!toolDefs.length) {
    await loadToolSettings();
  }
}

export function getToolDefs() {
  return toolDefs;
}

export function getToolMap() {
  return toolMap;
}

export function getEnabledToolDefs() {
  return toolDefs.filter((tool) => enabledTools.has(tool.name));
}

export async function getAllToolDefs() {
  await ensureToolsLoaded();
  const mcpTools = await getMcpToolDefs();
  return [...toolDefs, ...mcpTools];
}

export async function getAllToolMap() {
  await ensureToolsLoaded();
  const all = new Map<string, ToolDef>(toolMap);
  for (const [name, tool] of (await getMcpToolMap()).entries()) {
    all.set(name, tool);
  }
  return all;
}

export async function getAllEnabledToolDefs() {
  await ensureToolsLoaded();
  const mcpTools = await getMcpToolDefs();
  return [...getEnabledToolDefs(), ...mcpTools];
}

export function isToolEnabled(name: string) {
  return enabledTools.has(name);
}

export function setToolEnabled(name: string, enabled: boolean) {
  if (enabled) enabledTools.add(name);
  else enabledTools.delete(name);
}

void ensureToolsLoaded();
