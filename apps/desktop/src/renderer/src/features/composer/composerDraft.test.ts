import { describe, expect, it } from "vitest";
import { createEmptyComposerDraft, messageFromParts, restoreQueuedDraft } from "./composerDraft";

describe("restoreQueuedDraft", () => {
  it("returns queued inputs before the current draft and preserves editor parts", () => {
    const draft = {
      ...createEmptyComposerDraft(),
      value: "unfinished",
      parts: [{ type: "text" as const, text: "unfinished" }],
    };
    const restored = restoreQueuedDraft(draft, ["steering", "follow-up"]);
    expect(restored.value).toBe("steering\n\nfollow-up\n\nunfinished");
    expect(messageFromParts(restored.parts, restored.value)).toBe(restored.value);
    expect(restored.parts?.at(-1)).toBe(draft.parts[0]);
  });

  it("preserves a draft when the native queue is empty", () => {
    const draft = createEmptyComposerDraft();
    expect(restoreQueuedDraft(draft, [])).toBe(draft);
  });
});
