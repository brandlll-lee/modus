import { describe, expect, it } from "vitest";
import { clampViewportRect, growViewportRect } from "./view-capture";

const viewport = { x: 0, y: 0, width: 800, height: 600 };

describe("clampViewportRect", () => {
  it("keeps the requested size when the rect fits", () => {
    expect(clampViewportRect({ x: 120, y: 80, width: 200, height: 100 }, viewport)).toEqual({
      x: 120,
      y: 80,
      width: 200,
      height: 100,
    });
  });

  it("clamps to the visible view", () => {
    expect(clampViewportRect({ x: 700, y: 500, width: 200, height: 200 }, viewport)).toEqual({
      x: 700,
      y: 500,
      width: 100,
      height: 100,
    });
  });
});

describe("growViewportRect", () => {
  it("grows around the element and stays inside the view", () => {
    const grown = growViewportRect({ x: 350, y: 250, width: 40, height: 20 }, viewport);
    expect(grown.width).toBeGreaterThanOrEqual(360);
    expect(grown.height).toBeGreaterThanOrEqual(360);
    expect(grown.x).toBeGreaterThanOrEqual(0);
    expect(grown.y).toBeGreaterThanOrEqual(0);
    expect(grown.x + grown.width).toBeLessThanOrEqual(viewport.width);
    expect(grown.y + grown.height).toBeLessThanOrEqual(viewport.height);
  });

  it("does not invent off-screen document pixels", () => {
    const grown = growViewportRect({ x: 10, y: 10, width: 20, height: 20 }, viewport);
    expect(grown.x).toBe(0);
    expect(grown.y).toBe(0);
  });
});
