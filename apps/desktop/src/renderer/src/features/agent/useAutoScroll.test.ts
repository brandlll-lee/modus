import { describe, expect, it } from "vitest";
import { shouldAutoFollow, shouldPinOnEnd, shouldShowScrollToLatest } from "./useAutoScroll";

describe("shouldShowScrollToLatest", () => {
  it("follows only while working and the user has not scrolled away", () => {
    expect(shouldAutoFollow(true, false)).toBe(true);
    expect(shouldAutoFollow(false, false)).toBe(false);
    expect(shouldAutoFollow(true, true)).toBe(false);
  });

  it("pins the latest content only across a followed live-to-idle boundary", () => {
    expect(shouldPinOnEnd(true, false, false)).toBe(true);
    expect(shouldPinOnEnd(false, false, false)).toBe(false);
    expect(shouldPinOnEnd(true, true, false)).toBe(false);
    expect(shouldPinOnEnd(true, false, true)).toBe(false);
  });
  it("shows only after the user is more than one viewport away from latest content", () => {
    expect(shouldShowScrollToLatest(799, 800)).toBe(false);
    expect(shouldShowScrollToLatest(800, 800)).toBe(false);
    expect(shouldShowScrollToLatest(801, 800)).toBe(true);
  });

  it("does not show before the scroll viewport has been measured", () => {
    expect(shouldShowScrollToLatest(100, 0)).toBe(false);
  });
});
