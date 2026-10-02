import { describe, expect, it } from "vitest";
import { messageFromParts } from "./composerDraft";

describe("messageFromParts", () => {
  it("omits file tokens the same way", () => {
    const message = messageFromParts(
      [
        {
          type: "context",
          item: { type: "file", path: "/ws/a.ts" },
        },
        { type: "text", text: "explain" },
      ],
      "fallback",
    );
    expect(message).toBe("explain");
  });
});
