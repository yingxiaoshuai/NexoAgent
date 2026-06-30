import type { Application } from "express";
import { serverLog } from "../logger";
import { executeTask } from "../tasks";
import { createScheduledTask, ensureTasksLoaded, saveTasks, taskStore, validateCronExpression } from "../task-store";
import { toErrorMessage } from "../utils";
import type { ServerContext } from "./context";

export function registerTaskRoutes(app: Application, ctx: ServerContext) {
  app.get("/api/tasks", async (_req, res) => {
    await ensureTasksLoaded();
    res.json(taskStore);
  });

  app.post("/api/tasks", async (req, res) => {
    try {
      const task = await createScheduledTask(req.body as Record<string, unknown>);
      res.json(task);
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error) });
    }
  });

  app.patch("/api/tasks/:id", async (req, res) => {
    await ensureTasksLoaded();
    const t = taskStore.find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: "not found" });
    if (typeof req.body.cron === "string" && !validateCronExpression(req.body.cron)) {
      return res.status(400).json({ error: "Cron expression must have 5 valid fields." });
    }
    Object.assign(t, req.body);
    await saveTasks();
    return res.json(t);
  });

  app.post("/api/tasks/:id/run", async (req, res) => {
    await ensureTasksLoaded();
    const t = taskStore.find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: "not found" });
    try {
      const result = await executeTask(t, ctx.getStoredApiKey);
      ctx.onTaskFinished?.(result, { origin: "manual" });
      return res.json({ ok: true, ...result });
    } catch (error) {
      const message = toErrorMessage(error);
      serverLog(`ERROR Manual task failed: ${t.name}: ${message}`);
      return res.status(500).json({ error: message });
    }
  });

  app.delete("/api/tasks/:id", async (req, res) => {
    await ensureTasksLoaded();
    const idx = taskStore.findIndex((x) => x.id === req.params.id);
    if (idx !== -1) {
      taskStore.splice(idx, 1);
      await saveTasks();
    }
    res.json({ ok: true });
  });
}
