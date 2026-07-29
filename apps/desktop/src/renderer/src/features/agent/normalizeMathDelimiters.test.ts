import { describe, expect, it } from "vitest";
import { normalizeMathDelimiters } from "./normalizeMathDelimiters";

describe("normalizeMathDelimiters", () => {
  it("maps LaTeX display and inline fences to dollar math", () => {
    const input = [
      "核心公式：",
      "\\[",
      "\\mathrm{Attention}(Q, K, V)",
      "\\]",
      "",
      "行内 \\(X \\in \\mathbb{R}^{n}\\) 即可。",
    ].join("\n");

    expect(normalizeMathDelimiters(input)).toBe(
      [
        "核心公式：",
        "$$",
        "\\mathrm{Attention}(Q, K, V)",
        "$$",
        "",
        "行内 $X \\in \\mathbb{R}^{n}$ 即可。",
      ].join("\n"),
    );
  });

  it("leaves existing dollar math and plain prose alone", () => {
    const input = "Already $$E=mc^2$$ and $x$ plus plain text.";
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it("does not rewrite TeX delimiters inside fenced code", () => {
    const input = ["```tex", "\\[ a = b \\]", "\\(c\\)", "```", "", "out \\(d\\)"].join("\n");
    expect(normalizeMathDelimiters(input)).toBe(
      ["```tex", "\\[ a = b \\]", "\\(c\\)", "```", "", "out $d$"].join("\n"),
    );
  });
});
