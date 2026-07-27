import { describe, expect, it } from "vitest";
import {
  extractRailEntries,
  messagePreview,
  previewLeftForRail,
  previewTopForAnchor,
  railEntryIndexAtClientY,
  railTrackHeight,
} from "./ConversationTimeline";
import type { MessageBlockItem, TimelineBlock } from "./Timeline";

function message(
  id: string,
  role: MessageBlockItem["role"],
  content: string,
  rest: Partial<Omit<MessageBlockItem, "id" | "type" | "role" | "content">> = {},
): MessageBlockItem {
  return { id, type: "message", role, content, ...rest };
}

describe("extractRailEntries", () => {
  it("extracts one entry per turn with the assistant reply folded into it", () => {
    const blocks: TimelineBlock[] = [
      message("u1", "user", "make it smaller", { createdAt: 1000 }),
      { id: "tool", type: "tool", name: "read", output: "" },
      message("a1", "assistant", "Done.", { createdAt: 2000 }),
    ];

    expect(extractRailEntries(blocks)).toEqual([
      {
        key: "u1",
        userPreview: "make it smaller",
        assistantPreview: "Done.",
        userCreatedAt: 1000,
        assistantCreatedAt: 2000,
      },
    ]);
  });

  it("uses each user message as the next turn boundary", () => {
    const blocks: TimelineBlock[] = [
      message("u1", "user", "first"),
      message("a1", "assistant", "first answer"),
      message("u2", "user", "second"),
      message("a2", "assistant", "second answer"),
    ];

    expect(extractRailEntries(blocks)).toEqual([
      expect.objectContaining({
        key: "u1",
        userPreview: "first",
        assistantPreview: "first answer",
      }),
      expect.objectContaining({
        key: "u2",
        userPreview: "second",
        assistantPreview: "second answer",
      }),
    ]);
  });

  it("skips empty messages, non-message blocks, and streaming assistant content", () => {
    const blocks: TimelineBlock[] = [
      message("empty", "user", "   "),
      message("u1", "user", "live turn"),
      message("live", "assistant", "still streaming", { streaming: true }),
      { id: "notice", type: "notice", title: "runtime error", body: "x" },
    ];

    expect(extractRailEntries(blocks)).toEqual([
      { key: "u1", userPreview: "live turn" },
    ]);
  });

  it("keeps entry keys stable when timeline block ids repeat", () => {
    const blocks: TimelineBlock[] = [
      message("repeat", "user", "first"),
      message("repeat", "user", "second"),
    ];

    expect(extractRailEntries(blocks).map((entry) => entry.key)).toEqual(["repeat", "repeat#2"]);
  });
});

describe("messagePreview", () => {
  it("normalizes markdown syntax into a compact text preview", () => {
    expect(
      messagePreview("# Title\n- [Docs](https://example.test) **bold** `code`\n> quoted"),
    ).toBe("Title Docs bold code quoted");
  });

  it("truncates long previews at the requested length", () => {
    expect(messagePreview("x".repeat(20), 10)).toBe("xxxxxxx...");
  });
});

describe("railTrackHeight", () => {
  it("uses a natural tick rhythm capped by the rail height", () => {
    expect(railTrackHeight(3, 10)).toBe("min(100%, 30px)");
  });
});

describe("railEntryIndexAtClientY", () => {
  it("maps pointer position to the row under the rail using track geometry", () => {
    expect(railEntryIndexAtClientY(10, 10, 30, 3)).toBe(0);
    expect(railEntryIndexAtClientY(20, 10, 30, 3)).toBe(1);
    expect(railEntryIndexAtClientY(40, 10, 30, 3)).toBe(2);
  });

  it("returns undefined outside the rendered tick track", () => {
    expect(railEntryIndexAtClientY(9, 10, 30, 3)).toBeUndefined();
    expect(railEntryIndexAtClientY(41, 10, 30, 3)).toBeUndefined();
  });
});

describe("preview positioning", () => {
  it("centers the preview on the anchor while staying inside vertical viewport padding", () => {
    expect(previewTopForAnchor(100, 40, 300, 12)).toBe(80);
    expect(previewTopForAnchor(5, 40, 300, 12)).toBe(12);
    expect(previewTopForAnchor(290, 80, 300, 12)).toBe(208);
  });

  it("places the preview beside the rail while staying inside horizontal viewport padding", () => {
    expect(previewLeftForRail(40, 320, 500, 12, 12)).toBe(52);
    expect(previewLeftForRail(250, 320, 500, 12, 12)).toBe(168);
  });
});
