import { describe, expect, it } from "vitest";
import { shouldShowScrollToLatest } from "./useAutoScroll";

describe("shouldShowScrollToLatest", () => {
  it("shows only after the user is more than one viewport away from latest content", () => {
    expect(shouldShowScrollToLatest(799, 800)).toBe(false);
    expect(shouldShowScrollToLatest(800, 800)).toBe(false);
    expect(shouldShowScrollToLatest(801, 800)).toBe(true);
  });

  it("does not show before the scroll viewport has been measured", () => {
    expect(shouldShowScrollToLatest(100, 0)).toBe(false);
  });
});
