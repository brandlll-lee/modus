import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

/**
 * Worktree-aware repository resolution. A checkout's `.git` may be:
 *  - a directory (normal repo),
 *  - a bare `<name>.git` directory,
 *  - a **file** containing `gitdir: <path>` (linked worktree / submodule).
 *
 * We resolve the working-tree root plus the real git dir for THIS checkout and
 * the shared (common) git dir all worktrees of the repo share. Mirrors Warp's
 * `repo_metadata` model so lock detection and file watching target the right
 * paths instead of assuming `cwd/.git`.
 */
export type ResolvedRepo = {
  /** Working-tree root — the directory that owns the `.git` entry. */
  root: string;
  /** The actual git dir for this checkout (per-worktree gitdir for a linked worktree). */
  gitDir: string;
  /** Shared `.git` root all worktrees share. Equals `gitDir` for a normal repo. */
  commonGitDir: string;
};

function hasHead(dir: string): boolean {
  try {
    return statSync(join(dir, "HEAD")).isFile();
  } catch {
    return false;
  }
}

/** Parse a `.git` *file* (`gitdir: <path>`) into an absolute git dir. */
function parseGitFile(gitFilePath: string, workingTree: string): string | undefined {
  let contents: string;
  try {
    contents = readFileSync(gitFilePath, "utf8");
  } catch {
    return undefined;
  }
  const rest = contents.trim().replace(/^gitdir:\s*/, "");
  if (!rest || rest === contents.trim()) return undefined;
  // `resolve` normalizes separators (git writes forward slashes even on Windows)
  // and applies `workingTree` only when `rest` is relative.
  return resolve(workingTree, rest);
}

/** Walk ancestors of a (worktree) git dir to the shared `.git` root. */
function deriveCommonGitDir(gitDir: string): string {
  let current = gitDir;
  while (true) {
    if (current.split(sep).at(-1) === ".git") return current;
    const parent = dirname(current);
    if (parent === current) return gitDir;
    current = parent;
  }
}

/**
 * Resolve the repository containing `cwd`, walking up to (but not including)
 * `$HOME`. Returns `undefined` when `cwd` is not inside a git repository.
 */
export function resolveRepo(cwd: string): ResolvedRepo | undefined {
  const home = homedir();
  let current = resolve(cwd);

  while (true) {
    if (current === home) return undefined;

    // Bare repo: a `<name>.git` directory with a HEAD.
    if (current.split(sep).at(-1)?.endsWith(".git") && hasHead(current)) {
      return { root: current, gitDir: current, commonGitDir: current };
    }

    const dotGit = join(current, ".git");
    let kind: "dir" | "file" | undefined;
    try {
      const stat = statSync(dotGit);
      kind = stat.isDirectory() ? "dir" : stat.isFile() ? "file" : undefined;
    } catch {
      kind = undefined;
    }

    if (kind === "dir" && hasHead(dotGit)) {
      return { root: current, gitDir: dotGit, commonGitDir: dotGit };
    }
    if (kind === "file") {
      const gitDir = parseGitFile(dotGit, current);
      if (gitDir && hasHead(gitDir)) {
        return { root: current, gitDir, commonGitDir: deriveCommonGitDir(gitDir) };
      }
    }

    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** Convenience: the git dir for `cwd` (per-worktree), or `cwd/.git` as a last resort. */
export function gitDirFor(cwd: string): string {
  return resolveRepo(cwd)?.gitDir ?? join(cwd, ".git");
}

/** True when `cwd` is inside a git repository. */
export function isInsideRepo(cwd: string): boolean {
  return existsSync(cwd) && resolveRepo(cwd) !== undefined;
}
