export type ToolIconName =
  | "globe"
  | "favicon"
  | "file"
  | "edit"
  | "terminal"
  | "search"
  | "folder"
  | "tool";

export type ToolRenderKind = "flat" | "diff" | "terminal";

export type ToolSummaryMeta = {
  verb: string;
  noun: { one: string; other: string };
  countBy: "call" | "target";
};

export type ToolUiMeta = {
  iconName?: ToolIconName;
  verb: string;

  primaryArgKey?: string;

  activeVerb?: string;

  imageVerb?: string;

  render?: ToolRenderKind;

  summary?: ToolSummaryMeta;

  filePreview?: "edits" | "content";
};

export type ToolCatalogEntry = {
  name: string;
  ui: ToolUiMeta;
};

export const BUILTIN_TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    name: "read",
    ui: {
      verb: "Read",
      imageVerb: "Viewed",
      iconName: "file",
      activeVerb: "Reading",
      primaryArgKey: "path",
      summary: { verb: "read", noun: { one: "file", other: "files" }, countBy: "target" },
    },
  },
  {
    name: "bash",
    ui: {
      verb: "Ran",
      activeVerb: "Running",
      primaryArgKey: "command",
      render: "terminal",
      summary: { verb: "ran", noun: { one: "command", other: "commands" }, countBy: "call" },
    },
  },
  {
    name: "powershell",
    ui: {
      verb: "Ran",
      activeVerb: "Running",
      primaryArgKey: "command",
      render: "terminal",
      summary: { verb: "ran", noun: { one: "command", other: "commands" }, countBy: "call" },
    },
  },
  {
    name: "edit",
    ui: {
      verb: "Edited",
      activeVerb: "Editing",
      primaryArgKey: "path",
      render: "diff",
      filePreview: "edits",
      summary: { verb: "edited", noun: { one: "file", other: "files" }, countBy: "target" },
    },
  },
  {
    name: "write",
    ui: {
      verb: "Wrote",
      activeVerb: "Writing",
      primaryArgKey: "path",
      render: "diff",
      filePreview: "content",
      summary: { verb: "wrote", noun: { one: "file", other: "files" }, countBy: "target" },
    },
  },
  {
    name: "grep",
    ui: { verb: "Grepped", activeVerb: "Searching", primaryArgKey: "pattern", iconName: "search" },
  },
  {
    name: "find",
    ui: { verb: "Searched", activeVerb: "Searching", primaryArgKey: "pattern", iconName: "search" },
  },
  {
    name: "ls",
    ui: { verb: "Listed", activeVerb: "Listing", primaryArgKey: "path", iconName: "folder" },
  },
];

export function getBuiltinToolUiMeta(name: string): ToolUiMeta | undefined {
  return BUILTIN_TOOL_CATALOG.find((entry) => entry.name === name)?.ui;
}

export function getToolUiMeta(name: string): ToolUiMeta | undefined {
  return getBuiltinToolUiMeta(name);
}

export function toolRenderKind(name: string): ToolRenderKind {
  return getToolUiMeta(name)?.render ?? "flat";
}
