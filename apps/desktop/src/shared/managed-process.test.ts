import { describe, expect, it } from "vitest";
import { formatElapsed } from "./managed-process";

describe("formatElapsed", () => {
  it("formats sub-minute durations as seconds", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(45_000)).toBe("45s");
    expect(formatElapsed(59_900)).toBe("59s");
  });

  it("formats minutes with remaining seconds (Cursor's 2m 27s)", () => {
    expect(formatElapsed(147_000)).toBe("2m 27s");
    expect(formatElapsed(60_000)).toBe("1m 0s");
  });

  it("formats hours with remaining minutes", () => {
    expect(formatElapsed(3_900_000)).toBe("1h 5m");
  });

  it("clamps negatives and non-finite input to zero", () => {
    expect(formatElapsed(-5000)).toBe("0s");
    expect(formatElapsed(Number.NaN)).toBe("0s");
  });
});
