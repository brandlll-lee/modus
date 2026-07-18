import type { PermissionAction } from "./contracts";

/**
 * Single source of truth for the agent tool system (shared by the Electron main
 * process and the renderer). This file holds only serializable data + pure
 * helpers; runtime behavior that depends on the PI SDK (custom-tool execution,
 * dynamic permission classification) lives in `main/agent/tools/registry.ts`.
 */

/** Named tool sets. A session is created with one profile's active tools. */
export type ToolProfileName = "chat" | "review" | "plan";

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
  | "mcp"
  | "modus"
  | "todo"
  | "hierarchy"
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

export type ToolCapability = "read" | "write" | "shell" | "network" | "process";

/**
 * Which renderer card a tool's calls use. Declared here (data) so the renderer
 * routes by capability, never by tool name — adding a tool is a catalog entry,
 * not edits scattered across the timeline/diff/terminal consumers.
 * - `flat`: a one-line collapsible row (the default for any tool).
 * - `diff`: a Cursor-style diff card (see `diffSource`).
 * - `terminal`: a terminal card with a live output preview (see `terminalFramed`).
 * - `live`: a standalone live-output card.
 * - `todo`: rendered as the live to-do list, not as a tool row.
 * - `question`: a collapsible "Asked N questions" card listing each question + the chosen answer.
 */
export type ToolRenderKind =
  | "flat"
  | "diff"
  | "terminal"
  | "live"
  | "todo"
  | "plan"
  | "question"
  | "subagent"
  | "visual";

/**
 * How a `render: "diff"` tool's diff is derived from its call arguments.
 * - `edits`: args carry `edits: {oldText,newText}[]` (in-place edit).
 * - `newFile`: args carry `content` for a brand-new file (all-green diff).
 */
export type DiffSource = "edits" | "newFile";

export type ToolUiMeta = {
  iconName: ToolIconName;
  verb: string;
  /** Argument key used to derive the default target label shown after the verb. */
  primaryArgKey?: string;
  /** Which renderer card this tool's calls use. Absent ⇒ `flat`. */
  render?: ToolRenderKind;
  /** Which timeline activity fold this flat tool joins. Absent ⇒ standalone. */
  activity?: "explore" | "browser" | "shell";
  /** For `render: "diff"` — how to build the diff from the call's arguments. */
  diffSource?: DiffSource;
  /**
   * For `render: "terminal"` — whether the tool's output is Modus-framed
   * (a `$ cmd` header + `[terminal …]` status line, as terminal_run/_read emit)
   * or raw (like the PI `bash` tool, whose output is the body verbatim).
   */
  terminalFramed?: boolean;
};

export type ToolKind = "builtin" | "custom";

export type ToolCatalogEntry = {
  name: string;
  kind: ToolKind;
  /** Profiles this tool belongs to. Custom tools self-declare their membership. */
  profiles: ToolProfileName[];
  permission: ToolPermissionDecl;
  capabilities?: ToolCapability[];
  /** Omit to derive from permission.danger === "safe"; false marks safe-but-mutating tools. */
  readOnly?: boolean;
  ui: ToolUiMeta;
};

export const BUILTIN_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

/** The seven tools PI's DefaultResourceLoader ships out of the box. */
export const BUILTIN_TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    name: "read",
    kind: "builtin",
    profiles: ["chat", "review", "plan"],
    permission: { danger: "safe" },
    capabilities: ["read"],
    ui: { iconName: "file", verb: "Read", primaryArgKey: "path" },
  },
  {
    name: "bash",
    kind: "builtin",
    profiles: ["chat"],
    permission: { danger: "dynamic" },
    capabilities: ["shell", "process"],
    ui: {
      iconName: "terminal",
      verb: "Ran",
      primaryArgKey: "command",
      render: "terminal",
      terminalFramed: false,
    },
  },
  {
    name: "edit",
    kind: "builtin",
    profiles: ["chat"],
    permission: { danger: "dangerous", action: "file.write" },
    capabilities: ["write"],
    ui: {
      iconName: "pencil",
      verb: "Edited",
      primaryArgKey: "path",
      render: "diff",
      diffSource: "edits",
    },
  },
  {
    name: "write",
    kind: "builtin",
    profiles: ["chat"],
    permission: { danger: "dangerous", action: "file.write" },
    capabilities: ["write"],
    ui: {
      iconName: "file-plus",
      verb: "Wrote",
      primaryArgKey: "path",
      render: "diff",
      diffSource: "newFile",
    },
  },
  {
    name: "grep",
    kind: "builtin",
    profiles: ["chat", "review", "plan"],
    permission: { danger: "safe" },
    capabilities: ["read"],
    ui: { iconName: "search", verb: "Grepped", primaryArgKey: "pattern" },
  },
  {
    name: "find",
    kind: "builtin",
    profiles: ["chat", "review", "plan"],
    permission: { danger: "safe" },
    capabilities: ["read"],
    ui: { iconName: "file-search", verb: "Searched", primaryArgKey: "pattern" },
  },
  {
    name: "ls",
    kind: "builtin",
    profiles: ["chat", "review", "plan"],
    permission: { danger: "safe" },
    capabilities: ["read"],
    ui: { iconName: "folder", verb: "Listed", primaryArgKey: "path" },
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
  terminal_run: {
    iconName: "terminal",
    verb: "Terminal",
    primaryArgKey: "command",
    render: "terminal",
    terminalFramed: true,
  },
  terminal_read: {
    iconName: "terminal",
    verb: "Read terminal",
    primaryArgKey: "terminal_id",
    render: "terminal",
    terminalFramed: true,
  },
  terminal_list: { iconName: "terminal", verb: "Listed terminals" },
  terminal_write: {
    iconName: "terminal",
    verb: "Sent input",
    primaryArgKey: "input",
  },
  terminal_kill: {
    iconName: "terminal",
    verb: "Killed terminal",
    primaryArgKey: "terminal_id",
  },
};

/** Agent-facing GUI app launch tool (custom tool registered at runtime). */
export const APP_TOOL_NAMES = ["launch_app"] as const;

export type AppToolName = (typeof APP_TOOL_NAMES)[number];

/** UI metadata for the GUI app launch tool. */
export const APP_TOOL_UI: Record<AppToolName, ToolUiMeta> = {
  launch_app: { iconName: "terminal", verb: "Launched app", primaryArgKey: "path" },
};

/** Agent-facing local codebase index tool. */
export const FAST_CODEBASE_TOOL_NAME = "fast_codebase";

/** UI metadata for Fast Codebase. */
export const FAST_CODEBASE_TOOL_UI: ToolUiMeta = {
  iconName: "hierarchy",
  verb: "Fast Codebase",
  primaryArgKey: "query",
  render: "live",
};

/** Agent-facing inline custom visual tool. */
export const VISUAL_TOOL_NAME = "visual_write";
/** UI metadata for inline custom visuals (Claude-style temporary widgets). */
export const VISUAL_TOOL_UI: ToolUiMeta = {
  iconName: "tool",
  verb: "Visual",
  primaryArgKey: "title",
  render: "visual",
};

/** Agent-facing to-do tool (custom tool registered at runtime). */
export const TODO_TOOL_NAME = "todo_write";
/** UI metadata for the to-do tool (its calls render as the live TodosCard). */
export const TODO_TOOL_UI: ToolUiMeta = {
  iconName: "todo",
  verb: "Updated to-dos",
  render: "todo",
};

/** Agent-facing Plan Mode tool — writes the single plan.md artifact. */
export const PLAN_TOOL_NAME = "plan_write";
/** UI metadata for the first-class plan artifact rendered in the conversation. */
export const PLAN_TOOL_UI: ToolUiMeta = {
  iconName: "todo",
  verb: "Plan",
  primaryArgKey: "title",
  render: "plan",
};

/** Agent-facing interactive question tool — asks the user, blocks on the answer. */
export const ASK_USER_TOOL_NAME = "ask_user";
/**
 * UI metadata for the ask_user tool. Its call renders as a minimal flat row
 * ("Asking …"); the real interaction is the QuestionsCard shown above the
 * composer (the same interaction region used by the plan decision card).
 */
export const ASK_USER_TOOL_UI: ToolUiMeta = {
  iconName: "tool",
  verb: "Asking",
  render: "question",
};

/** Agent-facing subagent delegation tool (custom tool registered at runtime). */
export const SUBAGENT_TOOL_NAMES = ["task"] as const;

export type SubagentToolName = (typeof SUBAGENT_TOOL_NAMES)[number];

export const SUBAGENT_TOOL_UI: Record<SubagentToolName, ToolUiMeta> = {
  task: {
    iconName: "tool",
    verb: "Started subagent",
    primaryArgKey: "description",
    render: "subagent",
  },
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
  web_search: { iconName: "globe", verb: "Searched the web", primaryArgKey: "query" },
  web_fetch: { iconName: "globe", verb: "Fetched", primaryArgKey: "url" },
};

/** In-app browser primitives: tab ownership, raw CDP, recent events, snapshots, screenshots. */
export const BROWSER_TOOL_NAMES = [
  "browser_tabs",
  "browser_cdp",
  "browser_events",
  "browser_snapshot",
  "browser_screenshot",
] as const;

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number];

export const BROWSER_TOOL_UI: Record<BrowserToolName, ToolUiMeta> = {
  browser_tabs: {
    iconName: "globe",
    verb: "Browser tabs",
    primaryArgKey: "action",
    activity: "browser",
  },
  browser_cdp: {
    iconName: "globe",
    verb: "Sent CDP",
    primaryArgKey: "method",
    activity: "browser",
  },
  browser_events: { iconName: "globe", verb: "Read browser events", activity: "browser" },
  browser_snapshot: { iconName: "globe", verb: "Captured snapshot", activity: "browser" },
  browser_screenshot: { iconName: "globe", verb: "Captured page", activity: "browser" },
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
  return { iconName: "mcp", verb: server };
}

/** UI metadata for any known tool (builtin, terminal, web, to-do, or MCP-bridged). */
export function getToolUiMeta(name: string): ToolUiMeta | undefined {
  if (isMcpToolName(name)) {
    return getMcpToolUiMeta(name);
  }
  if (name === TODO_TOOL_NAME) {
    return TODO_TOOL_UI;
  }
  if (name === PLAN_TOOL_NAME) {
    return PLAN_TOOL_UI;
  }
  if (name === ASK_USER_TOOL_NAME) {
    return ASK_USER_TOOL_UI;
  }
  return (
    getBuiltinToolUiMeta(name) ??
    TERMINAL_TOOL_UI[name as TerminalToolName] ??
    APP_TOOL_UI[name as AppToolName] ??
    (name === FAST_CODEBASE_TOOL_NAME ? FAST_CODEBASE_TOOL_UI : undefined) ??
    (name === VISUAL_TOOL_NAME ? VISUAL_TOOL_UI : undefined) ??
    SUBAGENT_TOOL_UI[name as SubagentToolName] ??
    WEB_TOOL_UI[name as WebToolName] ??
    BROWSER_TOOL_UI[name as BrowserToolName]
  );
}

/**
 * Render kind for a tool's calls, defaulting to "flat" for plain, unknown, or
 * MCP-bridged tools. Renderer consumers route on this capability instead of
 * matching tool names, so a new tool only declares its `render` in the catalog.
 */
export function toolRenderKind(name: string): ToolRenderKind {
  return getToolUiMeta(name)?.render ?? "flat";
}
