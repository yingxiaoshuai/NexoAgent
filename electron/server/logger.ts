import fs from "node:fs/promises";
import { LOG_DIR, LOG_FILE } from "./config";

export function serverLog(msg: string) {
  const line = new Date().toISOString() + " " + msg + "\n";
  void fs.mkdir(LOG_DIR, { recursive: true })
    .then(() => fs.appendFile(LOG_FILE, line))
    .catch(() => {});
}
