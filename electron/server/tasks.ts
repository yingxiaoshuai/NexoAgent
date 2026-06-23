import { randomUUID } from "node:crypto";
import type { ChatMessage } from "../../src/shared/types";
import { streamFromLLM } from "./agent";
import { clearRun, registerRun } from "./run-control";
import { serverLog } from "./logger";
import { buildRuntimeSettings } from "./settings";
import { ensureSessionsLoaded, getSessionsMap, saveSessionsToDisk } from "./sessions";
import { createSseQueue, scheduleSseCleanup } from "./sse";
import { ensureTasksLoaded, saveTasks, taskStore } from "./task-store";
import type { ScheduledTask, Session } from "./types";
import { toErrorMessage } from "./utils";

function cronFieldMatches(field: string, value: number, min: number, max: number) {
  return field.split(",").some((part) => {
    const item = part.trim();
    if (!item) return false;
    if (item === "*") return true;

    const [rangePart, stepPart] = item.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step <= 0) return false;

    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [rawStart, rawEnd] = rangePart.split("-").map(Number);
      start = rawStart;
      end = rawEnd;
    } else {
      start = Number(rangePart);
      end = Number(rangePart);
    }

    if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
    if (value < start || value > end) return false;
    return (value - start) % step === 0;
  });
}

function cronMatches(cron: string, date: Date) {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return cronFieldMatches(minute, date.getMinutes(), 0, 59)
    && cronFieldMatches(hour, date.getHours(), 0, 23)
    && cronFieldMatches(dayOfMonth, date.getDate(), 1, 31)
    && cronFieldMatches(month, date.getMonth() + 1, 1, 12)
    && cronFieldMatches(dayOfWeek, date.getDay(), 0, 7);
}

function taskIsDue(task: ScheduledTask, now: Date) {
  if (task.runOnce && task.runAt) {
    if (task.lastRun) return false;
    const runAt = new Date(task.runAt);
    return !Number.isNaN(runAt.getTime()) && now.getTime() >= runAt.getTime();
  }

  if (now.getSeconds() > 5) return false;
  return cronMatches(task.cron, now);
}

export async function executeTask(task: ScheduledTask, getStoredApiKey: () => string) {
  await ensureTasksLoaded();
  await ensureSessionsLoaded();
  const now = new Date().toISOString();
  const sessionId = randomUUID();
  const requestId = randomUUID();
  const userMsg: ChatMessage = {
    id: randomUUID(),
    role: "user",
    content: task.prompt,
    createdAt: now,
    status: "completed",
  };

  const session: Session = {
    id: sessionId,
    title: `[任务] ${task.name}`,
    messages: [userMsg],
    createdAt: now,
    updatedAt: now,
  };
  getSessionsMap().set(sessionId, session);
  registerRun(requestId);
  createSseQueue(requestId);

  const settings = buildRuntimeSettings();
  const doneEvent = await streamFromLLM(settings, session, requestId, getStoredApiKey());
  session.messages.push({
    id: randomUUID(),
    role: "assistant",
    content: doneEvent.content,
    createdAt: new Date().toISOString(),
    status: doneEvent.status,
  });
  session.updatedAt = new Date().toISOString();
  task.lastRun = session.updatedAt;
  if (task.runOnce) {
    task.enabled = false;
  }
  await saveTasks();
  await saveSessionsToDisk();
  clearRun(requestId);
  scheduleSseCleanup(requestId);
  serverLog(`INFO Task executed: ${task.name}`);
}

let taskSchedulerTimer: ReturnType<typeof setInterval> | null = null;
const runningTasks = new Set<string>();

export function startTaskScheduler(getStoredApiKey: () => string) {
  if (taskSchedulerTimer) return;
  void ensureTasksLoaded();
  taskSchedulerTimer = setInterval(() => {
    void ensureTasksLoaded();
    const now = new Date();

    for (const task of taskStore) {
      if (!task.enabled || runningTasks.has(task.id) || !taskIsDue(task, now)) continue;
      const minuteKey = now.toISOString().slice(0, 16);
      if (task.lastRun?.slice(0, 16) === minuteKey) continue;
      runningTasks.add(task.id);
      void executeTask(task, getStoredApiKey)
        .catch((error) => serverLog(`ERROR Task failed: ${task.name}: ${toErrorMessage(error)}`))
        .finally(() => runningTasks.delete(task.id));
    }
  }, 1000);
  taskSchedulerTimer.unref?.();
}
