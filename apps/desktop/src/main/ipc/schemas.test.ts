import { describe, expect, it } from "vitest";
import { agentPromptSchema, browserRecentSchema, parseIpcInput } from "./schemas";

describe("IPC schemas", () => {
  it("accepts image-only prompts with path metadata and rejects empty prompts", () => {
    const attachment = {
      type: "image",
      data: "pixels",
      mimeType: "image/png",
      path: "C:/Fixture/image.png",
    };
    expect(
      parseIpcInput(
        agentPromptSchema,
        { sessionId: "s", message: "", attachments: [attachment] },
        "agent:prompt",
      ),
    ).toMatchObject({ message: "", attachments: [attachment] });
    expect(() =>
      parseIpcInput(agentPromptSchema, { sessionId: "s", message: " " }, "agent:prompt"),
    ).toThrow("Invalid IPC payload");
  });

  it("validates browser recent deletion payloads", () => {
    expect(parseIpcInput(browserRecentSchema, { id: "recent-1" }, "browser:delete-recent")).toEqual(
      { id: "recent-1" },
    );
    expect(() => parseIpcInput(browserRecentSchema, { id: "" }, "browser:delete-recent")).toThrow(
      "Invalid IPC payload",
    );
  });

  it("rejects an invalid thinkingLevel", () => {
    expect(() =>
      parseIpcInput(
        agentPromptSchema,
        { sessionId: "s1", message: "hi", thinkingLevel: "ultra" },
        "agent:prompt",
      ),
    ).toThrow("Invalid IPC payload");
  });
});
