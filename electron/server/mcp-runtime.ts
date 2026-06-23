import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import type { McpServerConfig, McpServerStatus } from "../../src/shared/types";
import type { ToolDef, ToolExecutionContext } from "./types";
import { listMcpServers, normalizeMcpServerConfig, normalizeMcpServers } from "./mcp-servers";
import { toErrorMessage } from "./utils";

type SafeServerEntry = {
  key: string;
  displayName: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
};

type CachedRuntime = {
  client: MultiServerMCPClient;
  toolDefs: ToolDef[];
  toolMap: Map<string, ToolDef>;
  statuses: McpServerStatus[];
  fingerprint: string;
};

const UI = {
  connectFailed: "\u672a\u80fd\u8fde\u63a5\u5230 MCP \u670d\u52a1",
  connectedButEmpty: "\u5df2\u8fde\u63a5\uff0c\u4f46\u672a\u53d1\u73b0\u53ef\u7528\u5de5\u5177",
  unnamedServer: "\u672a\u547d\u540d\u670d\u52a1",
  missingNameOrCommand: "\u670d\u52a1\u540d\u79f0\u548c\u547d\u4ee4\u4e0d\u80fd\u4e3a\u7a7a",
} as const;

let cachedRuntime: CachedRuntime | null = null;
let cachedFingerprint = "";
let loadingRuntime: Promise<CachedRuntime> | null = null;

function normalizeServerName(name: string) {
  const compact = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return compact || "server";
}

function toSafeServerEntries(servers: McpServerConfig[]): SafeServerEntry[] {
  const used = new Set<string>();
  return servers.map((server) => {
    const base = normalizeServerName(server.name);
    let key = base;
    let index = 2;
    while (used.has(key)) {
      key = `${base}_${index}`;
      index += 1;
    }
    used.add(key);
    return {
      key,
      displayName: server.name,
      command: server.command,
      args: server.args,
      env: server.env,
    };
  });
}

function buildFingerprint(servers: McpServerConfig[]) {
  return JSON.stringify(
    servers
      .map((server) => ({
        name: server.name.trim(),
        command: server.command.trim(),
        args: Array.isArray(server.args) ? server.args.map((arg) => String(arg)) : [],
        env:
          server.env && typeof server.env === "object"
            ? Object.fromEntries(Object.entries(server.env).map(([key, value]) => [key, String(value)]))
            : undefined,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  );
}

function normalizeServers(servers: McpServerConfig[]) {
  return normalizeMcpServers(servers);
}

function asJsonSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") {
    return { type: "object", properties: {} };
  }
  if (
    "_def" in (schema as Record<string, unknown>) ||
    "_zod" in (schema as Record<string, unknown>) ||
    "~standard" in (schema as Record<string, unknown>)
  ) {
    return toJsonSchema(schema as Parameters<typeof toJsonSchema>[0]) as Record<string, unknown>;
  }
  return schema as Record<string, unknown>;
}

function stringifyToolOutput(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    return output.map((item) => stringifyToolOutput(item)).filter(Boolean).join("\n");
  }
  if (typeof output === "object") {
    const block = output as Record<string, unknown>;
    if (typeof block.text === "string") return block.text;
    if (Array.isArray(block.content)) return stringifyToolOutput(block.content);
    if (typeof block.content === "string") return block.content;
    if ("artifact" in block && block.artifact !== undefined) {
      return JSON.stringify(block, null, 2);
    }
    return JSON.stringify(block, null, 2);
  }
  return String(output);
}

function buildClientServerConfig(safeServers: SafeServerEntry[]) {
  return Object.fromEntries(
    safeServers.map((server) => [
      server.key,
      {
        transport: "stdio" as const,
        command: server.command,
        args: server.args,
        env: server.env,
        stderr: "inherit" as const,
        restart: {
          enabled: true,
          maxAttempts: 2,
          delayMs: 1000,
        },
      },
    ])
  );
}

function createFallbackClient() {
  return new MultiServerMCPClient({
    mcpServers: {
      __placeholder__: {
        transport: "stdio",
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
      },
    },
    onConnectionError: "ignore",
  });
}

async function getServerConnectionState(
  client: MultiServerMCPClient,
  server: SafeServerEntry,
  rawTools: DynamicStructuredTool[]
) {
  if (rawTools.length > 0) {
    return {
      connected: true,
      error: undefined,
    };
  }

  try {
    const serverClient = await client.getClient(server.key);
    if (serverClient) {
      return {
        connected: true,
        error: undefined,
      };
    }
  } catch (error) {
    return {
      connected: false,
      error: toErrorMessage(error),
    };
  }

  return {
    connected: false,
    error: UI.connectFailed,
  };
}

function buildServerStatus(
  server: SafeServerEntry,
  rawTools: DynamicStructuredTool[],
  connected: boolean,
  error?: string
): McpServerStatus {
  const toolNames = rawTools.map((tool) => tool.name);
  if (toolNames.length > 0) {
    return {
      serverName: server.displayName,
      toolCount: toolNames.length,
      status: "connected",
      toolNames,
    };
  }

  if (connected) {
    return {
      serverName: server.displayName,
      toolCount: 0,
      status: "empty",
      error: error || UI.connectedButEmpty,
      toolNames: [],
    };
  }

  return {
    serverName: server.displayName,
    toolCount: 0,
    status: "error",
    error: error || UI.connectFailed,
    toolNames: [],
  };
}

async function buildRuntime(): Promise<CachedRuntime> {
  const servers = normalizeServers(await listMcpServers());
  const fingerprint = buildFingerprint(servers);
  const safeServers = toSafeServerEntries(servers);

  if (!servers.length) {
    return {
      client: createFallbackClient(),
      toolDefs: [],
      toolMap: new Map<string, ToolDef>(),
      statuses: [],
      fingerprint,
    };
  }

  const client = new MultiServerMCPClient({
    mcpServers: buildClientServerConfig(safeServers),
    throwOnLoadError: false,
    prefixToolNameWithServerName: true,
    additionalToolNamePrefix: "mcp",
    useStandardContentBlocks: true,
    defaultToolTimeout: 120_000,
    onConnectionError: "ignore",
  });

  let toolsByServer: Record<string, DynamicStructuredTool[]> = {};
  try {
    toolsByServer = await client.initializeConnections();
  } catch {
    toolsByServer = {};
  }

  const statuses: McpServerStatus[] = [];
  const toolDefs: ToolDef[] = [];

  for (const server of safeServers) {
    const rawTools = toolsByServer[server.key] ?? [];
    const connectionState = await getServerConnectionState(client, server, rawTools);
    statuses.push(buildServerStatus(server, rawTools, connectionState.connected, connectionState.error));

    for (const rawTool of rawTools) {
      const parameters = asJsonSchema(rawTool.schema);
      toolDefs.push({
        name: rawTool.name,
        label: rawTool.name.replace(/^mcp__/, ""),
        group: "mcp",
        description: rawTool.description || `MCP tool from ${server.displayName}`,
        parameters,
        sourceServerName: server.displayName,
        execute: async (args: Record<string, unknown>, _ctx: ToolExecutionContext) => {
          const result = await rawTool.invoke(args);
          return stringifyToolOutput(result);
        },
      });
    }
  }

  const toolMap = new Map(toolDefs.map((tool) => [tool.name, tool]));

  return {
    client,
    toolDefs,
    toolMap,
    statuses,
    fingerprint,
  };
}

async function closeRuntime(runtime: CachedRuntime | null) {
  if (!runtime) return;
  try {
    await runtime.client.close();
  } catch {
    // Ignore cleanup failures.
  }
}

async function loadRuntime(force = false) {
  const servers = normalizeServers(await listMcpServers());
  const fingerprint = buildFingerprint(servers);

  if (!force && cachedRuntime && cachedFingerprint === fingerprint) {
    return cachedRuntime;
  }

  if (!force && loadingRuntime) {
    return loadingRuntime;
  }

  loadingRuntime = (async () => {
    const previous = cachedRuntime;
    const next = await buildRuntime();
    cachedRuntime = next;
    cachedFingerprint = fingerprint;
    loadingRuntime = null;
    if (previous && previous !== next) {
      await closeRuntime(previous);
    }
    return next;
  })().catch((error) => {
    loadingRuntime = null;
    throw error;
  });

  return loadingRuntime;
}

export async function refreshMcpRuntime() {
  return loadRuntime(true);
}

export async function getMcpToolDefs() {
  const runtime = await loadRuntime();
  return runtime.toolDefs;
}

export async function getMcpToolMap() {
  const runtime = await loadRuntime();
  return runtime.toolMap;
}

export async function getMcpStatuses(): Promise<McpServerStatus[]> {
  try {
    const runtime = await loadRuntime();
    return runtime.statuses;
  } catch (error) {
    const servers = normalizeServers(await listMcpServers());
    return servers.map((server) => ({
      serverName: server.name,
      toolCount: 0,
      status: "error",
      error: toErrorMessage(error),
      toolNames: [],
    }));
  }
}

export async function testMcpServer(serverInput: McpServerConfig): Promise<McpServerStatus> {
  const server = normalizeMcpServerConfig(serverInput);
  if (!server.name || !server.command) {
    return {
      serverName: server.name || UI.unnamedServer,
      toolCount: 0,
      status: "error",
      error: UI.missingNameOrCommand,
      toolNames: [],
    };
  }

  const safeServer = toSafeServerEntries([server])[0];
  const client = new MultiServerMCPClient({
    mcpServers: buildClientServerConfig([safeServer]),
    throwOnLoadError: true,
    prefixToolNameWithServerName: true,
    additionalToolNamePrefix: "mcp",
    useStandardContentBlocks: true,
    defaultToolTimeout: 120_000,
  });

  try {
    const toolsByServer = await client.initializeConnections();
    const rawTools = toolsByServer[safeServer.key] ?? [];
    const connectionState = await getServerConnectionState(client, safeServer, rawTools);
    return buildServerStatus(safeServer, rawTools, connectionState.connected, connectionState.error);
  } catch (error) {
    return {
      serverName: server.name,
      toolCount: 0,
      status: "error",
      error: toErrorMessage(error),
      toolNames: [],
    };
  } finally {
    try {
      await client.close();
    } catch {
      // Ignore cleanup failures.
    }
  }
}

export async function disposeMcpRuntime() {
  const runtime = cachedRuntime;
  cachedRuntime = null;
  cachedFingerprint = "";
  loadingRuntime = null;
  await closeRuntime(runtime);
}
