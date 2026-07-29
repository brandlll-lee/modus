import { describe, expect, it } from "vitest";
import { shouldSkipPdfRefit } from "./pdfFit";

describe("shouldSkipPdfRefit", () => {
  it("never skips before the first completed paint (lastFitWidth === 0)", () => {
    expect(shouldSkipPdfRefit(0, 800)).toBe(false);
  });

  it("skips tiny resize echoes after a completed paint", () => {
    expect(shouldSkipPdfRefit(800, 805)).toBe(true);
    expect(shouldSkipPdfRefit(800, 812)).toBe(true); // |Δ| = 12 < 24
  });

  it("re-renders at the epsilon boundary and beyond", () => {
    expect(shouldSkipPdfRefit(800, 776)).toBe(false); // |Δ| = 24
    expect(shouldSkipPdfRefit(800, 825)).toBe(false); // |Δ| = 25
    expect(shouldSkipPdfRefit(800, 400)).toBe(false);
  });
});
