import { describe, expect, it } from "vitest";
import { buildContextChips, contextChipFor } from "./context-chips";

describe("excerpt context chips", () => {
  it("builds a display chip from capture-time text without inventing line ranges", () => {
    const chip = contextChipFor({
      type: "excerpt",
      path: "/ws/papers/paper.pdf",
      text: "diffusion process is fixed",
      locator: "p.2",
    });
    expect(chip).toEqual({
      kind: "excerpt",
      label: "paper.pdf",
      detail: "p.2",
    });
  });

  it("filters unknown kinds to avoid null holes in chip arrays", () => {
    const chips = buildContextChips([
      { type: "excerpt", path: "/a.pdf", text: "hello" },
      // @ts-expect-error intentional unknown persisted kind
      { type: "document-region", path: "/a.pdf" },
    ]);
    expect(chips).toEqual([{ kind: "excerpt", label: "a.pdf" }]);
  });
});
