import { describe, expect, it } from "vitest";
import {
  agentPromptSchema,
  diffCommitSchema,
  parseIpcInput,
  permissionDecideSchema,
} from "./schemas";

describe("IPC schemas", () => {
  it("accepts valid diff commit payloads", () => {
    expect(
      parseIpcInput(diffCommitSchema, { cwd: "repo", message: "commit" }, "diff:commit"),
    ).toEqual({
      cwd: "repo",
      message: "commit",
    });
  });

  it("rejects invalid diff commit payloads", () => {
    expect(() =>
      parseIpcInput(diffCommitSchema, { cwd: "repo", message: "" }, "diff:commit"),
    ).toThrow("Invalid IPC payload");
  });

  it("validates permission decisions", () => {
    expect(
      parseIpcInput(
        permissionDecideSchema,
        { action: "git.write", target: "git clean -f", decision: "deny" },
        "permission:decide",
      ),
    ).toEqual({ action: "git.write", target: "git clean -f", decision: "deny" });
  });

  // Regression: a prompt turn must carry its own execution params (mode, model,
  // thinkingLevel) across the IPC boundary. Dropping any of these here was the
  // root of the "stale model / thinking / plan-mode on resend" bugs.
  it("preserves per-turn execution params (mode, model, thinkingLevel)", () => {
    const parsed = parseIpcInput(
      agentPromptSchema,
      {
        sessionId: "s1",
        message: "hi",
        mode: "plan",
        model: "openai/gpt-5.5",
        thinkingLevel: "xhigh",
      },
      "agent:prompt",
    );
    expect(parsed.mode).toBe("plan");
    expect(parsed.model).toBe("openai/gpt-5.5");
    expect(parsed.thinkingLevel).toBe("xhigh");
  });

  it("leaves per-turn params undefined when omitted (keeps session defaults)", () => {
    const parsed = parseIpcInput(
      agentPromptSchema,
      { sessionId: "s1", message: "hi" },
      "agent:prompt",
    );
    expect(parsed.mode).toBeUndefined();
    expect(parsed.model).toBeUndefined();
    expect(parsed.thinkingLevel).toBeUndefined();
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
