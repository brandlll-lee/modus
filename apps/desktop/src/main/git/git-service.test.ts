import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  commitOrPush,
  discardFile,
  getStatusSummary,
  getWorkingChangeStats,
  listChanges,
  listCommitChanges,
  listCommitLog,
  readDiff,
  readFileVersions,
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
    await git(["add", "tracked.txt"]);

    const changes = await listChanges(repo);

    expect(changes.find((change) => change.path === "tracked.txt")?.staged).toBe(true);
    expect(changes.find((change) => change.path === "new.txt")?.untracked).toBe(true);
  });

  it("reads a staged diff", async () => {
    await writeFile(join(repo, "tracked.txt"), "changed\n");
    await git(["add", "tracked.txt"]);

    expect((await readDiff(repo, "tracked.txt", "staged")).diff).toContain("+changed");
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
    await git(["add", "tracked.txt"]);
    await writeFile(join(repo, "new.txt"), "new\n");

    const summary = await getStatusSummary(repo);

    expect(summary.branch).toBeTruthy();
    expect(summary.hasUpstream).toBe(false);
    expect(summary.stagedCount).toBe(1);
    expect(summary.unstagedCount).toBe(1);
    expect(summary.added).toBeGreaterThan(0);
  });

  it("rejects commitOrPush with nothing to commit", async () => {
    await expect(
      commitOrPush(repo, { message: "no changes", commit: true, push: false }),
    ).rejects.toThrow("No staged changes");
  });

  it("stages all and commits via commitOrPush", async () => {
    await writeFile(join(repo, "tracked.txt"), "changed\n");
    await writeFile(join(repo, "new.txt"), "new\n");

    const result = await commitOrPush(repo, {
      message: "commit everything",
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

  it("lists commit history newest-first with metadata", async () => {
    await writeFile(join(repo, "tracked.txt"), "second\n");
    await git(["commit", "-am", "second commit"]);

    const log = await listCommitLog(repo);

    expect(log.length).toBe(2);
    expect(log[0]?.subject).toBe("second commit");
    expect(log[1]?.subject).toBe("initial");
    expect(log[0]?.shortHash).toMatch(/^[0-9a-f]{7,}$/);
    expect(log[0]?.author).toBe("Modus Test");
    expect(log[0]?.relativeDate).toBeTruthy();
  });

  it("lists files changed by a specific commit", async () => {
    await writeFile(join(repo, "tracked.txt"), "second\n");
    await writeFile(join(repo, "added.txt"), "brand new\n");
    await git(["add", "."]);
    await git(["commit", "-m", "second commit"]);

    const [head] = await listCommitLog(repo);
    const files = await listCommitChanges(repo, head?.hash ?? "");

    expect(files.map((file) => file.path).sort()).toEqual(["added.txt", "tracked.txt"]);
    expect(files.find((file) => file.path === "added.txt")?.status).toBe("A");
    expect(files.find((file) => file.path === "tracked.txt")?.status).toBe("M");
    // Commit files are never stageable.
    expect(files.every((file) => file.staged === false && file.unstaged === false)).toBe(true);
  });

  it("diffs a commit against its parent via file versions", async () => {
    await writeFile(join(repo, "tracked.txt"), "second\n");
    await git(["commit", "-am", "second commit"]);

    const [head] = await listCommitLog(repo);
    const versions = await readFileVersions(repo, "tracked.txt", "unstaged", undefined, head?.hash);

    expect(versions.original).toBe("base\n");
    expect(versions.modified).toBe("second\n");
  });

  it("discards a staged new file on an unborn branch (no commits yet)", async () => {
    // A brand-new repo with NO initial commit — `git restore` would fail here
    // (no HEAD), which was the silent "discard does nothing" bug.
    const fresh = await mkdtemp(join(process.cwd(), "modus-git-unborn-"));
    try {
      await execFileAsync("git", ["init"], { cwd: fresh, windowsHide: true });
      await execFileAsync("git", ["config", "user.email", "t@e.com"], { cwd: fresh });
      await execFileAsync("git", ["config", "user.name", "T"], { cwd: fresh });
      await writeFile(join(fresh, "new.txt"), "hello\n");
      await execFileAsync("git", ["add", "new.txt"], { cwd: fresh, windowsHide: true });

      await discardFile(fresh, "new.txt"); // must not throw on unborn HEAD
      const after = (await listChanges(fresh)).find((c) => c.path === "new.txt");
      expect(after?.staged).toBe(false);
      expect(after?.untracked).toBe(true);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });
});
