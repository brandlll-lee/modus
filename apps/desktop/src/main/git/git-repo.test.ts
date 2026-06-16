import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isInsideRepo, resolveRepo } from "./git-repo";

const execFileAsync = promisify(execFile);
let repo: string;

async function git(args: string[], cwd = repo): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
  return stdout;
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "modus-repo-test-"));
  await git(["init"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "user.name", "Modus Test"]);
  await writeFile(join(repo, "a.txt"), "hello\n");
  await git(["add", "."]);
  await git(["commit", "-m", "init"]);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("resolveRepo", () => {
  it("resolves a normal repo: gitDir == commonGitDir == root/.git", async () => {
    const resolved = resolveRepo(repo);
    expect(resolved).toBeDefined();
    expect(resolved?.root).toBe(repo);
    expect(resolved?.gitDir).toBe(join(repo, ".git"));
    expect(resolved?.commonGitDir).toBe(join(repo, ".git"));
  });

  it("resolves from a nested subdirectory up to the repo root", async () => {
    const nested = join(repo, "src", "deep");
    const resolved = resolveRepo(nested);
    expect(resolved?.root).toBe(repo);
  });

  it("resolves a linked worktree (.git is a file): per-worktree gitDir, shared commonGitDir", async () => {
    const wt = `${repo}-wt`;
    try {
      await git(["worktree", "add", "-b", "feature", wt]);
      const resolved = resolveRepo(wt);
      expect(resolved?.root).toBe(wt);
      // Per-worktree gitdir lives under the main repo's .git/worktrees/<name>.
      expect(resolved?.gitDir.replace(/\\/g, "/")).toContain(".git/worktrees/");
      // Common git dir is the main repo's shared .git.
      expect(resolved?.commonGitDir).toBe(join(repo, ".git"));
    } finally {
      await rm(wt, { recursive: true, force: true });
    }
  });

  it("returns undefined outside any repository", async () => {
    const plain = await mkdtemp(join(tmpdir(), "modus-norepo-"));
    try {
      expect(resolveRepo(plain)).toBeUndefined();
      expect(isInsideRepo(plain)).toBe(false);
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});
