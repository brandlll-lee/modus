/**
 * Structured git errors.
 *
 * Two complementary strategies, in order of preference (no guessing):
 *  1. **Preflight on authoritative state** — callers check `GitStatusSummary`
 *     (no remote / no upstream / detached) and the on-disk `index.lock` BEFORE
 *     running a write, and throw a typed `GitError` with a clear message. This
 *     is the primary path and never depends on parsing prose.
 *  2. **Classify failures** — when git still fails for a reason we could not
 *     preflight, `classifyGitError` maps git's own stderr vocabulary to a code
 *     so the UI can show a friendly, localizable message instead of raw stderr.
 *     This interprets git's authoritative output (like an exit code), not file
 *     names or heuristics.
 */

export type GitErrorCode =
  | "no-remote"
  | "no-upstream"
  | "detached-head"
  | "index-locked"
  | "auth-required"
  | "merge-conflict"
  | "non-fast-forward"
  | "nothing-to-commit"
  | "diverged"
  | "unknown";

export class GitError extends Error {
  readonly code: GitErrorCode;
  /** The raw git stderr/message, preserved for logs and the "details" affordance. */
  readonly raw: string;

  constructor(code: GitErrorCode, message: string, raw = "") {
    super(message);
    this.name = "GitError";
    this.code = code;
    this.raw = raw;
  }
}

/** Friendly, user-facing message per code (single source so the UI stays consistent). */
const MESSAGE: Record<GitErrorCode, string> = {
  "no-remote": "No git remote is configured. Add a remote before pushing or fetching.",
  "no-upstream": "The current branch has no upstream to pull from.",
  "detached-head": "HEAD is detached. Check out a branch first.",
  "index-locked":
    "Another git operation is in progress (index.lock present). Wait for it to finish and retry.",
  "auth-required": "Git authentication failed. Configure a credential helper or check your access.",
  "merge-conflict": "Merge conflicts must be resolved before this operation can continue.",
  "non-fast-forward":
    "The remote has commits you do not have locally. Pull (or fetch + rebase) before pushing.",
  "nothing-to-commit": "There are no staged changes to commit.",
  diverged: "Local and remote branches have diverged; a fast-forward pull is not possible.",
  unknown: "Git command failed.",
};

export function messageForCode(code: GitErrorCode): string {
  return MESSAGE[code];
}

/**
 * Ordered match table over git's own stderr vocabulary. First match wins.
 * Patterns target git's stable, machine-recognized phrases (the same ones
 * git's porcelain documents), not free-form prose — adding a new mapping is one
 * row of data, not a new code branch.
 */
const STDERR_PATTERNS: ReadonlyArray<readonly [RegExp, GitErrorCode]> = [
  [/index\.lock|unable to create '.*index\.lock'|another git process/i, "index-locked"],
  [
    /could not read from remote|authentication failed|permission denied|terminal prompts disabled|fatal: could not read/i,
    "auth-required",
  ],
  [
    /non-fast-forward|tip of your current branch is behind|updates were rejected/i,
    "non-fast-forward",
  ],
  [/have diverged|not possible to fast-forward/i, "diverged"],
  [/conflict|fix conflicts|needs merge|unmerged/i, "merge-conflict"],
  [/no upstream|no tracking information/i, "no-upstream"],
  [
    /no configured push destination|does not appear to be a git repository|no such remote/i,
    "no-remote",
  ],
  [/nothing to commit|no changes added to commit/i, "nothing-to-commit"],
];

export function classifyGitError(stderr: string, fallback: GitErrorCode = "unknown"): GitError {
  const raw = stderr.trim();
  for (const [pattern, code] of STDERR_PATTERNS) {
    if (pattern.test(raw)) {
      return new GitError(code, MESSAGE[code], raw);
    }
  }
  // Unknown failure: surface git's own message so nothing is hidden.
  return new GitError(fallback, raw || MESSAGE[fallback], raw);
}
