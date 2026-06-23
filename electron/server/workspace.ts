import path from "node:path";
import type { AgentSettings } from "../../src/shared/types";
import { getWebSettings } from "./settings";

export function getWorkspaceRoot(settings: AgentSettings) {
  const configured = settings.workspacePath || getWebSettings().workspacePath || process.cwd();
  return path.resolve(configured);
}

function normalizePathForCompare(value: string) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isUnderRoot(target: string, root: string) {
  const normalizedRoot = normalizePathForCompare(root);
  const normalizedTarget = normalizePathForCompare(target);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + path.sep);
}

export function getAllowedFileRoots(settings: AgentSettings) {
  const primary = getWorkspaceRoot(settings);
  const extras = (settings.fileAccessRoots ?? getWebSettings().fileAccessRoots ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
  const roots: string[] = [];
  for (const candidate of [primary, ...extras]) {
    if (!roots.some((existing) => isUnderRoot(candidate, existing))) {
      roots.push(candidate);
    }
  }
  return roots;
}

export function isPathInsideWorkspace(inputPath: string, settings: AgentSettings) {
  void inputPath;
  void settings;
  return true;
}

export function resolveWorkspacePath(inputPath: string, settings: AgentSettings) {
  const primary = getWorkspaceRoot(settings);
  const target = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(primary, inputPath);
  return { root: primary, target };
}
