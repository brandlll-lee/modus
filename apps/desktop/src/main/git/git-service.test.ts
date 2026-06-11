import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyWorktreeChanges,
  commitChanges,
  commitOrPush,
  createWorktree,
  discardFile,
  getStatusSummary,
  getWorkingChangeStats,
  listChanges,
  readDiff,
  stageFile,
  unstageFile,
} from "./git-service";

const execFileAsync = promisify(execFile);
let repo: string;

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repo, windowsHide: true });
  return stdout;
}

beforeEach(async () => {
  repo = await mkdtemp(join(process.cwd(), "modus-git-test-"));
  await git(["init"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "user.name", "Modus Test"]);
  await writeFile(join(repo, "tracked.txt"), "base\n");
  await git(["add", "tracked.txt"]);
  await git(["commit", "-m", "initial"]);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("git-service", () => {
  it("lists staged, unstaged, and untracked changes", async () => {
    await writeFile(join(repo, "tracked.txt"), "changed\n");
    await writeFile(join(repo, "new.txt"), "new\n");
    await stageFile(repo, "tracked.txt");

    const changes = await listChanges(repo);

    expect(changes.find((change) => change.path === "tracked.txt")?.staged).toBe(true);
    expect(changes.find((change) => change.path === "new.txt")?.untracked).toBe(true);
  });

  it("stages, unstages, and reads staged diff", async () => {
    await writeFile(join(repo, "tracked.txt"), "changed\n");
    await stageFile(repo, "tracked.txt");
    expect((await readDiff(repo, "tracked.txt", "staged")).diff).toContain("+changed");

    await unstageFile(repo, "tracked.txt");
    expect((await readDiff(repo, "tracked.txt", "staged")).diff).toBe("");
  });

  it("rejects commits without staged changes", async () => {
    await expect(commitChanges(repo, "no changes")).rejects.toThrow("No staged changes");
  });

  it("commits staged changes", async () => {
    await writeFile(join(repo, "tracked.txt"), "changed\n");
    await stageFile(repo, "tracked.txt");

    await commitChanges(repo, "update tracked");

    expect(await listChanges(repo)).toEqual([]);
  });

  it("disables untracked discard", async () => {
    await writeFile(join(repo, "new.txt"), "new\n");

    await expect(discardFile(repo, "new.txt")).rejects.toThrow("untracked files is disabled");
  });

  it("discards tracked changes", async () => {
    await writeFile(join(repo, "tracked.txt"), "changed\n");

    await discardFile(repo, "tracked.txt");

    expect(await listChanges(repo)).toEqual([]);
  });

  it("summarizes branch, counts, and stat without an upstream", async () => {
    await writeFile(join(repo, "tracked.txt"), "changed\n");
    await stageFile(repo, "tracked.txt");
    await writeFile(join(repo, "new.txt"), "new\n");

    const summary = await getStatusSummary(repo);

    expect(summary.branch).toBeTruthy();
    expect(summary.hasUpstream).toBe(false);
    expect(summary.stagedCount).toBe(1);
    expect(summary.unstagedCount).toBe(1);
    expect(summary.added).toBeGreaterThan(0);
  });

  it("stages all and commits via commitOrPush", async () => {
    await writeFile(join(repo, "tracked.txt"), "changed\n");
    await writeFile(join(repo, "new.txt"), "new\n");

    const result = await commitOrPush(repo, {
      message: "commit everything",
      stageAll: true,
      commit: true,
      push: false,
    });

    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(false);
    expect(result.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(await listChanges(repo)).toEqual([]);
  });

  it("commits and pushes to a configured remote, setting upstream", async () => {
    const remote = await mkdtemp(join(process.cwd(), "modus-git-remote-"));
    try {
      await execFileAsync("git", ["init", "--bare"], { cwd: remote, windowsHide: true });
      await git(["remote", "add", "origin", remote]);

      await writeFile(join(repo, "tracked.txt"), "changed\n");
      const result = await commitOrPush(repo, {
        message: "push me",
        stageAll: true,
        commit: true,
        push: true,
      });

      expect(result.committed).toBe(true);
      expect(result.pushed).toBe(true);

      const summary = await getStatusSummary(repo);
      expect(summary.hasRemote).toBe(true);
      expect(summary.hasUpstream).toBe(true);
      expect(summary.ahead).toBe(0);
    } finally {
      await rm(remote, { recursive: true, force: true });
    }
  });

  it("creates a worktree for an initialized repository before the first commit", async () => {
    await rm(repo, { recursive: true, force: true });
    repo = await mkdtemp(join(process.cwd(), "modus-git-test-"));
    await git(["init"]);

    const worktree = await createWorktree(repo, "empty-repo");

    expect(worktree.branch).toBe("modus/empty-repo");
    expect(worktree.head).toBe("");
  });

  it("applies worktree changes (tracked edits + new files) onto the main checkout", async () => {
    const worktree = await createWorktree(repo, "parallel-task");
    await writeFile(join(worktree.path, "tracked.txt"), "agent change\n");
    await writeFile(join(worktree.path, "created.txt"), "brand new\n");

    const result = await applyWorktreeChanges(repo, worktree.path);

    expect(result.applied).toBe(true);
    expect(result.conflicted).toBe(false);
    expect(result.fileCount).toBe(2);
    expect(await readText(join(repo, "tracked.txt"))).toBe("agent change\n");
    expect(await readText(join(repo, "created.txt"))).toBe("brand new\n");
    // The worktree itself stays untouched (still has its own copy).
    expect(await readText(join(worktree.path, "tracked.txt"))).toBe("agent change\n");
  });

  it("reports when a worktree has nothing to apply", async () => {
    const worktree = await createWorktree(repo, "idle-task");

    const result = await applyWorktreeChanges(repo, worktree.path);

    expect(result.applied).toBe(false);
    expect(result.conflicted).toBe(false);
    expect(result.fileCount).toBe(0);
  });

  it("lands conflicting changes as three-way conflict markers", async () => {
    const worktree = await createWorktree(repo, "conflict-task");
    await writeFile(join(repo, "tracked.txt"), "main edit\n");
    await git(["add", "tracked.txt"]);
    await git(["commit", "-m", "main edit"]);
    await writeFile(join(worktree.path, "tracked.txt"), "agent edit\n");

    const result = await applyWorktreeChanges(repo, worktree.path);

    expect(result.applied).toBe(true);
    expect(result.conflicted).toBe(true);
    const merged = await readText(join(repo, "tracked.txt"));
    expect(merged).toContain("<<<<<<<");
    expect(merged).toContain("agent edit");
  });

  it("summarizes per-file change stats including new untracked files", async () => {
    await writeFile(join(repo, "tracked.txt"), "base\nextra line\n");
    await writeFile(join(repo, "fresh.txt"), "one\ntwo\nthree\n");

    const stats = await getWorkingChangeStats(repo);

    expect(stats.fileCount).toBe(2);
    expect(stats.added).toBe(4);
    expect(stats.removed).toBe(0);
    expect(stats.files).toEqual([
      expect.objectContaining({ path: "fresh.txt", added: 3, removed: 0, untracked: true }),
      expect.objectContaining({ path: "tracked.txt", added: 1, removed: 0, untracked: false }),
    ]);
  });

  it("counts removals and reports a clean tree as empty stats", async () => {
    expect((await getWorkingChangeStats(repo)).fileCount).toBe(0);

    await writeFile(join(repo, "tracked.txt"), "");
    const stats = await getWorkingChangeStats(repo);
    expect(stats.removed).toBe(1);
    expect(stats.added).toBe(0);
  });

  it("refuses (without touching files) when uncommitted local edits collide", async () => {
    const worktree = await createWorktree(repo, "dirty-task");
    await writeFile(join(repo, "tracked.txt"), "uncommitted local edit\n");
    await writeFile(join(worktree.path, "tracked.txt"), "agent edit\n");

    const result = await applyWorktreeChanges(repo, worktree.path);

    expect(result.applied).toBe(false);
    expect(result.conflicted).toBe(false);
    expect(await readText(join(repo, "tracked.txt"))).toBe("uncommitted local edit\n");
  });
});

/** Read a file with EOLs normalized — git may check files out with CRLF on Windows. */
async function readText(path: string): Promise<string> {
  return (await readFile(path, "utf8")).replaceAll("\r\n", "\n");
}
