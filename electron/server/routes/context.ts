import type { TaskExecutionOrigin, TaskExecutionResult } from "../tasks";

export interface ServerContext {
  getStoredApiKey: () => string;
  distPath: string;
  onTaskFinished?: (result: TaskExecutionResult, meta: { origin: TaskExecutionOrigin }) => void;
}
