import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { TSchema } from "typebox";
import type {
  McpServerInfo,
  McpServerUpsertInput,
  McpToolInfo,
  RawMcpEntry,
} from "../../shared/contracts";
import { getMcpToolUiMeta } from "../../shared/tools";
import { toolRegistry } from "../agent/tools/registry";
import {
  defaultMcpConfigPath,
  findRawMcpEntry,
  loadWorkspaceMcpConfig,
  MCP_CONFIG_TEMPLATE,
  type McpServerConfig,
  removeMcpServerEntry,
  setMcpServerEnabledEntry,
  upsertMcpServerEntry,
} from "./mcp-config";

/**
 * MCP runtime — connects the servers declared in mcp.json, bridges their tools
 * into the shared tool registry (so they flow through the same activation /
 * permission / UI pipeline as every other agent tool), and reports status to
 * the Settings UI.
 *
 * Every MCP call is classified `mcp.call` + dangerous, so the permission
 * broker prompts on first use and honors workspace-level "always allow".
 */

const CONNECT_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 120_000;

type ManagedServer = {
  config: McpServerConfig;
  /** Identity of the config used for change detection on reload. */
  configKey: string;
  status: McpServerInfo["status"];
  error?: string | undefined;
  client?: Client | undefined;
  tools: McpToolInfo[];
};

/** name → managed connection. MCP servers are app-wide, like Cursor's. */
const servers = new Map<string, ManagedServer>();
/** Tool names currently registered per server, for clean unregistration. */
const registeredTools = new Map<string, string[]>();

const sanitize = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, "_");

export function mcpToolName(server: string, tool: string): string {
  return `mcp_${sanitize(server)}_${sanitize(tool)}`;
}

function configKey(config: McpServerConfig): string {
  const { source: _source, ...identity } = config;
  return JSON.stringify(identity);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * On Windows, npm shims (npx.cmd, …) are not directly spawnable executables;
 * route stdio commands through cmd.exe exactly like a terminal would.
 */
function stdioSpawnSpec(config: Extract<McpServerConfig, { transport: "stdio" }>): {
  command: string;
  args: string[];
} {
  if (process.platform === "win32") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", config.command, ...config.args] };
  }
  return { command: config.command, args: config.args };
}

async function createConnectedClient(config: McpServerConfig): Promise<Client> {
  const client = new Client({ name: "modus", version: "0.1.0" });

  if (config.transport === "stdio") {
    const spec = stdioSpawnSpec(config);
    const transport = new StdioClientTransport({
      command: spec.command,
      args: spec.args,
      env: { ...getDefaultEnvironment(), ...config.env },
      stderr: "ignore",
      ...(config.cwd !== undefined ? { cwd: config.cwd } : {}),
    });
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `connect ${config.name}`);
    return client;
  }

  // Remote servers: Streamable HTTP first (current spec), SSE as fallback
  // (legacy servers) — the same ladder Cursor and opencode use.
  const url = new URL(config.url);
  const headers = config.headers;
  try {
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers },
    });
    // Cast: the SDK's transport classes type `sessionId` as `string | undefined`
    // while its own Transport interface says `sessionId?: string`, which is
    // incompatible under exactOptionalPropertyTypes.
    await withTimeout(
      client.connect(transport as unknown as Parameters<Client["connect"]>[0]),
      CONNECT_TIMEOUT_MS,
      `connect ${config.name}`,
    );
    return client;
  } catch {
    const fallback = new Client({ name: "modus", version: "0.1.0" });
    const transport = new SSEClientTransport(url, { requestInit: { headers } });
    await withTimeout(
      fallback.connect(transport as unknown as Parameters<Client["connect"]>[0]),
      CONNECT_TIMEOUT_MS,
      `connect ${config.name}`,
    );
    return fallback;
  }
}

/** MCP inputSchema (JSON Schema) → the TSchema PI forwards to the model. */
function toParametersSchema(inputSchema: unknown): TSchema {
  const schema =
    typeof inputSchema === "object" && inputSchema !== null
      ? (inputSchema as Record<string, unknown>)
      : {};
  return {
    ...schema,
    type: "object",
    properties: schema.properties ?? {},
  } as unknown as TSchema;
}

type McpContentItem = {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
};

function toAgentContent(items: McpContentItem[]): (TextContent | ImageContent)[] {
  const parts: (TextContent | ImageContent)[] = [];
  for (const item of items) {
    if (item.type === "text" && typeof item.text === "string") {
      parts.push({ type: "text", text: item.text });
    } else if (item.type === "image" && item.data && item.mimeType) {
      parts.push({ type: "image", data: item.data, mimeType: item.mimeType });
    } else {
      parts.push({ type: "text", text: JSON.stringify(item) });
    }
  }
  return parts.length > 0 ? parts : [{ type: "text", text: "(no content)" }];
}

function buildToolDefinition(
  serverName: string,
  client: Client,
  tool: { name: string; description?: string | undefined; inputSchema?: unknown },
): ToolDefinition {
  const registeredName = mcpToolName(serverName, tool.name);
  return defineTool({
    name: registeredName,
    label: `${serverName}: ${tool.name}`,
    description:
      tool.description?.trim() || `Tool "${tool.name}" provided by the "${serverName}" MCP server.`,
    parameters: toParametersSchema(tool.inputSchema),
    execute: async (_toolCallId, params, signal) => {
      const result = await client.callTool(
        { name: tool.name, arguments: (params ?? {}) as Record<string, unknown> },
        undefined,
        {
          timeout: CALL_TIMEOUT_MS,
          resetTimeoutOnProgress: true,
          ...(signal ? { signal } : {}),
        },
      );
      const content = toAgentContent((result.content ?? []) as McpContentItem[]);
      if (result.isError) {
        const message = content
          .map((part) => (part.type === "text" ? part.text : `[image ${part.mimeType}]`))
          .join("\n");
        throw new Error(message || `MCP tool ${tool.name} failed.`);
      }
      return { content, details: { server: serverName, tool: tool.name } };
    },
  });
}

function unregisterServerTools(serverName: string): void {
  for (const name of registeredTools.get(serverName) ?? []) {
    toolRegistry.unregisterTool(name);
  }
  registeredTools.delete(serverName);
}

async function refreshServerTools(managed: ManagedServer): Promise<void> {
  const client = managed.client;
  if (!client) {
    return;
  }
  const listed = await withTimeout(
    client.listTools(),
    CONNECT_TIMEOUT_MS,
    `list tools ${managed.config.name}`,
  );

  unregisterServerTools(managed.config.name);
  const names: string[] = [];
  const tools: McpToolInfo[] = [];
  for (const tool of listed.tools) {
    const definition = buildToolDefinition(managed.config.name, client, tool);
    toolRegistry.registerTool({
      entry: {
        name: definition.name,
        profiles: ["chat"],
        permission: { danger: "dangerous", action: "mcp.call" },
        ui: getMcpToolUiMeta(definition.name),
      },
      definition,
    });
    names.push(definition.name);
    tools.push({
      name: tool.name,
      registeredName: definition.name,
      description: tool.description,
    });
  }
  registeredTools.set(managed.config.name, names);
  managed.tools = tools;
}

async function connectServer(managed: ManagedServer): Promise<void> {
  managed.status = "connecting";
  managed.error = undefined;
  try {
    const client = await createConnectedClient(managed.config);
    managed.client = client;

    // Servers may add/remove tools at runtime; keep the registry in sync.
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      void refreshServerTools(managed).catch(() => {});
    });
    client.onclose = () => {
      if (managed.client === client) {
        managed.client = undefined;
        if (managed.status === "connected") {
          managed.status = "failed";
          managed.error = "Connection closed.";
        }
        unregisterServerTools(managed.config.name);
      }
    };

    await refreshServerTools(managed);
    managed.status = "connected";
  } catch (error) {
    managed.status = "failed";
    managed.error = error instanceof Error ? error.message : String(error);
    managed.tools = [];
    await managed.client?.close().catch(() => {});
    managed.client = undefined;
  }
}

async function disposeServer(name: string): Promise<void> {
  const managed = servers.get(name);
  if (!managed) {
    return;
  }
  unregisterServerTools(name);
  await managed.client?.close().catch(() => {});
  servers.delete(name);
}

/**
 * Reconcile running servers with the mcp.json files visible from `cwd`.
 * Unchanged servers keep their connections; changed/removed ones are torn
 * down; new ones connect in parallel. Returns the resulting status list.
 */
export async function syncWorkspaceMcp(cwd: string): Promise<McpServerInfo[]> {
  const { servers: configs } = loadWorkspaceMcpConfig(cwd);
  const desired = new Map(configs.map((config) => [config.name, config]));

  const removals: Promise<void>[] = [];
  for (const name of servers.keys()) {
    const next = desired.get(name);
    const current = servers.get(name);
    if (!next || (current && current.configKey !== configKey(next))) {
      removals.push(disposeServer(name));
    }
  }
  await Promise.all(removals);

  const connections: Promise<void>[] = [];
  for (const config of configs) {
    if (servers.has(config.name)) {
      continue;
    }
    const managed: ManagedServer = {
      config,
      configKey: configKey(config),
      status: config.enabled ? "connecting" : "disabled",
      tools: [],
    };
    servers.set(config.name, managed);
    if (config.enabled) {
      connections.push(connectServer(managed));
    }
  }
  await Promise.all(connections);

  return listMcpServers();
}

export function listMcpServers(): McpServerInfo[] {
  return [...servers.values()]
    .map((managed) => ({
      name: managed.config.name,
      transport: managed.config.transport,
      source: managed.config.source,
      status: managed.status,
      error: managed.error,
      tools: managed.tools,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Ensure an editable mcp.json exists for the workspace; returns its path. */
export function ensureMcpConfigFile(cwd: string): string {
  const path = defaultMcpConfigPath(cwd);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, MCP_CONFIG_TEMPLATE, "utf8");
  }
  return path;
}

/** Create/update a server from the Settings form, then reconnect. */
export async function upsertMcpServer(
  cwd: string,
  input: McpServerUpsertInput,
): Promise<McpServerInfo[]> {
  upsertMcpServerEntry(cwd, input);
  return await syncWorkspaceMcp(cwd);
}

/** Delete a server from its config file, then reconcile connections. */
export async function deleteMcpServer(cwd: string, name: string): Promise<McpServerInfo[]> {
  removeMcpServerEntry(cwd, name);
  return await syncWorkspaceMcp(cwd);
}

/** Toggle a server on/off in place, then reconcile connections. */
export async function setMcpServerEnabled(
  cwd: string,
  name: string,
  enabled: boolean,
): Promise<McpServerInfo[]> {
  setMcpServerEnabledEntry(cwd, name, enabled);
  return await syncWorkspaceMcp(cwd);
}

/** Raw (un-interpolated) entry for the edit form. */
export function getMcpServerEntry(cwd: string, name: string): RawMcpEntry | undefined {
  return findRawMcpEntry(cwd, name);
}

/** App-shutdown cleanup: close every transport (kills stdio children). */
export async function disposeAllMcp(): Promise<void> {
  await Promise.all([...servers.keys()].map((name) => disposeServer(name)));
}
