import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  abortSubagentWorktreeApply,
  applySubagentWorktree,
  checkoutBranch,
  cleanupSubagentWorktree,
  commitOrPush,
  createSubagentWorktree,
  defaultBranch,
  discardUnstagedFile,
  finishSubagentWorktree,
  getChangeStatsSince,
  getStatusSummary,
  getWorkingChangeStats,
  initRepository,
  isGitRepository,
  listBranches,
  listChanges,
  listCommitChanges,
  listCommitLog,
  readDiff,
  readFilePatch,
  reviewChanges,
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
  repo = await mkdtemp(join(tmpdir(), "modus-git-test-"));
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

  it("initializes a plain directory without committing files", async () => {
    const plain = await mkdtemp(join(tmpdir(), "modus-git-plain-"));
    try {
      await writeFile(join(plain, "new.txt"), "new\n");

      await initRepository(plain);

      expect(await isGitRepository(plain)).toBe(true);
      expect(await listCommitLog(plain)).toEqual([]);
      expect((await listChanges(plain)).find((change) => change.path === "new.txt")).toEqual(
        expect.objectContaining({ untracked: true }),
      );
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });

  it("leaves an existing repository initialized", async () => {
    const before = await git(["rev-parse", "HEAD"]);

    const result = await initRepository(repo);

    expect(result.output).toContain("already initialized");
    expect(await git(["rev-parse", "HEAD"])).toBe(before);
  });

  it("reads a staged diff", async () => {
    await writeFile(join(repo, "tracked.txt"), "changed\n");
    await git(["add", "tracked.txt"]);

    expect((await readDiff(repo, "tracked.txt", "staged")).diff).toContain("+changed");
  });

  it("disables untracked discard", async () => {
    await writeFile(join(repo, "new.txt"), "new\n");

    await expect(discardUnstagedFile(repo, "new.txt")).rejects.toThrow(
      "untracked files is disabled",
    );
  });

  it("discards tracked changes", async () => {
    await writeFile(join(repo, "tracked.txt"), "changed\n");

    await discardUnstagedFile(repo, "tracked.txt");

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

  it("commits only the index by default", async () => {
    await writeFile(join(repo, "tracked.txt"), "changed\n");
    await writeFile(join(repo, "new.txt"), "new\n");
    await stageFile(repo, "tracked.txt");

    const result = await commitOrPush(repo, {
      message: "commit staged",
      commit: true,
      push: false,
    });

    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(false);
    expect(result.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect((await listChanges(repo)).map((change) => change.path)).toEqual(["new.txt"]);
  });

  it("includes unstaged files only when explicitly requested", async () => {
    await writeFile(join(repo, "tracked.txt"), "changed\n");
    await writeFile(join(repo, "new.txt"), "new\n");

    await commitOrPush(repo, {
      message: "commit everything",
      commit: true,
      push: false,
      includeUnstaged: true,
    });

    expect(await listChanges(repo)).toEqual([]);
  });

  it("commits and pushes to a configured remote, setting upstream", async () => {
    const remote = await mkdtemp(join(tmpdir(), "modus-git-remote-"));
    try {
      await execFileAsync("git", ["init", "--bare"], { cwd: remote, windowsHide: true });
      await git(["remote", "add", "origin", remote]);

      await writeFile(join(repo, "tracked.txt"), "changed\n");
      await stageFile(repo, "tracked.txt");
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

  it("summarizes committed changes since a base commit", async () => {
    const base = (await git(["rev-parse", "HEAD"])).trim();
    await writeFile(join(repo, "tracked.txt"), "base\nextra\n");
    await writeFile(join(repo, "added.txt"), "one\ntwo\n");
    await git(["add", "."]);
    await git(["commit", "-m", "second"]);

    const stats = await getChangeStatsSince(repo, base);

    expect(stats.fileCount).toBe(2);
    expect(stats.added).toBe(3);
    expect(stats.removed).toBe(0);
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
    expect(log[0]?.parents).toEqual([log[1]?.hash]);
    expect(log[1]?.parents).toEqual([]);
    expect(log[0]?.refs.some((ref) => ref === "HEAD" || ref.startsWith("HEAD -> "))).toBe(true);
  });

  it("reports multiple parents for a merge commit", async () => {
    await git(["checkout", "-b", "side"]);
    await writeFile(join(repo, "side.txt"), "side\n");
    await git(["add", "side.txt"]);
    await git(["commit", "-m", "side work"]);
    await git(["checkout", "-"]);
    await writeFile(join(repo, "tracked.txt"), "mainline\n");
    await git(["commit", "-am", "mainline"]);
    await git(["merge", "side", "-m", "merge side"]);

    const [head] = await listCommitLog(repo);

    expect(head?.subject).toBe("merge side");
    expect(head?.parents).toHaveLength(2);
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

  it("lists files changed by the root commit", async () => {
    const log = await listCommitLog(repo);
    const files = await listCommitChanges(repo, log.at(-1)?.hash ?? "");

    expect(files.map((file) => file.path)).toEqual(["tracked.txt"]);
    expect(files[0]?.status).toBe("A");
  });

  it("reads a compact patch for one committed file", async () => {
    await writeFile(join(repo, "tracked.txt"), "second\n");
    await git(["commit", "-am", "second commit"]);

    const [head] = await listCommitLog(repo);
    const preview = await readFilePatch(
      repo,
      "tracked.txt",
      { type: "commit", commit: head?.hash ?? "" },
      { untracked: false, ignoreWhitespace: false },
    );

    expect(preview.patch).toContain("-base");
    expect(preview.patch).toContain("+second");
  });

  it("unstages a new file on an unborn branch", async () => {
    // A brand-new repo with NO initial commit — `git restore` would fail here
    // (no HEAD), which was the silent "discard does nothing" bug.
    const fresh = await mkdtemp(join(tmpdir(), "modus-git-unborn-"));
    try {
      await execFileAsync("git", ["init"], { cwd: fresh, windowsHide: true });
      await execFileAsync("git", ["config", "user.email", "t@e.com"], { cwd: fresh });
      await execFileAsync("git", ["config", "user.name", "T"], { cwd: fresh });
      await writeFile(join(fresh, "new.txt"), "hello\n");
      await execFileAsync("git", ["add", "new.txt"], { cwd: fresh, windowsHide: true });

      await unstageFile(fresh, "new.txt");
      const after = (await listChanges(fresh)).find((c) => c.path === "new.txt");
      expect(after?.staged).toBe(false);
      expect(after?.untracked).toBe(true);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("keeps staged and unstaged halves of a partially staged file separate", async () => {
    await writeFile(join(repo, "tracked.txt"), "staged\n");
    await stageFile(repo, "tracked.txt");
    await writeFile(join(repo, "tracked.txt"), "working\n");

    const staged = await reviewChanges(repo, { type: "staged" });
    const unstaged = await reviewChanges(repo, { type: "unstaged" });
    expect(staged.files.map((change) => change.path)).toEqual(["tracked.txt"]);
    expect(unstaged.files.map((change) => change.path)).toEqual(["tracked.txt"]);

    const stagedPatch = await readFilePatch(
      repo,
      "tracked.txt",
      { type: "staged" },
      {
        untracked: false,
        ignoreWhitespace: false,
      },
    );
    const unstagedPatch = await readFilePatch(
      repo,
      "tracked.txt",
      { type: "unstaged" },
      {
        untracked: false,
        ignoreWhitespace: false,
      },
    );
    expect(stagedPatch.patch).toContain("-base");
    expect(stagedPatch.patch).toContain("+staged");
    expect(stagedPatch.patch).not.toContain("working");
    expect(unstagedPatch.patch).toContain("-staged");
    expect(unstagedPatch.patch).toContain("+working");

    await discardUnstagedFile(repo, "tracked.txt");
    expect((await readFile(join(repo, "tracked.txt"), "utf8")).replace(/\r\n/g, "\n")).toBe(
      "staged\n",
    );
    await unstageFile(repo, "tracked.txt");
    expect((await readFile(join(repo, "tracked.txt"), "utf8")).replace(/\r\n/g, "\n")).toBe(
      "staged\n",
    );
  });

  it("returns status and line counts from one staged review", async () => {
    await writeFile(join(repo, "tracked.txt"), "first\nsecond\n");
    await stageFile(repo, "tracked.txt");

    const review = await reviewChanges(repo, { type: "staged" });

    expect(review).toMatchObject({
      state: "ready",
      totals: { added: 2, removed: 1, fileCount: 1 },
      files: [{ path: "tracked.txt", status: "M", added: 2, removed: 1, binary: false }],
    });
  });

  it("keeps Git's rename identity while merging numstat", async () => {
    await git(["mv", "tracked.txt", "renamed.txt"]);

    const review = await reviewChanges(repo, { type: "staged" });

    expect(review.files).toEqual([
      expect.objectContaining({
        path: "renamed.txt",
        renamedFrom: "tracked.txt",
        status: "R100",
        added: 0,
        removed: 0,
      }),
    ]);
  });

  it("does not load a working file beyond the inline preview cap", async () => {
    await writeFile(join(repo, "tracked.txt"), "x".repeat(4 * 1024 * 1024 + 1));

    const preview = await readFilePatch(
      repo,
      "tracked.txt",
      { type: "unstaged" },
      {
        untracked: false,
        ignoreWhitespace: false,
      },
    );

    expect(preview).toMatchObject({ patch: "", truncated: true });
    expect(preview.bytes).toBeGreaterThan(4 * 1024 * 1024);
  });

  it("builds a bounded patch for an untracked file", async () => {
    await writeFile(join(repo, "new.txt"), "hello\n");

    const preview = await readFilePatch(
      repo,
      "new.txt",
      { type: "unstaged" },
      {
        untracked: true,
        ignoreWhitespace: false,
      },
    );

    expect(preview.patch).toContain("+hello");
    expect(preview.truncated).toBe(false);
  });

  it("omits trailing-whitespace-only changes when requested", async () => {
    await writeFile(join(repo, "tracked.txt"), "base  \n");

    const preview = await readFilePatch(
      repo,
      "tracked.txt",
      { type: "unstaged" },
      {
        untracked: false,
        ignoreWhitespace: true,
      },
    );

    expect(preview.patch).toBe("");
  });

  it("cancels a superseded review at the Git runner", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(reviewChanges(repo, { type: "unstaged" }, controller.signal)).rejects.toThrow();
  });

  it("reviews an explicitly selected branch from its merge-base through the working tree", async () => {
    await git(["branch", "release-base"]);
    await writeFile(join(repo, "committed.txt"), "committed\n");
    await git(["add", "committed.txt"]);
    await git(["commit", "-m", "feature commit"]);
    await writeFile(join(repo, "tracked.txt"), "staged\n");
    await stageFile(repo, "tracked.txt");
    await writeFile(join(repo, "tracked.txt"), "working\n");
    await writeFile(join(repo, "untracked.txt"), "new\n");

    const review = await reviewChanges(repo, { type: "branch", base: "release-base" });

    expect(review.resolvedBase).toBe("release-base");
    expect(review.files.map((change) => change.path).sort()).toEqual([
      "committed.txt",
      "tracked.txt",
      "untracked.txt",
    ]);
  });

  it("does not guess a conventional default branch name", async () => {
    await git(["config", "init.defaultBranch", "missing-default"]);
    expect(await defaultBranch(repo)).toBeUndefined();
    await expect(reviewChanges(repo, { type: "branch" })).rejects.toThrow("Choose a base branch");
  });

  it("creates, finishes, applies, and cleans up a subagent worktree", async () => {
    const worktree = await createSubagentWorktree(repo, {
      sessionId: "abcdef12-3456-7890-abcd-ef1234567890",
      name: "writer",
    });
    expect(worktree.path.replace(/\\/g, "/")).toContain("/.modus/worktrees/writer-abcdef12");

    await writeFile(join(worktree.path, "tracked.txt"), "child\n");
    const finished = await finishSubagentWorktree(worktree, "Change tracked file");

    expect(finished.integrationStatus).toBe("ready");
    expect(finished.changedFiles).toEqual(["tracked.txt"]);
    expect((await git(["status", "--porcelain=v1"])).trim()).toBe("");

    const applied = await applySubagentWorktree(repo, finished);
    expect(applied.integrationStatus).toBe("applied");
    expect((await readFile(join(repo, "tracked.txt"), "utf8")).replace(/\r\n/g, "\n")).toBe(
      "child\n",
    );
    const summary = await getStatusSummary(repo);
    expect(summary.mergeInProgress).toBe(true);
    expect(summary.stagedCount).toBe(1);
    await git(["commit", "-m", "apply child"]);

    const cleaned = await cleanupSubagentWorktree(repo, applied);
    expect(cleaned.integrationStatus).toBe("cleaned");
    expect(existsSync(worktree.path)).toBe(false);
  });

  it("rejects worktree isolation outside a committed git repo", async () => {
    const plain = await mkdtemp(join(tmpdir(), "modus-non-git-"));
    const unborn = await mkdtemp(join(tmpdir(), "modus-unborn-git-"));
    try {
      await expect(
        createSubagentWorktree(plain, { sessionId: "child", name: "writer" }),
      ).rejects.toThrow("Git repository");
      await execFileAsync("git", ["init"], { cwd: unborn, windowsHide: true });
      await expect(
        createSubagentWorktree(unborn, { sessionId: "child", name: "writer" }),
      ).rejects.toThrow("initial commit");
    } finally {
      await rm(plain, { recursive: true, force: true });
      await rm(unborn, { recursive: true, force: true });
    }
  });

  it("marks subagent apply conflicts without resolving them", async () => {
    const worktree = await createSubagentWorktree(repo, {
      sessionId: "12345678-3456-7890-abcd-ef1234567890",
      name: "writer",
    });
    await writeFile(join(worktree.path, "tracked.txt"), "child\n");
    const finished = await finishSubagentWorktree(worktree, "Child edit");

    await writeFile(join(repo, "tracked.txt"), "main\n");
    await git(["add", "tracked.txt"]);
    await git(["commit", "-m", "main edit"]);

    const conflicted = await applySubagentWorktree(repo, finished);

    expect(conflicted.integrationStatus).toBe("conflict");
    expect(conflicted.conflictFiles).toEqual(["tracked.txt"]);
    const summary = await getStatusSummary(repo);
    expect(summary.mergeInProgress).toBe(true);
    expect(summary.conflictFiles).toEqual(["tracked.txt"]);
  });

  it("aborts a pending subagent apply back to ready", async () => {
    const worktree = await createSubagentWorktree(repo, {
      sessionId: "abcdef12-0000-0000-0000-ef1234567890",
      name: "writer",
    });
    await writeFile(join(worktree.path, "tracked.txt"), "child\n");
    const finished = await finishSubagentWorktree(worktree, "Child edit");
    const applied = await applySubagentWorktree(repo, finished);

    await expect(applySubagentWorktree(repo, finished)).rejects.toThrow("pending worktree apply");
    const aborted = await abortSubagentWorktreeApply(repo, applied);

    expect(aborted.integrationStatus).toBe("ready");
    expect((await getStatusSummary(repo)).mergeInProgress).toBe(false);
    expect(await listChanges(repo)).toEqual([]);
    expect((await readFile(join(repo, "tracked.txt"), "utf8")).replace(/\r\n/g, "\n")).toBe(
      "base\n",
    );
  });

  it("reports branches already checked out by linked worktrees", async () => {
    const current = (await git(["symbolic-ref", "--short", "HEAD"])).trim();
    const worktree = await createSubagentWorktree(repo, {
      sessionId: "abcdef12-2222-0000-0000-ef1234567890",
      name: "writer",
    });

    const branches = await listBranches(repo);
    const childBranch = branches.local.find((branch) => branch.name === worktree.branch);
    expect(childBranch?.worktreePath?.replace(/\\/g, "/")).toBe(worktree.path.replace(/\\/g, "/"));

    const result = await checkoutBranch(repo, worktree.branch);
    expect(result.kind).toBe("worktree");
    expect(result.worktreePath?.replace(/\\/g, "/")).toBe(worktree.path.replace(/\\/g, "/"));
    expect((await git(["symbolic-ref", "--short", "HEAD"])).trim()).toBe(current);
  });
});
