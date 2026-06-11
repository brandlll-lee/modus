import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { toolRegistry } from "./registry";
import { registerWebTools } from "./web-tools";

function toolEvent(toolName: string, input: Record<string, unknown>): ToolCallEvent {
  return { type: "tool_call", toolCallId: "t1", toolName, input } as ToolCallEvent;
}

describe("registerWebTools", () => {
  it("registers web_search and web_fetch into the chat profile", () => {
    registerWebTools();
    const chat = new Set(toolRegistry.resolveActiveTools("chat"));
    expect(chat.has("web_search")).toBe(true);
    expect(chat.has("web_fetch")).toBe(true);
  });

  it("keeps web tools out of the read-only review profile", () => {
    registerWebTools();
    const review = new Set(toolRegistry.resolveActiveTools("review"));
    expect(review.has("web_search")).toBe(false);
    expect(review.has("web_fetch")).toBe(false);
  });

  it("classifies both web tools as safe (no approval prompt)", () => {
    registerWebTools();
    expect(toolRegistry.classify(toolEvent("web_search", { query: "x" })).dangerous).toBe(false);
    expect(toolRegistry.classify(toolEvent("web_fetch", { url: "https://x" })).dangerous).toBe(
      false,
    );
  });

  it("is idempotent — calling twice does not duplicate definitions", () => {
    registerWebTools();
    registerWebTools();
    const definitions = toolRegistry
      .getCustomToolDefinitions("chat")
      .filter((definition) => definition.name === "web_search");
    expect(definitions).toHaveLength(1);
  });
});
