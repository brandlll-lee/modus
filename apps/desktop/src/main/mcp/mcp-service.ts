import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createMcpExtension, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { shell } from "electron";
import type { McpServerInfo, McpServerUpsertInput, RawMcpEntry } from "../../shared/contracts";
import { invokeExtensionCommand } from "../agent/extension-ui";
import {
  assertSessionResourcesIdle,
  reloadSessionResources,
  sessionResources,
} from "../agent/session-resources";
import {
  defaultMcpConfigPath,
  findRawMcpEntry,
  loadWorkspaceMcpConfig,
  MCP_CONFIG_TEMPLATE,
  removeMcpServerEntry,
  setMcpServerEnabledEntry,
  upsertMcpServerEntry,
  userMcpConfigPath,
} from "./mcp-config";

export function createModusMcpExtension(): ExtensionFactory {
  return (pi) => {
    let errors: string[] = [];
    let autoEnableCodemode: boolean | undefined;
    pi.on("session_start", (_event, ctx) => {
      const loaded = loadWorkspaceMcpConfig(ctx.cwd, { projectTrusted: ctx.isProjectTrusted() });
      errors = [...loaded.errors];
      autoEnableCodemode = loaded.autoEnableCodemode;
      for (const entry of loaded.servers) {
        try {
          pi.registerMcpServer(entry.name, entry.config);
        } catch (error) {
          errors.push(`${entry.source}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });
    createMcpExtension({
      loadConfig: () => ({
        servers: [],
        errors,
        ...(autoEnableCodemode === undefined ? {} : { autoEnableCodemode }),
      }),
      openUrl: (url) => {
        void shell.openExternal(url);
      },
    })(pi);
  };
}

export function listMcpServers(cwd = process.cwd()): McpServerInfo[] {
  return loadWorkspaceMcpConfig(cwd, { projectTrusted: true })
    .servers.map<McpServerInfo>(({ name, source, config }) => ({
      name,
      source,
      transport: "url" in config ? "http" : "stdio",
      status: config.enabled === false ? "disabled" : "configured",
      tools: sessionResources(cwd).flatMap(({ session }) =>
        session
          .getAllTools()
          .filter((tool) => tool.namespace?.name === `mcp__${name}`)
          .map((tool) => ({
            name: session.getToolDefinition(tool.name)?.label ?? tool.name,
            registeredName: tool.name,
            description: tool.description,
          })),
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getMcpStatus(
  cwd: string,
): Promise<Array<{ sessionId: string; report: string }>> {
  return Promise.all(
    sessionResources(cwd).map(async ({ id, session }) => ({
      sessionId: id,
      report: await invokeExtensionCommand(session, "mcp"),
    })),
  );
}

export async function runMcpCommand(input: {
  sessionId: string;
  name: string;
  action: "login" | "logout" | "reconnect";
}): Promise<string> {
  const resource = sessionResources().find(({ id }) => id === input.sessionId);
  if (!resource) throw new Error("Agent session is not open.");
  return invokeExtensionCommand(resource.session, "mcp", `${input.action} ${input.name}`);
}

export async function syncWorkspaceMcp(cwd: string): Promise<McpServerInfo[]> {
  await reloadSessionResources(cwd);
  return listMcpServers(cwd);
}

export function ensureMcpConfigFile(cwd: string): string {
  const path = defaultMcpConfigPath(cwd);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, MCP_CONFIG_TEMPLATE, "utf8");
  }
  return path;
}

async function updateConfiguration(
  cwd: string,
  global: boolean,
  write: () => void,
): Promise<McpServerInfo[]> {
  const affected = global
    ? [...new Set([cwd, ...sessionResources().map((resource) => resource.cwd)])]
    : [cwd];
  for (const workspace of affected) assertSessionResourcesIdle(workspace);
  write();
  await Promise.all(affected.map(reloadSessionResources));
  return listMcpServers(cwd);
}

export async function upsertMcpServer(
  cwd: string,
  input: McpServerUpsertInput,
): Promise<McpServerInfo[]> {
  const previous = findRawMcpEntry(cwd, input.originalName ?? input.name);
  const global = previous ? previous.source === userMcpConfigPath() : input.scope === "user";
  return updateConfiguration(cwd, global, () => upsertMcpServerEntry(cwd, input));
}

export async function deleteMcpServer(cwd: string, name: string): Promise<McpServerInfo[]> {
  return updateConfiguration(cwd, findRawMcpEntry(cwd, name)?.source === userMcpConfigPath(), () =>
    removeMcpServerEntry(cwd, name),
  );
}

export async function setMcpServerEnabled(
  cwd: string,
  name: string,
  enabled: boolean,
): Promise<McpServerInfo[]> {
  return updateConfiguration(cwd, findRawMcpEntry(cwd, name)?.source === userMcpConfigPath(), () =>
    setMcpServerEnabledEntry(cwd, name, enabled),
  );
}

export function getMcpServerEntry(cwd: string, name: string): RawMcpEntry | undefined {
  return findRawMcpEntry(cwd, name);
}
