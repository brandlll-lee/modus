import { describe, expect, it } from "vitest";
import { splitSkillPrefix } from "./messageDisplay";

describe("splitSkillPrefix", () => {
  it("pulls selected slash skills out of the display text", () => {
    expect(splitSkillPrefix('"review" "qa" fix this')).toEqual({
      skills: ["review", "qa"],
      text: "fix this",
    });
  });

  it("leaves ordinary quoted text alone when it is not a slash prefix shape", () => {
    expect(splitSkillPrefix('"hello"\nworld')).toEqual({ skills: [], text: '"hello"\nworld' });
  });
});
