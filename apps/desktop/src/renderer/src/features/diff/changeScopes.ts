import type { FileChange } from "../../../../shared/contracts";

/**
 * Source-control scope selector. Two scopes only: the working tree's
 * uncommitted changes, and the commit history. There is no staging in Modus, so
 * there is no staged/unstaged distinction — a scope is a projection over
 * authoritative git data, never a per-case branch.
 */
export type ChangeScope = "uncommitted" | "all-commits";

/** Coarse change class for the row badge, derived from git's status code. */
export type ChangeBadge = "new" | "deleted" | "renamed" | "copied" | "modified";

export type ScopeMeta = {
  /** Menu label. */
  label: string;
  /** Noun used in the summary row: "{N} {noun} Changes". */
  noun: string;
  /**
   * Working-tree filter. Absent for history scopes, which draw their rows from
   * the commit log instead of the working-tree file list.
   */
  predicate?: (change: FileChange) => boolean;
  /** True when rows come from `git log` rather than the working tree. */
  commitHistory: boolean;
};

/** Display + iteration order of the scope menu. */
export const CHANGE_SCOPES: readonly ChangeScope[] = ["uncommitted", "all-commits"] as const;

export const SCOPE_META: Record<ChangeScope, ScopeMeta> = {
  uncommitted: {
    label: "Uncommitted",
    noun: "Uncommitted",
    predicate: (change) => Boolean(change.staged || change.unstaged || change.untracked),
    commitHistory: false,
  },
  "all-commits": {
    label: "All commits",
    noun: "Commit",
    commitHistory: true,
  },
};

/** Files visible in a working-tree scope. History scopes return [] (use the log). */
export function filterByScope(changes: FileChange[], scope: ChangeScope): FileChange[] {
  const { predicate } = SCOPE_META[scope];
  return predicate ? changes.filter(predicate) : [];
}

/**
 * Priority classification of git's status code into a badge. Reads the
 * authoritative porcelain/diff-tree letters (A/D/R/C), never the file name, and
 * is order-sensitive so combined codes like "RM" resolve to the dominant action.
 */
const STATUS_BADGES: ReadonlyArray<readonly [string, ChangeBadge]> = [
  ["A", "new"],
  ["D", "deleted"],
  ["R", "renamed"],
  ["C", "copied"],
];

export function changeBadge(change: FileChange): ChangeBadge {
  // Untracked ("??") is a new file from the working tree's point of view.
  if (change.untracked) return "new";
  const code = change.status.replace(/\s/g, "");
  for (const [letter, badge] of STATUS_BADGES) {
    if (code.includes(letter)) return badge;
  }
  return "modified";
}

/** Split a workspace-relative path into its directory prefix and file name. */
export function splitPath(path: string): { dir: string; name: string } {
  const normalized = path.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) return { dir: "", name: normalized };
  return { dir: normalized.slice(0, slash + 1), name: normalized.slice(slash + 1) };
}
