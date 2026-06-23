import type { Application } from "express";
import type { McpServerConfig, McpServerListItem, McpServerStatus } from "../../../src/shared/types";
import { listMcpServers, normalizeMcpServerConfig, saveMcpServers } from "../mcp-servers";
import { getMcpStatuses, refreshMcpRuntime, testMcpServer } from "../mcp-runtime";

function mergeRuntimeStatus(servers: McpServerConfig[], statuses: McpServerStatus[]): McpServerListItem[] {
  const statusByName = new Map(statuses.map((status) => [status.serverName, status]));
  return servers.map((server) => ({
    ...server,
    runtimeStatus: statusByName.get(server.name),
  }));
}

export function registerMcpServerRoutes(app: Application) {
  app.get("/api/mcp-servers", async (_req, res) => {
    const [servers, statuses] = await Promise.all([
      listMcpServers(),
      getMcpStatuses(),
    ]);
    res.json(mergeRuntimeStatus(servers, statuses));
  });

  app.post("/api/mcp-servers", async (req, res) => {
    const servers = req.body as McpServerConfig[];
    if (!Array.isArray(servers)) return res.status(400).json({ error: "array required" });
    const saved = await saveMcpServers(servers);
    await refreshMcpRuntime();
    res.json(saved);
  });

  app.post("/api/mcp-servers/test", async (req, res) => {
    const server = normalizeMcpServerConfig(req.body as McpServerConfig);
    if (!server.name || !server.command) {
      return res.status(400).json({ error: "\u670d\u52a1\u540d\u79f0\u548c\u547d\u4ee4\u4e0d\u80fd\u4e3a\u7a7a" });
    }

    const result = await testMcpServer(server);
    await refreshMcpRuntime().catch(() => undefined);
    res.json(result);
  });
}
