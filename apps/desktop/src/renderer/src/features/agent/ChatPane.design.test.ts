import { describe, expect, it } from "vitest";
import type { BrowserEvent } from "../../../../shared/contracts";
import { designEventToPromptInput } from "./ChatPane";

describe("designEventToPromptInput", () => {
  it("keeps design chips, typed text, context, and screenshot together", () => {
    const event: Extract<BrowserEvent, { type: "browser.design-select" }> = {
      type: "browser.design-select",
      workspaceId: "workspace-1",
      tabId: "tab-1",
      intent: "submit",
      element: {
        id: "element-1",
        tabId: "tab-1",
        url: "http://localhost:5173",
        label: "Hero title",
        tagName: "h1",
        domPath: "main > h1",
        rect: { x: 10, y: 20, width: 100, height: 40 },
        screenshotDataUrl: "data:image/png;base64,AAA",
        contentParts: [
          { type: "element", index: 0 },
          { type: "text", text: " make this tighter" },
        ],
      },
    };

    expect(designEventToPromptInput(event)).toEqual({
      message: "[h1] make this tighter",
      mode: "build",
      context: [{ type: "design-element", element: event.element }],
      attachments: [{ type: "image", data: "AAA", mimeType: "image/png", name: "Hero title.png" }],
    });
  });
});
