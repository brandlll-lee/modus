import { describe, expect, it } from "vitest";
import {
  agentPromptSchema,
  browserRecentSchema,
  diffCommitOrPushSchema,
  parseIpcInput,
} from "./schemas";

describe("IPC schemas", () => {
  it("accepts a commit-and-push payload", () => {
    expect(
      parseIpcInput(
        diffCommitOrPushSchema,
        { cwd: "repo", message: "commit", commit: true, push: true },
        "diff:commit-or-push",
      ),
    ).toEqual({ cwd: "repo", message: "commit", commit: true, push: true });
  });

  it("accepts a push-only payload (no message)", () => {
    expect(
      parseIpcInput(
        diffCommitOrPushSchema,
        { cwd: "repo", commit: false, push: true },
        "diff:commit-or-push",
      ),
    ).toEqual({ cwd: "repo", commit: false, push: true });
  });

  it("rejects committing without a message", () => {
    expect(() =>
      parseIpcInput(
        diffCommitOrPushSchema,
        { cwd: "repo", message: "", commit: true, push: false },
        "diff:commit-or-push",
      ),
    ).toThrow("Invalid IPC payload");
  });

  it("rejects a no-op (neither commit nor push)", () => {
    expect(() =>
      parseIpcInput(
        diffCommitOrPushSchema,
        { cwd: "repo", commit: false, push: false },
        "diff:commit-or-push",
      ),
    ).toThrow("Invalid IPC payload");
  });

  // Regression: a prompt turn must carry its own execution params (mode, model,
  // thinking) across the IPC boundary. Dropping any of these here was the
  // root of the "stale model / thinking / plan-mode on resend" bugs.

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
