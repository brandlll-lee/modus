import { describe, expect, it } from "vitest";
import { isMentionMenuOpen, type MentionRow } from "./useComposerMentions";

describe("isMentionMenuOpen", () => {
  const headerOnly: MentionRow[] = [{ row: "header", id: "header", label: "Files & Folders" }];

  it("keeps a category menu open while results are loading", () => {
    expect(isMentionMenuOpen(true, "file", headerOnly)).toBe(true);
  });

  it("keeps the root menu closed when nothing is selectable", () => {
    expect(isMentionMenuOpen(true, "root", headerOnly)).toBe(false);
  });
});
