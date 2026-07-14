import type { FileChange } from "../../../../shared/contracts";

export type ChangeScope = "unstaged" | "staged" | "commit" | "branch" | "last-turn" | "all-commits";

/** Coarse change class for the row badge, derived from git's status code. */
export type ChangeBadge = "new" | "deleted" | "renamed" | "copied" | "modified";

export type ScopeMeta = {
  label: string;
  noun: string;
};

/** Display + iteration order of the scope menu. */
export const CHANGE_SCOPES: readonly ChangeScope[] = [
  "unstaged",
  "staged",
  "commit",
  "branch",
  "last-turn",
  "all-commits",
] as const;

export const SCOPE_META: Record<ChangeScope, ScopeMeta> = {
  unstaged: { label: "Unstaged", noun: "Unstaged" },
  staged: { label: "Staged", noun: "Staged" },
  commit: { label: "Commit", noun: "Commit" },
  branch: { label: "Branch", noun: "Branch" },
  "last-turn": { label: "Last Turn", noun: "Last Turn" },
  "all-commits": { label: "All commits", noun: "Commit" },
};

export function isChangeScope(value: string): value is ChangeScope {
  return (CHANGE_SCOPES as readonly string[]).includes(value);
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
