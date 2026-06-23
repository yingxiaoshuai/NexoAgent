import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { SNAPSHOTS_DIR } from "./config";

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".yaml", ".yml",
  ".css", ".html", ".py", ".go", ".rs", ".toml", ".env", ".gitignore",
  ".xml", ".svg", ".txt", ".c", ".h", ".cpp", ".hpp", ".java", ".rb",
  ".php", ".sh", ".bash", ".zsh", ".ps1", ".psm1", ".cs", ".csproj",
  ".sln", ".vb", ".fs", ".fsx", ".scss", ".less", ".sql", ".graphql",
  ".prisma", ".proto", ".vue", ".svelte", ".astro", ".mjs", ".cjs",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".nexo-data", "dist", "dist-electron",
  ".vite-cache", "__pycache__", ".venv", "venv", ".next", ".nuxt",
  "build", "coverage", ".turbo", ".cache",
]);

const KNOWN_NAMES = new Set([
  "Dockerfile", "Makefile", ".gitignore", ".env", ".eslintrc",
  ".prettierrc", ".babelrc", ".editorconfig", "LICENSE",
]);

const MAX_SNAPSHOT_FILES = 5_000;
const MAX_SNAPSHOT_AGE_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_META_FILE = "snapshot_meta.json";

type SnapshotMeta = {
  workspaceRoot: string;
  createdAt: string;
  files: string[];
};

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  return KNOWN_NAMES.has(path.basename(filePath));
}

function shouldSkipDir(dirname: string): boolean {
  return SKIP_DIRS.has(dirname);
}

async function collectTextFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const stack: string[] = [root];

  while (stack.length > 0 && result.length < MAX_SNAPSHOT_FILES) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) {
          stack.push(fullPath);
        }
      } else if (entry.isFile() && isTextFile(fullPath)) {
        result.push(fullPath);
        if (result.length >= MAX_SNAPSHOT_FILES) break;
      }
    }
  }

  return result;
}

function getSessionSnapshotDir(sessionId: string): string {
  return path.join(SNAPSHOTS_DIR, sessionId);
}

function getSnapshotDir(sessionId: string, turnId: string): string {
  return path.join(getSessionSnapshotDir(sessionId), turnId);
}

function validatePath(relativePath: string, workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot, relativePath);
  const normalizedRoot = path.resolve(workspaceRoot);
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    throw new Error(`Path traversal detected: ${relativePath}`);
  }
  return resolved;
}

async function listSessionSnapshotEntries(sessionId: string): Promise<Array<{ turnId: string; turnDir: string; mtimeMs: number }>> {
  const sessionDir = getSessionSnapshotDir(sessionId);
  let turnIds: string[];
  try {
    turnIds = await fsp.readdir(sessionDir);
  } catch {
    return [];
  }

  const entries = await Promise.all(turnIds.map(async (turnId) => {
    const turnDir = path.join(sessionDir, turnId);
    try {
      const stat = await fsp.stat(turnDir);
      if (!stat.isDirectory()) return null;
      return { turnId, turnDir, mtimeMs: stat.mtimeMs };
    } catch {
      return null;
    }
  }));

  return entries
    .filter((entry): entry is { turnId: string; turnDir: string; mtimeMs: number } => Boolean(entry))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function walkSnapshotFiles(dir: string, base: string): Promise<string[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(base, fullPath);
    if (entry.isFile()) {
      if (relativePath !== SNAPSHOT_META_FILE) {
        files.push(relativePath);
      }
    } else if (entry.isDirectory()) {
      files.push(...await walkSnapshotFiles(fullPath, base));
    }
  }
  return files;
}

export async function getLatestSnapshotTurnId(sessionId: string): Promise<string | null> {
  const entries = await listSessionSnapshotEntries(sessionId);
  return entries[0]?.turnId ?? null;
}

export async function clearSessionSnapshots(sessionId: string, exceptTurnId?: string): Promise<void> {
  const sessionDir = getSessionSnapshotDir(sessionId);
  const entries = await listSessionSnapshotEntries(sessionId);

  await Promise.all(
    entries
      .filter((entry) => entry.turnId !== exceptTurnId)
      .map((entry) => fsp.rm(entry.turnDir, { recursive: true, force: true }).catch(() => undefined)),
  );

  try {
    const remaining = await fsp.readdir(sessionDir);
    if (remaining.length === 0) {
      await fsp.rm(sessionDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup failures.
  }
}

export async function getSnapshotMeta(sessionId: string, turnId: string): Promise<SnapshotMeta | null> {
  const snapshotDir = getSnapshotDir(sessionId, turnId);
  try {
    const raw = await fsp.readFile(path.join(snapshotDir, SNAPSHOT_META_FILE), "utf8");
    return JSON.parse(raw) as SnapshotMeta;
  } catch {
    return null;
  }
}

export async function createSnapshot(
  sessionId: string,
  turnId: string,
  workspaceRoot: string,
): Promise<{ turnId: string; fileCount: number } | null> {
  const snapshotDir = getSnapshotDir(sessionId, turnId);

  try {
    await fsp.rm(snapshotDir, { recursive: true, force: true });
  } catch {
    // Ignore best-effort cleanup failures.
  }

  const textFiles = await collectTextFiles(workspaceRoot);
  if (textFiles.length === 0) return null;
  const relativeFiles = textFiles.map((filePath) => path.relative(workspaceRoot, filePath));

  await fsp.mkdir(snapshotDir, { recursive: true });
  await fsp.writeFile(
    path.join(snapshotDir, SNAPSHOT_META_FILE),
    JSON.stringify({ workspaceRoot, createdAt: new Date().toISOString(), files: relativeFiles }),
    "utf8",
  );

  let copiedCount = 0;
  for (let index = 0; index < textFiles.length; index++) {
    try {
      const filePath = textFiles[index];
      const relativePath = relativeFiles[index];
      const destPath = path.join(snapshotDir, relativePath);
      await fsp.mkdir(path.dirname(destPath), { recursive: true });
      await fsp.copyFile(filePath, destPath);
      copiedCount++;
    } catch {
      // Skip unreadable files.
    }
  }

  return { turnId, fileCount: copiedCount };
}

export function hasSnapshot(sessionId: string, turnId: string): boolean {
  const snapshotDir = getSnapshotDir(sessionId, turnId);
  try {
    return fs.existsSync(path.join(snapshotDir, SNAPSHOT_META_FILE));
  } catch {
    return false;
  }
}

export async function restoreSnapshot(
  sessionId: string,
  turnId: string,
  workspaceRoot: string,
): Promise<{ restoredCount: number }> {
  const snapshotDir = getSnapshotDir(sessionId, turnId);
  if (!fs.existsSync(snapshotDir)) {
    throw new Error("no_snapshot");
  }

  const meta = await getSnapshotMeta(sessionId, turnId);
  if (!meta) {
    throw new Error("no_snapshot");
  }

  const snapshotFiles = meta.files?.length
    ? meta.files
    : await walkSnapshotFiles(snapshotDir, snapshotDir);
  const snapshotFileSet = new Set(snapshotFiles);

  let restoredCount = 0;
  const currentTextFiles = await collectTextFiles(workspaceRoot);
  for (const filePath of currentTextFiles) {
    const relativePath = path.relative(workspaceRoot, filePath);
    if (snapshotFileSet.has(relativePath)) continue;
    try {
      await fsp.rm(validatePath(relativePath, workspaceRoot), { force: true });
      restoredCount++;
    } catch {
      // Skip files we cannot delete.
    }
  }

  for (const relativePath of snapshotFiles) {
    try {
      const targetPath = validatePath(relativePath, workspaceRoot);
      const sourcePath = path.join(snapshotDir, relativePath);
      await fsp.mkdir(path.dirname(targetPath), { recursive: true });
      await fsp.copyFile(sourcePath, targetPath);
      restoredCount++;
    } catch {
      // Skip files we cannot restore.
    }
  }

  await fsp.rm(snapshotDir, { recursive: true, force: true });
  return { restoredCount };
}

export async function cleanupOldSnapshots(maxAgeMs: number = MAX_SNAPSHOT_AGE_MS): Promise<void> {
  try {
    if (!fs.existsSync(SNAPSHOTS_DIR)) return;

    const sessionDirs = await fsp.readdir(SNAPSHOTS_DIR);
    const now = Date.now();

    for (const sessionId of sessionDirs) {
      const sessionDir = path.join(SNAPSHOTS_DIR, sessionId);
      try {
        const stat = await fsp.stat(sessionDir);
        if (stat.isDirectory() && (now - stat.mtimeMs) > maxAgeMs) {
          await fsp.rm(sessionDir, { recursive: true, force: true });
          continue;
        }

        const turnDirs = await fsp.readdir(sessionDir);
        for (const turnId of turnDirs) {
          const turnDir = path.join(sessionDir, turnId);
          try {
            const turnStat = await fsp.stat(turnDir);
            if (turnStat.isDirectory() && (now - turnStat.mtimeMs) > maxAgeMs) {
              await fsp.rm(turnDir, { recursive: true, force: true });
            }
          } catch {
            // Ignore per-turn cleanup failures.
          }
        }

        try {
          const remaining = await fsp.readdir(sessionDir);
          if (remaining.length === 0) {
            await fsp.rm(sessionDir, { recursive: true, force: true });
          }
        } catch {
          // Ignore post-cleanup scan failures.
        }
      } catch {
        // Ignore per-session cleanup failures.
      }
    }
  } catch {
    // Best-effort cleanup only.
  }
}
