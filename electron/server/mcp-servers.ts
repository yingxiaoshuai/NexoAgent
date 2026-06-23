import fs from "node:fs/promises";
import type { McpServerConfig } from "../../src/shared/types";
import { DATA_DIR, MCP_SERVERS_FILE } from "./config";

export function normalizeMcpServerConfig(server: McpServerConfig): McpServerConfig {
  return {
    name: typeof server.name === "string" ? server.name.trim() : "",
    command: typeof server.command === "string" ? server.command.trim() : "",
    args: Array.isArray(server.args) ? server.args.map((arg) => String(arg)) : [],
    ...(server.env && typeof server.env === "object" ? { env: Object.fromEntries(Object.entries(server.env).map(([k, v]) => [k, String(v)])) } : {}),
  };
}

export function normalizeMcpServers(servers: McpServerConfig[]) {
  return servers
    .map((server) => normalizeMcpServerConfig(server))
    .filter((server) => server.name && server.command);
}

async function readServers(): Promise<McpServerConfig[]> {
  try {
    const raw = await fs.readFile(MCP_SERVERS_FILE, "utf8");
    const parsed = JSON.parse(raw) as McpServerConfig[];
    return Array.isArray(parsed) ? normalizeMcpServers(parsed) : [];
  } catch {
    return [];
  }
}

async function writeServers(servers: McpServerConfig[]) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(MCP_SERVERS_FILE, JSON.stringify(servers, null, 2), "utf8");
}

export async function listMcpServers() {
  return readServers();
}

export async function saveMcpServers(servers: McpServerConfig[]) {
  const normalized = normalizeMcpServers(servers);
  await writeServers(normalized);
  return normalized;
}
