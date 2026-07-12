import { describe, expect, it } from "vitest";
import { nextPacedTextIndex } from "./useSmoothStreamingText";

describe("streaming text pace", () => {
  it("advances in small grapheme-safe batches and snaps to punctuation", () => {
    expect(nextPacedTextIndex("abcdefghijkl", 0)).toBe(2);
    const emojiPair = "👨‍👩‍👧‍👦a";
    expect(nextPacedTextIndex(emojiPair, 0)).toBe(emojiPair.length);
    expect(nextPacedTextIndex("abcdef，next", 0)).toBe("abcdef，".length);
  });
});
