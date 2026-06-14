import { describe, expect, it } from "vitest";
import { computeBrowserViewBounds, sameBrowserBounds } from "./browserBounds";

describe("browser native view bounds", () => {
  it("rounds viewport-relative DOM coordinates for WebContentsView bounds", () => {
    expect(
      computeBrowserViewBounds({ left: 397.4, top: 140.6, width: 1185.5, height: 874.2 }),
    ).toEqual({
      x: 397,
      y: 141,
      width: 1186,
      height: 874,
    });
  });

  it("treats position changes as native bounds changes", () => {
    const previous = { x: 468, y: 141, width: 1186, height: 874 };

    expect(sameBrowserBounds(previous, { x: 397, y: 141, width: 1186, height: 874 })).toBe(false);
  });
});
