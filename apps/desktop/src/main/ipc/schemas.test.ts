import { describe, expect, it } from "vitest";
import { diffCommitSchema, parseIpcInput, permissionDecideSchema } from "./schemas";

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
});
