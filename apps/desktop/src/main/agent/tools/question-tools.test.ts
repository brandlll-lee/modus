import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { registerQuestionTools } from "./question-tools";
import { toolRegistry } from "./registry";

function toolEvent(toolName: string, input: Record<string, unknown>): ToolCallEvent {
  return { type: "tool_call", toolCallId: "t1", toolName, input } as ToolCallEvent;
}

describe("registerQuestionTools", () => {
  it("registers ask_user into both the plan and chat profiles", () => {
    registerQuestionTools();
    expect(new Set(toolRegistry.resolveActiveTools("plan")).has("ask_user")).toBe(true);
    expect(new Set(toolRegistry.resolveActiveTools("chat")).has("ask_user")).toBe(true);
  });

  it("keeps ask_user out of the read-only review profile", () => {
    registerQuestionTools();
    expect(new Set(toolRegistry.resolveActiveTools("review")).has("ask_user")).toBe(false);
  });

  it("classifies ask_user as safe (a read-only round-trip, no approval prompt)", () => {
    registerQuestionTools();
    expect(toolRegistry.classify(toolEvent("ask_user", { questions: [] })).dangerous).toBe(false);
  });

  it("is idempotent — calling twice does not duplicate the definition", () => {
    registerQuestionTools();
    registerQuestionTools();
    const definitions = toolRegistry
      .getCustomToolDefinitions("plan")
      .filter((definition) => definition.name === "ask_user");
    expect(definitions).toHaveLength(1);
  });
});
