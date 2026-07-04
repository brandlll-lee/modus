import { describe, expect, it } from "vitest";
import {
  BROWSER_TOOL_NAMES,
  FAST_CODEBASE_TOOL_NAME,
  getMcpToolUiMeta,
  getToolUiMeta,
  isMcpToolName,
  toolRenderKind,
} from "./tools";

describe("MCP tool UI metadata", () => {
  it("detects MCP-bridged tool names", () => {
    expect(isMcpToolName("mcp_linear_create_issue")).toBe(true);
    expect(isMcpToolName("bash")).toBe(false);
    expect(isMcpToolName("terminal_run")).toBe(false);
  });

  it("uses the server name as the verb", () => {
    expect(getMcpToolUiMeta("mcp_linear_create_issue")).toEqual({
      iconName: "mcp",
      verb: "linear",
    });
  });

  it("routes MCP names through the shared lookup", () => {
    expect(getToolUiMeta("mcp_github_search")?.verb).toBe("github");
    expect(getToolUiMeta("bash")?.verb).toBe("Ran");
    expect(getToolUiMeta("terminal_run")?.verb).toBe("Terminal");
    expect(getToolUiMeta("browser_cdp")?.verb).toBe("Sent CDP");
  });
});

describe("tool render descriptor (single source of truth)", () => {
  it("keeps browser tools at the low-level primitive surface", () => {
    expect([...BROWSER_TOOL_NAMES]).toEqual([
      "browser_tabs",
      "browser_cdp",
      "browser_events",
      "browser_snapshot",
      "browser_screenshot",
    ]);
  });

  it("declares each render kind on the catalog, not in consumers", () => {
    // Diff tools carry a diffSource so the diff strategy is data, not a name check.
    expect(getToolUiMeta("edit")?.render).toBe("diff");
    expect(getToolUiMeta("edit")?.diffSource).toBe("edits");
    expect(getToolUiMeta("write")?.render).toBe("diff");
    expect(getToolUiMeta("write")?.diffSource).toBe("newFile");

    // Terminal tools carry terminalFramed so output parsing is data, not a name check.
    expect(getToolUiMeta("bash")?.render).toBe("terminal");
    expect(getToolUiMeta("bash")?.terminalFramed).toBe(false);
    expect(getToolUiMeta("terminal_run")?.terminalFramed).toBe(true);
    expect(getToolUiMeta("terminal_read")?.terminalFramed).toBe(true);

    expect(getToolUiMeta("todo_write")?.render).toBe("todo");
    expect(getToolUiMeta(FAST_CODEBASE_TOOL_NAME)?.render).toBe("live");
    expect(getToolUiMeta(FAST_CODEBASE_TOOL_NAME)?.activity).toBeUndefined();
    expect(getToolUiMeta("plan_write")?.render).toBe("diff");
    expect(getToolUiMeta("plan_write")?.diffSource).toBe("newFile");
  });

  it("defaults unknown, MCP, and plain tools to a flat row", () => {
    // The whole point: a tool the renderer has never heard of routes safely to
    // flat without any consumer edit. Adding a real tool only sets `render`.
    expect(toolRenderKind("read")).toBe("flat");
    expect(toolRenderKind("grep")).toBe("flat");
    expect(toolRenderKind("mcp_linear_create_issue")).toBe("flat");
    expect(toolRenderKind("a_future_tool_we_never_special_cased")).toBe("flat");
  });

  it("maps known tools to their declared render kind", () => {
    expect(toolRenderKind("edit")).toBe("diff");
    expect(toolRenderKind("write")).toBe("diff");
    expect(toolRenderKind("bash")).toBe("terminal");
    expect(toolRenderKind("terminal_run")).toBe("terminal");
    expect(toolRenderKind("todo_write")).toBe("todo");
    expect(toolRenderKind(FAST_CODEBASE_TOOL_NAME)).toBe("live");
    expect(toolRenderKind("plan_write")).toBe("diff");
  });

  it("renders task as the only subagent model-visible tool", () => {
    expect(getToolUiMeta("task")).toEqual(
      expect.objectContaining({ iconName: "tool", render: "subagent" }),
    );
    expect(getToolUiMeta("wait_agent")).toBeUndefined();
    expect(getToolUiMeta("list_agents")).toBeUndefined();
  });
});
