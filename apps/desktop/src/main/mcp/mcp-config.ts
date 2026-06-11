import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { McpServerUpsertInput, RawMcpEntry } from "../../shared/contracts";

/**
 * MCP configuration discovery — pure functions, unit-testable without Electron.
 *
 * The on-disk format is Cursor's `mcp.json` so existing configs work verbatim:
 *
 *   { "mcpServers": { "<name>": { "command": "npx", "args": [...], "env": {...} }
 *                     | { "url": "https://...", "headers": {...} } } }
 *
 * Search order (later sources override earlier ones on name conflicts):
 *   1. ~/.modus/mcp.json            (user)
 *   2. <workspace>/.cursor/mcp.json (project, Cursor-compatible)
 *   3. <workspace>/.modus/mcp.json  (project, Modus-native)
 */

export type McpStdioConfig = {
  transport: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string | undefined;
};

export type McpHttpConfig = {
  transport: "http";
  url: string;
  headers: Record<string, string>;
};

export type McpServerConfig = {
  name: string;
  /** Absolute path of the config file that defined this server. */
  source: string;
  enabled: boolean;
} & (McpStdioConfig | McpHttpConfig);

export type McpConfigLoadResult = {
  servers: McpServerConfig[];
  /** Parse failures, keyed by file — surfaced in Settings instead of thrown. */
  errors: Array<{ source: string; message: string }>;
};

/** `${env:NAME}` placeholders → process env values ("" when unset). */
export function interpolateEnv(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.replace(/\$\{env:([\w]+)\}/g, (_, name: string) => env[name] ?? "");
}

function interpolateRecord(
  record: Record<string, string>,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, interpolateEnv(value, env)]),
  );
}

function asStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/** Parse one mcp.json document into server configs (tolerant: skips bad entries). */
export function parseMcpConfig(
  jsonText: string,
  source: string,
  env: NodeJS.ProcessEnv = process.env,
): McpConfigLoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    return {
      servers: [],
      errors: [{ source, message: error instanceof Error ? error.message : "Invalid JSON" }],
    };
  }

  const root = parsed as { mcpServers?: Record<string, unknown> };
  if (typeof root !== "object" || root === null || typeof root.mcpServers !== "object") {
    return { servers: [], errors: [{ source, message: 'Missing "mcpServers" object.' }] };
  }

  const servers: McpServerConfig[] = [];
  const errors: McpConfigLoadResult["errors"] = [];

  for (const [name, raw] of Object.entries(root.mcpServers ?? {})) {
    if (typeof raw !== "object" || raw === null) {
      errors.push({ source, message: `Server "${name}" must be an object.` });
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const enabled = entry.disabled !== true && entry.enabled !== false;

    if (typeof entry.url === "string" && entry.url.trim()) {
      servers.push({
        name,
        source,
        enabled,
        transport: "http",
        url: interpolateEnv(entry.url.trim(), env),
        headers: interpolateRecord(asStringRecord(entry.headers), env),
      });
      continue;
    }

    if (typeof entry.command === "string" && entry.command.trim()) {
      const args = Array.isArray(entry.args)
        ? entry.args.filter((item): item is string => typeof item === "string")
        : [];
      servers.push({
        name,
        source,
        enabled,
        transport: "stdio",
        command: interpolateEnv(entry.command.trim(), env),
        args: args.map((arg) => interpolateEnv(arg, env)),
        env: interpolateRecord(asStringRecord(entry.env), env),
        cwd: typeof entry.cwd === "string" ? interpolateEnv(entry.cwd, env) : undefined,
      });
      continue;
    }

    errors.push({ source, message: `Server "${name}" needs a "command" or a "url".` });
  }

  return { servers, errors };
}

/** Candidate config paths for a workspace, lowest precedence first. */
export function mcpConfigPaths(cwd: string, home: string = homedir()): string[] {
  return [
    join(home, ".modus", "mcp.json"),
    join(cwd, ".cursor", "mcp.json"),
    join(cwd, ".modus", "mcp.json"),
  ];
}

/** Load + merge every mcp.json that exists for this workspace. */
export function loadWorkspaceMcpConfig(
  cwd: string,
  options: { home?: string; env?: NodeJS.ProcessEnv } = {},
): McpConfigLoadResult {
  const byName = new Map<string, McpServerConfig>();
  const errors: McpConfigLoadResult["errors"] = [];

  for (const path of mcpConfigPaths(cwd, options.home)) {
    if (!existsSync(path)) {
      continue;
    }
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      errors.push({
        source: path,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const result = parseMcpConfig(text, path, options.env);
    errors.push(...result.errors);
    for (const server of result.servers) {
      byName.set(server.name, server);
    }
  }

  return { servers: [...byName.values()], errors };
}

/** Default file a "Open mcp.json" action should create/edit for a workspace. */
export function defaultMcpConfigPath(cwd: string): string {
  const cursorPath = join(cwd, ".cursor", "mcp.json");
  if (existsSync(cursorPath)) {
    return cursorPath;
  }
  return join(cwd, ".modus", "mcp.json");
}

/* ── In-app editing (write-back) ─────────────────────────────────────────
 * The Settings form edits servers without sending users to a text editor.
 * Writes go to the file a server came from (predictable round-trips); new
 * servers land in the workspace default. Raw values (incl. ${env:…}
 * placeholders) are preserved verbatim — interpolation happens only at
 * connect time.
 */

type McpDocument = { mcpServers: Record<string, unknown> } & Record<string, unknown>;

function readMcpDocument(path: string): McpDocument {
  if (!existsSync(path)) {
    return { mcpServers: {} };
  }
  const text = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${path} contains invalid JSON (${error instanceof Error ? error.message : error}). Fix it before editing servers here.`,
    );
  }
  const doc = (typeof parsed === "object" && parsed !== null ? parsed : {}) as McpDocument;
  if (typeof doc.mcpServers !== "object" || doc.mcpServers === null) {
    doc.mcpServers = {};
  }
  return doc;
}

function writeMcpDocument(path: string, doc: McpDocument): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

/** Raw (un-interpolated) entry + the file it lives in, highest precedence wins. */
export function findRawMcpEntry(
  cwd: string,
  name: string,
  home: string = homedir(),
): RawMcpEntry | undefined {
  for (const path of [...mcpConfigPaths(cwd, home)].reverse()) {
    if (!existsSync(path)) {
      continue;
    }
    try {
      const doc = readMcpDocument(path);
      const entry = doc.mcpServers[name];
      if (typeof entry === "object" && entry !== null) {
        return { source: path, entry: entry as Record<string, unknown> };
      }
    } catch {
      // Unreadable file — keep searching lower-precedence sources.
    }
  }
  return undefined;
}

function buildRawEntry(input: McpServerUpsertInput): Record<string, unknown> {
  if (input.transport === "http") {
    const url = input.url?.trim();
    if (!url) {
      throw new Error("Remote servers need a URL.");
    }
    return {
      url,
      ...(input.headers && Object.keys(input.headers).length > 0 ? { headers: input.headers } : {}),
      ...(input.enabled ? {} : { disabled: true }),
    };
  }
  const command = input.command?.trim();
  if (!command) {
    throw new Error("Local servers need a command.");
  }
  return {
    command,
    ...(input.args && input.args.length > 0 ? { args: input.args } : {}),
    ...(input.env && Object.keys(input.env).length > 0 ? { env: input.env } : {}),
    ...(input.enabled ? {} : { disabled: true }),
  };
}

/** Create or update a server entry; returns the file that was written. */
export function upsertMcpServerEntry(
  cwd: string,
  input: McpServerUpsertInput,
  home: string = homedir(),
): string {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Server name is required.");
  }
  const previous = findRawMcpEntry(cwd, input.originalName ?? name, home);
  const target = previous?.source ?? defaultMcpConfigPath(cwd);
  const doc = readMcpDocument(target);

  if (input.originalName && input.originalName !== name) {
    delete doc.mcpServers[input.originalName];
  }
  doc.mcpServers[name] = buildRawEntry(input);
  writeMcpDocument(target, doc);
  return target;
}

/** Remove a server entry from the file that defines it. */
export function removeMcpServerEntry(cwd: string, name: string, home: string = homedir()): string {
  const found = findRawMcpEntry(cwd, name, home);
  if (!found) {
    throw new Error(`No editable entry found for "${name}".`);
  }
  const doc = readMcpDocument(found.source);
  delete doc.mcpServers[name];
  writeMcpDocument(found.source, doc);
  return found.source;
}

/** Flip the disabled flag in place, preserving everything else verbatim. */
export function setMcpServerEnabledEntry(
  cwd: string,
  name: string,
  enabled: boolean,
  home: string = homedir(),
): string {
  const found = findRawMcpEntry(cwd, name, home);
  if (!found) {
    throw new Error(`No editable entry found for "${name}".`);
  }
  const doc = readMcpDocument(found.source);
  const entry = doc.mcpServers[name];
  if (typeof entry === "object" && entry !== null) {
    const record = entry as Record<string, unknown>;
    delete record.enabled;
    if (enabled) {
      delete record.disabled;
    } else {
      record.disabled = true;
    }
  }
  writeMcpDocument(found.source, doc);
  return found.source;
}

export const MCP_CONFIG_TEMPLATE = `{
  "mcpServers": {
    "example-stdio": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "disabled": true
    },
    "example-http": {
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer \${env:EXAMPLE_TOKEN}" },
      "disabled": true
    }
  }
}
`;
