import { describe, expect, it } from "vitest";
import { elementClipForRect } from "./screenshot";

describe("elementClipForRect", () => {
  it("converts viewport rects to document clip coordinates", () => {
    const rect = { x: 500, y: 300, width: 100, height: 50 };
    const page = { width: 3000, height: 3000 };
    const unscrolled = elementClipForRect(rect, page);
    const scrolled = elementClipForRect(rect, page, { pageX: 0, pageY: 900 });

    expect(scrolled).toEqual({ ...unscrolled, y: unscrolled.y + 900 });
  });
});
