import { describe, expect, it } from "vitest";
import {
  CLAUDE_EFFORT_MAP,
  createCustomModelRow,
  detectThinkingPreset,
  modelConfigToRow,
  OPENAI_EFFORT_MAP,
  protocolFor,
  rowProtocol,
  rowThinkingLevelMap,
  rowToModelInput,
  slugifyProviderId,
} from "./provider-form-mapping";

describe("thinking presets", () => {
  it("maps the Claude preset onto adaptive efforts including max", () => {
    const row = { ...createCustomModelRow(), id: "claude-x", reasoning: true };
    row.thinkingPreset = "claude";

    expect(rowThinkingLevelMap(row)).toEqual({
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "max",
    });
  });

  it("returns no map for the provider-default preset and non-reasoning models", () => {
    const row = { ...createCustomModelRow(), id: "m", reasoning: true };
    expect(rowThinkingLevelMap(row)).toBeUndefined();

    const nonReasoning = {
      ...createCustomModelRow(),
      id: "m",
      reasoning: false,
      thinkingPreset: "claude" as const,
    };
    expect(rowThinkingLevelMap(nonReasoning)).toBeUndefined();
  });

  it("builds custom maps where blank fields hide levels and off stays optional", () => {
    const row = {
      ...createCustomModelRow(),
      id: "m",
      reasoning: true,
      thinkingPreset: "custom" as const,
      thinkingOff: "",
      thinkingMinimal: "",
      thinkingLow: " light ",
      thinkingMedium: "",
      thinkingHigh: "deep",
      thinkingXHigh: "max",
    };

    expect(rowThinkingLevelMap(row)).toEqual({
      minimal: null,
      low: "light",
      medium: null,
      high: "deep",
      xhigh: "max",
    });
  });

  it("detects presets when re-opening a stored provider", () => {
    expect(detectThinkingPreset(undefined)).toBe("default");
    expect(detectThinkingPreset({ ...CLAUDE_EFFORT_MAP })).toBe("claude");
    expect(detectThinkingPreset({ ...OPENAI_EFFORT_MAP })).toBe("openai");
    expect(detectThinkingPreset({ low: "low", high: "ultra" })).toBe("custom");
  });
});

describe("rowToModelInput", () => {
  it("writes anthropic switches only for anthropic-protocol models", () => {
    const row = {
      ...createCustomModelRow(),
      id: "claude-opus-4-7",
      reasoning: true,
      adaptiveThinking: true,
      allowEmptySignature: true,
      thinkingPreset: "claude" as const,
      thinkingFormat: "openrouter" as const,
    };

    const anthropic = rowToModelInput(row, "anthropic-messages");
    expect(anthropic.compatibility).toEqual({
      thinkingFormat: "none",
      supportsUsageInStreaming: false,
      forceAdaptiveThinking: true,
      allowEmptySignature: true,
    });
    expect(anthropic.thinkingLevelMap).toEqual(CLAUDE_EFFORT_MAP);

    const openai = rowToModelInput(row, "openai-completions");
    expect(openai.compatibility).toEqual({
      thinkingFormat: "openrouter",
      supportsUsageInStreaming: false,
    });
  });

  it("keeps the thinking format quiet for non-reasoning models", () => {
    const row = { ...createCustomModelRow(), id: "plain", thinkingFormat: "deepseek" as const };
    const input = rowToModelInput(row, "openai-completions");
    expect(input.compatibility?.thinkingFormat).toBe("none");
    expect(input.thinkingLevelMap).toBeUndefined();
  });

  it("respects the per-model protocol override", () => {
    const row = {
      ...createCustomModelRow(),
      id: "claude-relay",
      api: "anthropic-messages",
      reasoning: true,
      adaptiveThinking: true,
    };
    expect(rowProtocol(row, "openai-completions")).toBe("anthropic-messages");
    const input = rowToModelInput(row, "openai-completions");
    expect(input.api).toBe("anthropic-messages");
    expect(input.compatibility?.forceAdaptiveThinking).toBe(true);
  });

  it("round-trips a stored anthropic model back into the same row shape", () => {
    const row = {
      ...createCustomModelRow(),
      id: "claude-opus-4-7",
      name: "Opus via relay",
      reasoning: true,
      adaptiveThinking: true,
      allowEmptySignature: true,
      thinkingPreset: "claude" as const,
    };
    const input = rowToModelInput(row, "anthropic-messages");

    const reopened = modelConfigToRow({
      id: input.id,
      name: input.name ?? input.id,
      reasoning: input.reasoning ?? false,
      input: input.input ?? ["text"],
      ...(input.thinkingLevelMap ? { thinkingLevelMap: input.thinkingLevelMap } : {}),
      compat: {
        supportsUsageInStreaming: false,
        forceAdaptiveThinking: true,
        allowEmptySignature: true,
      },
    });

    expect(reopened.thinkingPreset).toBe("claude");
    expect(reopened.adaptiveThinking).toBe(true);
    expect(reopened.allowEmptySignature).toBe(true);
    expect(reopened.reasoning).toBe(true);
  });
});

describe("protocol metadata", () => {
  it("defaults bearer auth per protocol family", () => {
    expect(protocolFor("openai-completions")?.bearerByDefault).toBe(true);
    expect(protocolFor("openai-responses")?.bearerByDefault).toBe(true);
    expect(protocolFor("anthropic-messages")?.bearerByDefault).toBe(false);
    expect(protocolFor("google-generative-ai")?.bearerByDefault).toBe(false);
  });

  it("slugifies display names into provider ids", () => {
    expect(slugifyProviderId(" My Relay 2 ")).toBe("my-relay-2");
    expect(slugifyProviderId("中转 Relay!")).toBe("relay");
  });
});
