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

/**
 * In-app browser tool names (custom tools registered at runtime). The set and
 * semantics align with the industry-standard agent browser surface
 * (playwright-mcp / chrome-devtools-mcp): accessibility-tree snapshots with
 * refs, trusted CDP input, CSS-pixel screenshots that the model can see.
 */
export const BROWSER_TOOL_NAMES = [
  "browser_tabs",
  "browser_navigate",
  "browser_navigate_back",
  "browser_snapshot",
  "browser_take_screenshot",
  "browser_click",
  "browser_click_xy",
  "browser_hover",
  "browser_drag",
  "browser_fill",
  "browser_type",
  "browser_fill_form",
  "browser_select_option",
  "browser_scroll",
  "browser_wait_for",
  "browser_console_messages",
  "browser_network_requests",
  "browser_network_request",
  "browser_resize",
  "browser_press_key",
  "browser_handle_dialog",
  "browser_evaluate",
  "browser_profile_start",
  "browser_profile_stop",
] as const;

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number];

export const BROWSER_TOOL_UI: Record<BrowserToolName, ToolUiMeta> = {
  browser_tabs: { iconName: "globe", verb: "Browser tabs", mono: false, primaryArgKey: "action" },
  browser_navigate: { iconName: "globe", verb: "Navigated", mono: true, primaryArgKey: "url" },
  browser_navigate_back: { iconName: "globe", verb: "Went back", mono: false },
  browser_snapshot: { iconName: "globe", verb: "Snapshotted page", mono: false },
  browser_take_screenshot: { iconName: "globe", verb: "Captured page", mono: false },
  browser_click: { iconName: "globe", verb: "Clicked", mono: false, primaryArgKey: "element" },
  browser_click_xy: { iconName: "globe", verb: "Clicked coordinates", mono: false },
  browser_hover: { iconName: "globe", verb: "Hovered", mono: false, primaryArgKey: "element" },
  browser_drag: { iconName: "globe", verb: "Dragged", mono: false, primaryArgKey: "startElement" },
  browser_fill: { iconName: "globe", verb: "Filled", mono: false, primaryArgKey: "element" },
  browser_type: { iconName: "globe", verb: "Typed", mono: false, primaryArgKey: "element" },
  browser_fill_form: { iconName: "globe", verb: "Filled form", mono: false },
  browser_select_option: {
    iconName: "globe",
    verb: "Selected option",
    mono: false,
    primaryArgKey: "element",
  },
  browser_scroll: { iconName: "globe", verb: "Scrolled", mono: false },
  browser_wait_for: { iconName: "globe", verb: "Waited", mono: false, primaryArgKey: "text" },
  browser_console_messages: { iconName: "globe", verb: "Read console", mono: false },
  browser_network_requests: { iconName: "globe", verb: "Read network", mono: false },
  browser_network_request: {
    iconName: "globe",
    verb: "Inspected request",
    mono: true,
    primaryArgKey: "requestId",
  },
  browser_resize: { iconName: "globe", verb: "Resized browser", mono: false },
  browser_press_key: { iconName: "globe", verb: "Pressed key", mono: true, primaryArgKey: "key" },
  browser_handle_dialog: { iconName: "globe", verb: "Handled dialog", mono: false },
  browser_evaluate: {
    iconName: "globe",
    verb: "Evaluated in page",
    mono: true,
    primaryArgKey: "expression",
  },
  browser_profile_start: { iconName: "globe", verb: "Started profile", mono: false },
  browser_profile_stop: { iconName: "globe", verb: "Stopped profile", mono: false },
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
    WEB_TOOL_UI[name as WebToolName] ??
    BROWSER_TOOL_UI[name as BrowserToolName]
  );
}
