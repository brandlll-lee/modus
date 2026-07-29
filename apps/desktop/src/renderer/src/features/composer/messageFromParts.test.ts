import { describe, expect, it } from "vitest";
import { messageFromParts } from "./Composer";

describe("messageFromParts", () => {
  it("omits excerpt tokens from the plaintext body (chips + context[] are authority)", () => {
    const message = messageFromParts(
      [
        {
          type: "context",
          item: {
            type: "excerpt",
            path: "/ws/paper.pdf",
            text: "diffusion process is fixed",
            locator: "p.1",
          },
        },
        { type: "text", text: "这是什么?" },
      ],
      "fallback",
    );
    expect(message).toBe("这是什么?");
    expect(message).not.toContain("[context]");
  });

  it("omits file tokens the same way", () => {
    const message = messageFromParts(
      [
        {
          type: "context",
          item: { type: "file", path: "/ws/a.ts", range: { fromLine: 1, toLine: 3 } },
        },
        { type: "text", text: "explain" },
      ],
      "fallback",
    );
    expect(message).toBe("explain");
  });
});
