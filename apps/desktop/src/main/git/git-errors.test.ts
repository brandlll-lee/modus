import { describe, expect, it } from "vitest";
import { classifyGitError, GitError, messageForCode } from "./git-errors";

describe("classifyGitError", () => {
  // Synthetic stderr fragments drawn from git's own vocabulary, including a
  // never-listed message to prove the fallback path (no per-message branch).
  const cases: Array<[string, string]> = [
    ["fatal: Unable to create '/r/.git/index.lock': File exists", "index-locked"],
    [
      "remote: Permission denied (publickey).\nfatal: Could not read from remote repository",
      "auth-required",
    ],
    ["! [rejected] main -> main (non-fast-forward)", "non-fast-forward"],
    ["hint: have diverged,\nhint: and have 1 and 2 different commits each", "diverged"],
    ["CONFLICT (content): Merge conflict in a.txt", "merge-conflict"],
    ["fatal: no upstream configured for branch 'main'", "no-upstream"],
    ["fatal: No configured push destination.", "no-remote"],
    ["nothing to commit, working tree clean", "nothing-to-commit"],
  ];

  it("maps git's stderr vocabulary to structured codes", () => {
    for (const [stderr, code] of cases) {
      const error = classifyGitError(stderr);
      expect(error).toBeInstanceOf(GitError);
      expect(error.code).toBe(code);
      expect(error.message).toBe(messageForCode(error.code));
      expect(error.raw).toBe(stderr.trim());
    }
  });

  it("falls through to unknown, surfacing git's own message verbatim", () => {
    const weird = "fatal: something the table has never seen before";
    const error = classifyGitError(weird);
    expect(error.code).toBe("unknown");
    expect(error.message).toBe(weird);
    expect(error.raw).toBe(weird);
  });

  it("uses the provided fallback code for empty stderr", () => {
    const error = classifyGitError("", "no-remote");
    expect(error.code).toBe("no-remote");
    expect(error.message).toBe(messageForCode("no-remote"));
  });
});
