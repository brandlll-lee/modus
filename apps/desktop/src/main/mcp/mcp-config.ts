import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { McpServerConfig, McpServerEntry } from "@earendil-works/pi-coding-agent";
import type { McpServerUpsertInput, RawMcpEntry } from "../../shared/contracts";
import { getPiCliAgentDir } from "../agent/agent-paths";

type McpDocument = {
  mcpServers: Record<string, McpServerConfig>;
  autoEnableCodemode?: boolean;
};

export const MCP_CONFIG_TEMPLATE = '{\n  "mcpServers": {}\n}\n';

function readDocument(path: string): McpDocument {
  if (!existsSync(path)) return { mcpServers: {} };
  const value = JSON.parse(readFileSync(path, "utf8")) as McpDocument;
  if (
    !value.mcpServers ||
    typeof value.mcpServers !== "object" ||
    Array.isArray(value.mcpServers)
  ) {
    throw new Error(`${path}: mcpServers must be an object.`);
  }
  return value;
}

function writeDocument(path: string, document: McpDocument): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

export function userMcpConfigPath(home = homedir()): string {
  return join(home, ".modus", "mcp.json");
}

export function defaultMcpConfigPath(cwd: string): string {
  return join(cwd, ".modus", "mcp.json");
}

export function loadWorkspaceMcpConfig(
  cwd: string,
  options: { projectTrusted?: boolean; home?: string } = {},
): { servers: McpServerEntry[]; errors: string[]; autoEnableCodemode?: boolean } {
  const paths = [
    { source: join(getPiCliAgentDir(), "mcp.json"), scope: "global" as const },
    ...(options.projectTrusted
      ? [{ source: join(cwd, ".pi", "mcp.json"), scope: "project" as const }]
      : []),
    { source: userMcpConfigPath(options.home), scope: "global" as const },
    ...(options.projectTrusted
      ? [{ source: defaultMcpConfigPath(cwd), scope: "project" as const }]
      : []),
  ];
  const entries = new Map<string, McpServerEntry>();
  const errors: string[] = [];
  let autoEnableCodemode: boolean | undefined;
  for (const { source, scope } of paths) {
    try {
      const document = readDocument(source);
      if (document.autoEnableCodemode !== undefined)
        autoEnableCodemode = document.autoEnableCodemode;
      for (const [name, config] of Object.entries(document.mcpServers)) {
        entries.set(name, { name, config, source, scope });
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return {
    servers: [...entries.values()],
    errors,
    ...(autoEnableCodemode === undefined ? {} : { autoEnableCodemode }),
  };
}

export function findRawMcpEntry(cwd: string, name: string): RawMcpEntry | undefined {
  const entry = loadWorkspaceMcpConfig(cwd, { projectTrusted: true }).servers.find(
    (server) => server.name === name,
  );
  return entry
    ? { source: entry.source, entry: entry.config as unknown as Record<string, unknown> }
    : undefined;
}

function writablePath(cwd: string, source?: string): string {
  return source === userMcpConfigPath() ? source : defaultMcpConfigPath(cwd);
}

export function upsertMcpServerEntry(cwd: string, input: McpServerUpsertInput): void {
  const previous = findRawMcpEntry(cwd, input.originalName ?? input.name);
  const path = previous
    ? writablePath(cwd, previous.source)
    : input.scope === "user"
      ? userMcpConfigPath()
      : defaultMcpConfigPath(cwd);
  const document = readDocument(path);
  if (input.originalName && input.originalName !== input.name) {
    if (previous && previous.source !== path)
      document.mcpServers[input.originalName] = {
        ...previous.entry,
        enabled: false,
      } as McpServerConfig;
    else delete document.mcpServers[input.originalName];
  }
  document.mcpServers[input.name] = {
    ...(previous?.entry ?? {}),
    ...(input.transport === "stdio"
      ? { command: input.command ?? "", args: input.args ?? [], env: input.env ?? {} }
      : { url: input.url ?? "", headers: input.headers ?? {} }),
    enabled: input.enabled,
    exposure: input.exposure ?? previous?.entry.exposure ?? "codemode",
  } as McpServerConfig;
  const entry = document.mcpServers[input.name] as unknown as Record<string, unknown>;
  if (input.transport === "stdio") {
    delete entry.url;
    delete entry.headers;
  } else {
    delete entry.command;
    delete entry.args;
    delete entry.env;
    delete entry.cwd;
  }
  writeDocument(path, document);
}

export function removeMcpServerEntry(cwd: string, name: string): void {
  const previous = findRawMcpEntry(cwd, name);
  if (!previous) return;
  const path = writablePath(cwd, previous.source);
  const document = readDocument(path);
  if (path === previous.source) delete document.mcpServers[name];
  else document.mcpServers[name] = { ...previous.entry, enabled: false } as McpServerConfig;
  writeDocument(path, document);
}

export function setMcpServerEnabledEntry(cwd: string, name: string, enabled: boolean): void {
  const previous = findRawMcpEntry(cwd, name);
  if (!previous) throw new Error(`Unknown MCP server: ${name}`);
  const path = writablePath(cwd, previous.source);
  const document = readDocument(path);
  document.mcpServers[name] = { ...previous.entry, enabled } as McpServerConfig;
  writeDocument(path, document);
}
