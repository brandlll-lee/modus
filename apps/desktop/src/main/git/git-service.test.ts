import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import { checkoutBranch, isGitRepository, listBranches } from "./git-service";

const execFileAsync = promisify(execFile);
let root: string;
let repo: string;

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repo, windowsHide: true });
  return stdout.trim();
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "modus-git-test-"));
  repo = join(root, "repo");
  await mkdir(repo);
  await git(["init", "-b", "main"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "user.name", "Modus Test"]);
  await writeFile(join(repo, "tracked.txt"), "base\n");
  await git(["add", "tracked.txt"]);
  await git(["commit", "-m", "initial"]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("detects the repository used by a workspace", async () => {
  expect(await isGitRepository(repo)).toBe(true);
  expect(await isGitRepository(join(root, "missing"))).toBe(false);
});

it("lists the current branch and linked worktree paths", async () => {
  const worktree = join(root, "worktree");
  await git(["worktree", "add", "-b", "feature", worktree]);

  const branches = await listBranches(repo);

  expect(branches.current).toBe("main");
  expect(branches.local).toEqual([
    { name: "main", current: true, remote: false },
    expect.objectContaining({ name: "feature", current: false, remote: false }),
  ]);
  expect(resolve(branches.local[1]?.worktreePath ?? "")).toBe(worktree);
});

it("switches the workspace branch", async () => {
  await git(["branch", "feature"]);

  expect(await checkoutBranch(repo, "feature")).toMatchObject({ kind: "ok" });
  expect((await listBranches(repo)).current).toBe("feature");
});

it("returns the linked worktree location while keeping the current checkout", async () => {
  const worktree = join(root, "worktree");
  await git(["worktree", "add", "-b", "feature", worktree]);

  const result = await checkoutBranch(repo, "feature");
  expect(result).toMatchObject({
    kind: "worktree",
    branch: "feature",
  });
  expect(resolve(result.worktreePath ?? "")).toBe(worktree);
  expect(await git(["branch", "--show-current"])).toBe("main");
});
