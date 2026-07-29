import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../../../shared/contracts";
import { lookupModel, modelIdentityLabel } from "./modelIdentity";

function model(partial: Partial<ModelInfo> & Pick<ModelInfo, "id" | "name">): ModelInfo {
  return {
    provider: "openai",
    available: true,
    enabled: true,
    configured: true,
    source: "builtin",
    supportsThinking: false,
    thinkingLevel: "off",
    thinkingLevels: ["off"],
    ...partial,
  };
}

describe("lookupModel", () => {
  it("resolves by catalog id and ignores unknowns", () => {
    const catalog = [model({ id: "openai/gpt-5.6-terra", name: "GPT 5.6 Terra" })];
    expect(lookupModel(catalog, "openai/gpt-5.6-terra")?.name).toBe("GPT 5.6 Terra");
    expect(lookupModel(catalog, "missing/model")).toBeUndefined();
    expect(lookupModel(undefined, "openai/gpt-5.6-terra")).toBeUndefined();
  });
});

describe("modelIdentityLabel", () => {
  it("uses the catalog display name without inventing casing from the id", () => {
    expect(modelIdentityLabel(model({ id: "openai/gpt-5.6-terra", name: "GPT 5.6 Terra" }))).toBe(
      "GPT 5.6 Terra",
    );
  });

  it("appends the provider-facing thinking label when thinking is on", () => {
    expect(
      modelIdentityLabel(
        model({
          id: "openai/gpt-5.6-terra",
          name: "GPT 5.6 Terra",
          supportsThinking: true,
          thinkingLevel: "high",
          thinkingLevels: ["off", "high"],
          thinkingVariant: "high",
          thinkingOptions: [
            { value: "off", label: "Off", level: "off" },
            { value: "high", label: "High", level: "high" },
          ],
        }),
      ),
    ).toBe("GPT 5.6 Terra High");
  });

  it("omits Off so the label stays a product name", () => {
    expect(
      modelIdentityLabel(
        model({
          id: "openai/gpt-5.6-terra",
          name: "GPT 5.6 Terra",
          supportsThinking: true,
          thinkingLevel: "off",
          thinkingVariant: "off",
          thinkingOptions: [{ value: "off", label: "Off", level: "off" }],
        }),
      ),
    ).toBe("GPT 5.6 Terra");
  });
});
