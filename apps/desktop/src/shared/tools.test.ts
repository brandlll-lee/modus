import { describe, expect, it } from "vitest";
import { getMcpToolUiMeta, getToolUiMeta, isMcpToolName, toolRenderKind } from "./tools";

describe("MCP tool UI metadata", () => {
  it("detects MCP-bridged tool names", () => {
    expect(isMcpToolName("mcp_linear_create_issue")).toBe(true);
    expect(isMcpToolName("bash")).toBe(false);
    expect(isMcpToolName("terminal_run")).toBe(false);
  });

  it("uses the server name as the verb", () => {
    expect(getMcpToolUiMeta("mcp_linear_create_issue")).toEqual({
      iconName: "tool",
      verb: "linear",
      mono: true,
    });
  });

  it("routes MCP names through the shared lookup", () => {
    expect(getToolUiMeta("mcp_github_search")?.verb).toBe("github");
    expect(getToolUiMeta("bash")?.verb).toBe("Ran");
    expect(getToolUiMeta("terminal_run")?.verb).toBe("Terminal");
    expect(getToolUiMeta("browser_navigate")?.verb).toBe("Navigated");
  });
});

describe("tool render descriptor (single source of truth)", () => {
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
  });
});
