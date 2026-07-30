import { describe, expect, it } from "vitest";
import { trimIncompleteTrailingTag } from "./VisualToolCard";

describe("trimIncompleteTrailingTag", () => {
  it("keeps well-formed markup unchanged", () => {
    expect(trimIncompleteTrailingTag("<svg><rect /></svg>")).toBe("<svg><rect /></svg>");
    expect(trimIncompleteTrailingTag("<div>hi</div>")).toBe("<div>hi</div>");
  });

  it("strips a trailing incomplete tag fragment", () => {
    expect(trimIncompleteTrailingTag("<div>ok</div><spa")).toBe("<div>ok</div>");
    expect(trimIncompleteTrailingTag("<svg><circle cx=\"1\"")).toBe("<svg>");
  });

  it("leaves text without angle brackets alone", () => {
    expect(trimIncompleteTrailingTag("plain")).toBe("plain");
  });
});
