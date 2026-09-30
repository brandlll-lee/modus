import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { createMcpExtension, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { shell } from "electron";
import { invokeExtensionCommand } from "../agent/extension-ui";
import { reloadSessionResources, sessionResources } from "../agent/session-resources";
import { loadWorkspaceMcpConfig, mcpConfigPaths } from "./mcp-config";

export function createModusMcpExtension(): ExtensionFactory {
  return createMcpExtension({
    loadConfig: (ctx) =>
      loadWorkspaceMcpConfig(ctx.cwd, { projectTrusted: ctx.isProjectTrusted() }),
    openUrl: (url) => {
      void shell.openExternal(url);
    },
  });
}

export function getMcpLocations(sessionId: string): string[] {
  const resource = sessionResources().find(({ id }) => id === sessionId);
  if (!resource) return [];
  return mcpConfigPaths(resource.cwd, {
    projectTrusted: resource.session.settingsManager.isProjectTrusted(),
  })
    .map(({ source }) => source)
    .filter(existsSync);
}

export async function getMcpStatus(
  sessionId: string,
): Promise<Array<{ sessionId: string; report: string }>> {
  const resource = sessionResources().find(({ id }) => id === sessionId);
  return resource
    ? [{ sessionId, report: await invokeExtensionCommand(resource.session, "mcp") }]
    : [];
}

export async function syncWorkspaceMcp(cwd: string): Promise<void> {
  await reloadSessionResources(cwd);
}

export async function revealMcpConfig(sessionId: string, path: string): Promise<void> {
  if (!getMcpLocations(sessionId).includes(path))
    throw new Error("MCP configuration is not available in this session.");
  const error = await shell.openPath(dirname(path));
  if (error) throw new Error(error);
}
