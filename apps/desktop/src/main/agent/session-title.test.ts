import { describe, expect, it } from "vitest";
import { cleanSessionTitleText, shouldReplaceSessionTitle } from "./session-title";

describe("session title helpers", () => {
  it("replaces only empty or default session titles", () => {
    expect(shouldReplaceSessionTitle(undefined)).toBe(true);
    expect(shouldReplaceSessionTitle("")).toBe(true);
    expect(shouldReplaceSessionTitle("New chat")).toBe(true);
    expect(shouldReplaceSessionTitle("Modus local agent")).toBe(true);
    expect(shouldReplaceSessionTitle("Investigate markdown rendering")).toBe(false);
  });

  it("cleans model output into a single-line title", () => {
    expect(cleanSessionTitleText('  "Nanochat pretraining survey"  ')).toBe(
      "Nanochat pretraining survey",
    );
    expect(
      cleanSessionTitleText("<think>scratch</think>\nDebugging production 500 errors\nextra"),
    ).toBe("Debugging production 500 errors");
  });

  it("hard-caps long model titles without ellipsis padding", () => {
    const long = "A".repeat(80);
    const cleaned = cleanSessionTitleText(long);
    expect(cleaned).toBe("A".repeat(50));
    expect(cleaned?.includes("...")).toBe(false);
  });
});
