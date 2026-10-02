import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type AgentSession,
  createMcpExtension,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { shell } from "electron";
import { getPiCliAgentDir } from "../agent/agent-paths";
import { getAgentSession } from "../agent/agent-store";
import { invokeExtensionCommand } from "../agent/extension-ui";
import { sessionResources } from "../agent/session-resources";

const reports = new WeakMap<AgentSession, Promise<string>>();

export function createModusMcpExtension(): ExtensionFactory {
  return createMcpExtension({
    openUrl: (url) => {
      void shell.openExternal(url);
    },
  });
}

export function getMcpLocations(sessionId: string): string[] {
  const resource = sessionResources().find(({ id }) => id === sessionId);
  const info = getAgentSession(sessionId);
  return [
    join(getPiCliAgentDir(), "mcp.json"),
    ...(info && resource?.session.settingsManager.isProjectTrusted()
      ? [join(info.cwd, ".pi", "mcp.json")]
      : []),
  ].filter(existsSync);
}

export async function getMcpStatus(
  sessionId: string,
): Promise<Array<{ sessionId: string; report: string }>> {
  const resource = sessionResources().find(({ id }) => id === sessionId);
  if (!resource) throw new Error("Session resources are not loaded.");
  if (!resource.session.extensionRunner?.getCommand("mcp"))
    return [{ sessionId, report: "MCP is disabled in this session." }];
  let report = reports.get(resource.session);
  if (!report) {
    report = invokeExtensionCommand(resource.session, "mcp").finally(() =>
      reports.delete(resource.session),
    );
    reports.set(resource.session, report);
  }
  return [{ sessionId, report: await report }];
}

export function getMcpCommands(sessionId: string): Array<{ name: string; description?: string }> {
  const runner = sessionResources().find(({ id }) => id === sessionId)?.session.extensionRunner;
  const source = runner?.getCommand("mcp")?.sourceInfo;
  if (!source) return [];
  return (runner?.getRegisteredCommands() ?? [])
    .filter((command) => command.sourceInfo.path === source.path)
    .map((command) => ({
      name: command.invocationName,
      ...(command.description ? { description: command.description } : {}),
    }));
}

export async function runMcpCommand(
  sessionId: string,
  name: string,
  args: string,
): Promise<string> {
  const resource = sessionResources().find(({ id }) => id === sessionId);
  if (!resource || !getMcpCommands(sessionId).some((command) => command.name === name))
    throw new Error("This MCP command is not available.");
  return invokeExtensionCommand(resource.session, name, args);
}

export async function revealMcpConfig(sessionId: string, path: string): Promise<void> {
  if (!getMcpLocations(sessionId).includes(path))
    throw new Error("MCP configuration is not available in this session.");
  const error = await shell.openPath(dirname(path));
  if (error) throw new Error(error);
}
