import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig, McpServerEntry } from "@earendil-works/pi-coding-agent";
import { getPiCliAgentDir } from "../agent/agent-paths";

type McpDocument = {
  mcpServers: Record<string, McpServerConfig>;
  autoEnableCodemode?: boolean;
};

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

export function mcpConfigPaths(
  cwd: string,
  options: { projectTrusted?: boolean; home?: string } = {},
) {
  return [
    { source: join(getPiCliAgentDir(), "mcp.json"), scope: "global" as const },
    ...(options.projectTrusted
      ? [{ source: join(cwd, ".pi", "mcp.json"), scope: "project" as const }]
      : []),
    {
      source: join(options.home ?? homedir(), ".modus", "agent", "mcp.json"),
      scope: "global" as const,
    },
    ...(options.projectTrusted
      ? [{ source: join(cwd, ".modus", "mcp.json"), scope: "project" as const }]
      : []),
  ];
}

export function loadWorkspaceMcpConfig(
  cwd: string,
  options: { projectTrusted?: boolean; home?: string } = {},
): { servers: McpServerEntry[]; errors: string[]; autoEnableCodemode?: boolean } {
  const paths = mcpConfigPaths(cwd, options);
  const entries = new Map<string, McpServerEntry>();
  const errors: string[] = [];
  let autoEnableCodemode: boolean | undefined;
  for (const { source, scope } of paths) {
    try {
      const document = readDocument(source);
      if (document.autoEnableCodemode !== undefined)
        autoEnableCodemode = document.autoEnableCodemode;
      for (const [name, config] of Object.entries(document.mcpServers))
        entries.set(name, { name, config, source, scope });
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
