import { describe, expect, it } from "vitest";
import { modelThinkingOptions, selectedThinkingLabel } from "./modelThinking";

describe("modelThinkingOptions", () => {
  it("prefers explicit provider-facing thinking options", () => {
    const model = {
      thinkingLevel: "xhigh",
      thinkingLevels: ["off", "xhigh"],
      thinkingVariant: "max",
      thinkingOptions: [
        { value: "off", label: "off", level: "off" },
        { value: "xhigh", label: "xhigh", level: "xhigh" },
        { value: "max", label: "max", level: "xhigh" },
      ],
    } as const;

    expect(modelThinkingOptions(model).map((option) => option.value)).toEqual([
      "off",
      "xhigh",
      "max",
    ]);
    expect(selectedThinkingLabel(model)).toBe("max");
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
