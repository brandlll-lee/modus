import { describe, expect, it } from "vitest";
import type { ProviderModelConfig } from "../../../../shared/contracts";
import { groupProviderModels, modelResultLabel } from "./modelListUtils";

function model(id: string, patch: Partial<ProviderModelConfig> = {}): ProviderModelConfig {
  return {
    contextWindow: 128_000,
    enabled: false,
    id,
    maxTokens: 16_384,
    name: id,
    reasoning: false,
    thinkingLevel: "off",
    thinkingLevels: ["off"],
    ...patch,
  };
}

describe("modelListUtils", () => {
  it("groups enabled models before available thinking and standard models", () => {
    const groups = groupProviderModels([
      model("standard"),
      model("enabled-standard", { enabled: true }),
      model("thinking", { reasoning: true, thinkingLevel: "minimal" }),
      model("enabled-thinking", {
        enabled: true,
        reasoning: true,
        thinkingLevel: "high",
      }),
    ]);

    expect(groups.map((group) => group.id)).toEqual(["enabled", "thinking", "standard"]);
    expect(groups[0]?.models.map((item) => item.id)).toEqual([
      "enabled-standard",
      "enabled-thinking",
    ]);
    expect(groups[1]?.models.map((item) => item.id)).toEqual(["thinking"]);
    expect(groups[2]?.models.map((item) => item.id)).toEqual(["standard"]);
  });

  it("omits empty groups and formats counts", () => {
    expect(groupProviderModels([model("only")]).map((group) => group.id)).toEqual(["standard"]);
    expect(modelResultLabel(1)).toBe("1 model shown");
    expect(modelResultLabel(12)).toBe("12 models shown");
  });
});
