import { describe, expect, it } from "vitest";
import { nextStreamingIndex } from "./MarkdownMessage";

describe("streaming Markdown presentation", () => {
  it("spreads any arrived burst monotonically across paint frames", () => {
    const text = "x".repeat(120);
    const first = nextStreamingIndex(text, 0, 16);
    const second = nextStreamingIndex(text, first, 16);
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(second).toBeLessThan(text.length);
  });
  it("drains the authoritative tail instead of requiring a completion flush", () => {
    const text = "tail".repeat(40);
    expect(nextStreamingIndex(text, 12, 1000)).toBe(text.length);
  });
  it("never splits a grapheme while advancing a small batch", () => {
    const family = "👨‍👩‍👧‍👦";
    const text = `${family} next`;
    expect(nextStreamingIndex(text, 0, 0)).toBe(family.length);
  });
});
