import { describe, expect, it } from "vitest";
import { getMcpToolUiMeta, getToolUiMeta, isMcpToolName } from "./tools";

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
