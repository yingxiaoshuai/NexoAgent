import type { Application } from "express";
import {
  ensureToolsLoaded,
  getAllToolDefs,
  getAllToolMap,
  isToolEnabled,
  saveToolSettings,
  setToolEnabled,
} from "../tools/registry";
import { getMcpStatuses } from "../mcp-runtime";

export function registerToolRoutes(app: Application) {
  app.get("/api/tools", async (_req, res) => {
    await ensureToolsLoaded();
    const [tools, mcpStatuses] = await Promise.all([
      getAllToolDefs(),
      getMcpStatuses(),
    ]);
    const statusByServer = new Map(mcpStatuses.map((item) => [item.serverName, item]));
    const payload = tools.map((tool) => {
      const mcpStatus = tool.sourceServerName ? statusByServer.get(tool.sourceServerName) : undefined;
      return {
        name: tool.name,
        label: tool.label,
        group: tool.group,
        description: tool.description,
        enabled: tool.group === "mcp" ? true : isToolEnabled(tool.name),
        ...(tool.group === "mcp"
          ? {
              source: "mcp",
              sourceServerName: tool.sourceServerName,
              mcpStatus: mcpStatus?.status ?? "connected",
              mcpError: mcpStatus?.error,
            }
          : {}),
      };
    });
    res.json(payload);
  });

  app.post("/api/tools", async (req, res) => {
    await ensureToolsLoaded();
    const { name, enabled } = req.body;
    const toolMap = await getAllToolMap();
    const target = toolMap.get(name);
    if (!target) return res.status(400).json({ error: "unknown tool" });
    if (target.group === "mcp") return res.status(400).json({ error: "mcp tools are always enabled" });
    setToolEnabled(name, enabled);
    await saveToolSettings();
    return res.json({ ok: true });
  });
}
