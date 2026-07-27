import { describe, expect, it } from "vitest";
import { normalizeApprovalCwd } from "./permission-store";

describe("normalizeApprovalCwd", () => {
  it("normalizes separators and strips trailing slashes", () => {
    const a = normalizeApprovalCwd("F:\\CodeHub\\modus\\");
    const b = normalizeApprovalCwd("F:/CodeHub/modus");
    expect(a).toBe(b);
    expect(a.includes("\\")).toBe(false);
    expect(a.endsWith("/")).toBe(false);
  });
});
