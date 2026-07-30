import { describe, expect, it } from "vitest";
import { rectsOverlap } from "./pdfRectExcerpt";

describe("rectsOverlap", () => {
  it("detects intersection and separation", () => {
    expect(
      rectsOverlap(
        { left: 0, top: 0, right: 10, bottom: 10 },
        { left: 5, top: 5, right: 15, bottom: 15 },
      ),
    ).toBe(true);
    expect(
      rectsOverlap(
        { left: 0, top: 0, right: 10, bottom: 10 },
        { left: 10, top: 0, right: 20, bottom: 10 },
      ),
    ).toBe(false);
    expect(
      rectsOverlap(
        { left: 0, top: 0, right: 10, bottom: 10 },
        { left: 11, top: 0, right: 20, bottom: 10 },
      ),
    ).toBe(false);
  });
});
