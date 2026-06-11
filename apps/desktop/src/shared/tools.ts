import type { PermissionAction } from "./contracts";

/**
 * Single source of truth for the agent tool system (shared by the Electron main
 * process and the renderer). This file holds only serializable data + pure
 * helpers; runtime behavior that depends on the PI SDK (custom-tool execution,
 * dynamic permission classification) lives in `main/agent/tools/registry.ts`.
 */

/** Named tool sets. A session is created with one profile's active tools. */
export type ToolProfileName = "chat" | "review";

/** Stable icon identifiers; the renderer maps these to concrete components. */
export type ToolIconName =
  | "file"
  | "terminal"
  | "pencil"
  | "file-plus"
  | "search"
  | "file-search"
  | "folder"
  | "globe"
  | "todo"
  | "tool";

/**
 * How a tool's permission requirement is determined.
 * - `safe`: never prompts (read-only tools).
 * - `dangerous`: always prompts, using the declared `action`.
 * - `dynamic`: a main-side classifier inspects the arguments (e.g. `bash`).
 */
export type ToolDangerLevel = "safe" | "dangerous" | "dynamic";

export type ToolPermissionDecl = {
  danger: ToolDangerLevel;
  /** Permission action used when a prompt is required. Omitted for `safe` tools. */
  action?: PermissionAction;
};

export type ToolUiMeta = {
  iconName: ToolIconName;
  verb: string;
  /** Render the target in monospace (commands, patterns). */
  mono: boolean;
  /** Argument key used to derive the default target label shown after the verb. */
  primaryArgKey?: string;
};

export type ToolKind = "builtin" | "custom";

export type ToolCatalogEntry = {
  name: string;
  kind: ToolKind;
  /** Profiles this tool belongs to. Custom tools self-declare their membership. */
  profiles: ToolProfileName[];
  permission: ToolPermissionDecl;
  ui: ToolUiMeta;
};

export const BUILTIN_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

/** The seven tools PI's DefaultResourceLoader ships out of the box. */
export const BUILTIN_TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    name: "read",
    kind: "builtin",
    profiles: ["chat", "review"],
    permission: { danger: "safe" },
    ui: { iconName: "file", verb: "Read", mono: false, primaryArgKey: "path" },
  },
  {
    name: "bash",
    kind: "builtin",
    profiles: ["chat"],
    permission: { danger: "dynamic" },
    ui: { iconName: "terminal", verb: "Ran", mono: true, primaryArgKey: "command" },
  },
  {
    name: "edit",
    kind: "builtin",
    profiles: ["chat"],
    permission: { danger: "dangerous", action: "file.write" },
    ui: { iconName: "pencil", verb: "Edited", mono: false, primaryArgKey: "path" },
  },
  {
    name: "write",
    kind: "builtin",
    profiles: ["chat"],
    permission: { danger: "dangerous", action: "file.write" },
    ui: { iconName: "file-plus", verb: "Wrote", mono: false, primaryArgKey: "path" },
  },
  {
    name: "grep",
    kind: "builtin",
    profiles: ["chat", "review"],
    permission: { danger: "safe" },
    ui: { iconName: "search", verb: "Grepped", mono: true, primaryArgKey: "pattern" },
  },
  {
    name: "find",
    kind: "builtin",
    profiles: ["chat", "review"],
    permission: { danger: "safe" },
    ui: { iconName: "file-search", verb: "Searched", mono: true, primaryArgKey: "pattern" },
  },
  {
    name: "ls",
    kind: "builtin",
    profiles: ["chat", "review"],
    permission: { danger: "safe" },
    ui: { iconName: "folder", verb: "Listed", mono: false, primaryArgKey: "path" },
  },
];

/** Agent-facing terminal tool names (custom tools registered at runtime). */
export const TERMINAL_TOOL_NAMES = [
  "terminal_run",
  "terminal_read",
  "terminal_list",
  "terminal_write",
  "terminal_kill",
] as const;

export type TerminalToolName = (typeof TERMINAL_TOOL_NAMES)[number];

/**
 * UI metadata for the custom terminal tools. Lives in the shared catalog so the
 * renderer's ToolCard can render them with first-class icons/verbs even though
 * their executable definitions live in the main process.
 */
export const TERMINAL_TOOL_UI: Record<TerminalToolName, ToolUiMeta> = {
  terminal_run: { iconName: "terminal", verb: "Terminal", mono: true, primaryArgKey: "command" },
  terminal_read: {
    iconName: "terminal",
    verb: "Read terminal",
    mono: true,
    primaryArgKey: "terminal_id",
  },
  terminal_list: { iconName: "terminal", verb: "Listed terminals", mono: false },
  terminal_write: {
    iconName: "terminal",
    verb: "Sent input",
    mono: true,
    primaryArgKey: "input",
  },
  terminal_kill: {
    iconName: "terminal",
    verb: "Killed terminal",
    mono: true,
    primaryArgKey: "terminal_id",
  },
};

/** Agent-facing to-do tool (custom tool registered at runtime). */
export const TODO_TOOL_NAME = "todo_write";

/** UI metadata for the to-do tool (its calls render as the live TodosCard). */
export const TODO_TOOL_UI: ToolUiMeta = {
  iconName: "todo",
  verb: "Updated to-dos",
  mono: false,
};

/** Agent-facing web tool names (custom tools registered at runtime). */
export const WEB_TOOL_NAMES = ["web_search", "web_fetch"] as const;

export type WebToolName = (typeof WEB_TOOL_NAMES)[number];

/**
 * UI metadata for the built-in web tools. Lives in the shared catalog so the
 * renderer's ToolCard renders them with a globe icon and a readable verb even
 * though their executable definitions live in the main process.
 */
export const WEB_TOOL_UI: Record<WebToolName, ToolUiMeta> = {
  web_search: { iconName: "globe", verb: "Searched the web", mono: false, primaryArgKey: "query" },
  web_fetch: { iconName: "globe", verb: "Fetched", mono: true, primaryArgKey: "url" },
};

/** Tool names belonging to a profile, derived from a catalog. */
export function toolNamesForProfile(
  catalog: ToolCatalogEntry[],
  profile: ToolProfileName,
): string[] {
  return catalog.filter((entry) => entry.profiles.includes(profile)).map((entry) => entry.name);
}

/** UI metadata for a builtin tool, or undefined for unknown/custom tools. */
export function getBuiltinToolUiMeta(name: string): ToolUiMeta | undefined {
  return BUILTIN_TOOL_CATALOG.find((entry) => entry.name === name)?.ui;
}

/** Namespacing prefix for MCP-bridged tools: mcp_<server>_<tool>. */
export const MCP_TOOL_PREFIX = "mcp_";

export function isMcpToolName(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX);
}

/**
 * UI metadata for an MCP-bridged tool. The verb carries the server name so a
 * call renders as "linear · create_issue" instead of an opaque identifier.
 */
export function getMcpToolUiMeta(name: string): ToolUiMeta {
  const rest = name.slice(MCP_TOOL_PREFIX.length);
  const separator = rest.indexOf("_");
  const server = separator > 0 ? rest.slice(0, separator) : rest;
  return { iconName: "tool", verb: server, mono: true };
}

/** UI metadata for any known tool (builtin, terminal, web, to-do, or MCP-bridged). */
export function getToolUiMeta(name: string): ToolUiMeta | undefined {
  if (isMcpToolName(name)) {
    return getMcpToolUiMeta(name);
  }
  if (name === TODO_TOOL_NAME) {
    return TODO_TOOL_UI;
  }
  return (
    getBuiltinToolUiMeta(name) ??
    TERMINAL_TOOL_UI[name as TerminalToolName] ??
    WEB_TOOL_UI[name as WebToolName]
  );
}
