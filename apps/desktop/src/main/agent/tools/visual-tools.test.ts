import { describe, expect, it } from "vitest";
import { VISUAL_TOOL_NAME } from "../../../shared/tools";
import { toolRegistry } from "./registry";
import { registerVisualTools } from "./visual-tools";

describe("registerVisualTools", () => {
  it("registers visual_write for chat only", () => {
    registerVisualTools();

    expect(toolRegistry.resolveActiveTools("chat")).toContain(VISUAL_TOOL_NAME);
    expect(toolRegistry.resolveActiveTools("review")).not.toContain(VISUAL_TOOL_NAME);
    expect(toolRegistry.resolveActiveTools("plan")).not.toContain(VISUAL_TOOL_NAME);
  });

  it("keeps visual_write safe but mutating", () => {
    registerVisualTools();

    expect(toolRegistry.classify({ toolName: VISUAL_TOOL_NAME, input: {} } as never)).toEqual({
      action: "mcp.call",
      dangerous: false,
    });
    expect(toolRegistry.isReadOnlySafe(VISUAL_TOOL_NAME)).toBe(false);
  });
});
