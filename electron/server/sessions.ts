import fs from "node:fs/promises";
import { DATA_DIR, SESSIONS_FILE } from "./config";
import type { Session } from "./types";

const sessions = new Map<string, Session>();
let sessionsLoaded = false;
let loadSessionsPromise: Promise<void> | null = null;

export function getSessionsMap() {
  return sessions;
}

export function getSession(id: string) {
  return sessions.get(id);
}

export async function loadSessionsFromDisk(force = false) {
  if (sessionsLoaded && !force) return;
  if (loadSessionsPromise && !force) return loadSessionsPromise;

  loadSessionsPromise = (async () => {
    try {
      const raw = await fs.readFile(SESSIONS_FILE, "utf8");
      const arr = JSON.parse(raw) as Session[];
      sessions.clear();
      for (const s of arr) sessions.set(s.id, s);
    } catch {
      if (force) {
        throw new Error("Failed to reload sessions from disk.");
      }
      /* first run */
    } finally {
      sessionsLoaded = true;
      loadSessionsPromise = null;
    }
  })();

  return loadSessionsPromise;
}

export async function ensureSessionsLoaded() {
  await loadSessionsFromDisk();
  if (sessions.size > 0) return;

  try {
    const raw = await fs.readFile(SESSIONS_FILE, "utf8");
    const arr = JSON.parse(raw) as Session[];
    if (Array.isArray(arr) && arr.length > 0) {
      sessions.clear();
      for (const s of arr) sessions.set(s.id, s);
    }
  } catch {
    // Keep the current in-memory state when the fallback read also fails.
  }
}

export async function saveSessionsToDisk() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SESSIONS_FILE, JSON.stringify([...sessions.values()], null, 2));
}

void loadSessionsFromDisk();
