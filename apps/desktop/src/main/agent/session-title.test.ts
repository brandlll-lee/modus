import { describe, expect, it } from "vitest";
import { deriveSessionTitle, shouldReplaceSessionTitle } from "./session-title";

describe("session title helpers", () => {
  it("replaces only empty or default session titles", () => {
    expect(shouldReplaceSessionTitle(undefined)).toBe(true);
    expect(shouldReplaceSessionTitle("")).toBe(true);
    expect(shouldReplaceSessionTitle("New chat")).toBe(true);
    expect(shouldReplaceSessionTitle("Modus local agent")).toBe(true);
    expect(shouldReplaceSessionTitle("Investigate markdown rendering")).toBe(false);
  });

  it("derives a normalized title from the first user message", () => {
    expect(deriveSessionTitle("  Fix   first-turn\nruntime race  ")).toBe(
      "Fix first-turn runtime race",
    );
    expect(deriveSessionTitle("   ")).toBe("New chat");
  });

  it("hard-caps long titles without ellipsis padding", () => {
    const long = "A".repeat(80);
    const title = deriveSessionTitle(long);
    expect(title).toBe("A".repeat(50));
    expect(title.includes("...")).toBe(false);
  });
});
