import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { McpServerUpsertInput, RawMcpEntry } from "../../shared/contracts";

/**
 * MCP configuration discovery — pure functions, unit-testable without Electron.
 *
 * The on-disk format is the common MCP JSON shape, scoped to Modus-owned
 * config files only:
 *
 *   { "mcpServers": { "<name>": { "command": "npx", "args": [...], "env": {...} }
 *                     | { "url": "https://...", "headers": {...} } } }
 *
 * Search order (later sources override earlier ones on name conflicts):
 *   1. ~/.modus/mcp.json
 *   2. <workspace>/.modus/mcp.json
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function looksLikeServerMap(record: Record<string, unknown>): boolean {
  return Object.values(record).some((value) => {
    const server = asRecord(value);
    return typeof server?.command === "string" || typeof server?.url === "string";
  });
}

function findServerMap(root: unknown): Record<string, unknown> | undefined {
  const record = asRecord(root);
  const nestedMcp = asRecord(record?.mcp);
  return (
    asRecord(nestedMcp?.servers) ??
    asRecord(record?.servers) ??
    asRecord(record?.mcpServers) ??
    asRecord(record?.mcp_servers) ??
    (record && looksLikeServerMap(record) ? record : undefined)
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

  const serverMap = findServerMap(parsed);
  if (!serverMap) {
    return {
      servers: [],
      errors: [{ source, message: 'Missing "mcpServers", "servers" or "mcp.servers" object.' }],
    };
  }

  const servers: McpServerConfig[] = [];
  const errors: McpConfigLoadResult["errors"] = [];

  for (const [name, raw] of Object.entries(serverMap)) {
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
  return [join(home, ".modus", "mcp.json"), join(cwd, ".modus", "mcp.json")];
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
  return join(cwd, ".modus", "mcp.json");
}

/* ── In-app editing (write-back) ─────────────────────────────────────────
 * The Settings form edits servers without sending users to a text editor.
 * Writes go to the file a server came from (predictable round-trips); new
 * servers land in the workspace default. Raw values (incl. ${env:…}
 * placeholders) are preserved verbatim — interpolation happens only at
 * connect time.
 */

type McpDocument = Record<string, unknown>;

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
  return doc;
}

function editableServerMap(doc: McpDocument): Record<string, unknown> {
  const existing = findServerMap(doc);
  if (existing) {
    return existing;
  }
  doc.mcpServers = {};
  return doc.mcpServers as Record<string, unknown>;
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
      const entry = editableServerMap(doc)[name];
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
  const serverMap = editableServerMap(doc);

  if (input.originalName && input.originalName !== name) {
    delete serverMap[input.originalName];
  }
  serverMap[name] = buildRawEntry(input);
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
  delete editableServerMap(doc)[name];
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
  const entry = editableServerMap(doc)[name];
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
