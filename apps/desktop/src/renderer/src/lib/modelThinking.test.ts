import { describe, expect, it } from "vitest";
import {
  modelThinkingOptions,
  selectedThinkingLabel,
  selectedThinkingOption,
} from "./modelThinking";

describe("modelThinkingOptions", () => {
  it("prefers explicit provider-facing thinking options", () => {
    const model = {
      thinkingLevel: "xhigh",
      thinkingLevels: ["off", "xhigh"],
      thinkingVariant: "max",
      thinkingOptions: [
        { value: "off", label: "Off", level: "off" },
        { value: "xhigh", label: "Extra High", level: "xhigh" },
        { value: "max", label: "Maximum", level: "xhigh" },
      ],
    } as const;

    expect(modelThinkingOptions(model).map((option) => option.value)).toEqual([
      "off",
      "xhigh",
      "max",
    ]);
    expect(selectedThinkingLabel(model)).toBe("Maximum");
    expect(selectedThinkingOption(model).value).toBe("max");
  });

  it("preserves the provider order for any number of discrete levels", () => {
    const model = {
      thinkingLevel: "high",
      thinkingLevels: ["off", "low", "high"],
    } as const;

    expect(modelThinkingOptions(model).map((option) => option.value)).toEqual([
      "off",
      "low",
      "high",
    ]);
    expect(selectedThinkingOption(model).value).toBe("high");
  });

  it("labels token-budget selections without inventing named levels", () => {
    expect(
      selectedThinkingLabel({
        thinkingLevel: "high",
        thinkingVariant: "32768",
        thinkingBudget: { min: 128, max: 32_768 },
      }),
    ).toBe("32,768 tokens");
  });
});
