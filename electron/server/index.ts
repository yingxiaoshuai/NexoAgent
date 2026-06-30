import type { Application } from "express";
import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { serverLog } from "./logger";
import { registerRoutes } from "./routes";
import { startTaskScheduler, type TaskExecutionOrigin, type TaskExecutionResult } from "./tasks";

export { serverLog } from "./logger";
export type { StreamEvent } from "./types";

interface ExpressAppOptions {
  onTaskFinished?: (result: TaskExecutionResult, meta: { origin: TaskExecutionOrigin }) => void;
}

export function createExpressApp(getStoredApiKey: () => string, options: ExpressAppOptions = {}): Application {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.text({ type: ["text/*", "application/xml", "*/xml"] }));
  startTaskScheduler(getStoredApiKey, options.onTaskFinished);

  const distCandidates = [
    path.join(process.cwd(), "dist"),
    path.join(__dirname, "..", "..", "..", "dist"),
    path.join(__dirname, "..", "..", "dist")
  ];
  const distPath = distCandidates.find((candidate) => fs.existsSync(path.join(candidate, "index.html"))) ?? distCandidates[0];
  app.use(express.static(distPath));

  const ctx = { getStoredApiKey, distPath, onTaskFinished: options.onTaskFinished };
  registerRoutes(app, ctx);

  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) {
      res.status(404).json({ error: `Unknown API route: ${req.path}` });
      return;
    }
    res.sendFile(path.join(distPath, "index.html"));
  });

  return app;
}
