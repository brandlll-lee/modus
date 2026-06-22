import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type {
  DiffFileVersions,
  DiffMode,
  FileChange,
  FileChangeStat,
  FileDiff,
  GitBranch,
  GitBranchSummary,
  GitCommit,
  GitCommitResult,
  GitStatusSummary,
  SubagentWorktreeInfo,
  WorkingChangeStats,
} from "../../shared/contracts";
import { GitError, messageForCode } from "./git-errors";
import { resolveRepo } from "./git-repo";
import { isIndexLocked, resolveUserPath, runGit, runGitSafe, runGitSafeRaw } from "./git-runner";

/**
 * Thin shim over the hardened runner (`git-runner.ts`), preserving the historical
 * `(cwd, args, extraEnv)` call shape used throughout this module. Flags,
 * cross-platform binary resolution, and structured errors live in the runner.
 */
function git(cwd: string, args: string[], extraEnv?: Record<string, string>): Promise<string> {
  return runGit(cwd, args, extraEnv ? { env: extraEnv } : {});
}

const gitSafe = runGitSafe;

/** Reject writes while another git process holds the index lock (worktree-aware). */
function assertWritable(cwd: string): void {
  const repo = resolveRepo(cwd);
  if (repo && isIndexLocked(repo.gitDir)) {
    throw new GitError("index-locked", messageForCode("index-locked"));
  }
}

export async function isGitRepository(rootPath: string): Promise<boolean> {
  if (!existsSync(join(rootPath, ".git"))) {
    return false;
  }

  try {
    await git(rootPath, ["rev-parse", "--show-toplevel"]);
    return true;
  } catch {
    return false;
  }
}

export async function listChanges(cwd: string): Promise<FileChange[]> {
  const output = await git(cwd, ["status", "--porcelain=v1", "-z"]);
  const parts = output.split("\0").filter(Boolean);
  const changes: FileChange[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index];
    if (!entry) continue;
    const status = entry.slice(0, 2);
    const rawPath = entry.slice(3);
    const renamed = status.includes("R") || status.includes("C");
    const renamedFrom = renamed ? parts[index + 1] : undefined;
    if (renamed) index += 1;

    const change: FileChange = {
      path: rawPath,
      status: status.trim(),
      staged: status[0] !== " " && status[0] !== "?",
      unstaged: status[1] !== " " || status === "??",
      untracked: status === "??",
    };
    if (renamedFrom !== undefined) change.renamedFrom = renamedFrom;
    changes.push(change);
  }

  return changes;
}

export async function readDiff(
  cwd: string,
  filePath?: string,
  mode: DiffMode = "unstaged",
): Promise<FileDiff> {
  const args =
    mode === "staged"
      ? filePath
        ? ["diff", "--cached", "--", filePath]
        : ["diff", "--cached"]
      : filePath
        ? ["diff", "--", filePath]
        : ["diff"];
  const diff = await git(cwd, args);

  return {
    path: filePath ?? ".",
    diff,
    mode,
  };
}

/** Byte cap per side of a file-versions read; keeps IPC payloads bounded. */
const MAX_VERSION_BYTES = 4 * 1024 * 1024;

/** Read a blob from the object database ("" when the spec doesn't resolve, e.g. new files). */
async function gitShowBlob(cwd: string, spec: string): Promise<string> {
  return await runGitSafeRaw(cwd, ["show", spec]);
}

/**
 * The repo's default branch — `origin/HEAD` when set, else a local `main`/
 * `master` that actually resolves. Returns undefined when none can be
 * determined (e.g. unborn branch with no conventional default).
 */
async function defaultBranch(cwd: string): Promise<string | undefined> {
  const head = await gitSafe(cwd, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (head) {
    return head.replace(/^origin\//, "");
  }
  for (const name of ["main", "master"]) {
    if (await gitSafe(cwd, ["rev-parse", "--verify", "--quiet", name])) {
      return name;
    }
  }
  return undefined;
}

/**
 * Diff of the current branch against the repo's default branch, computed from
 * their merge-base (`git diff base...HEAD`) — the "what this branch changed"
 * view. `base` is undefined when no default branch can be determined; `diff`
 * is empty when there is no divergence. Never throws (safe runner).
 */
export async function readBranchDiff(cwd: string): Promise<{ base?: string; diff: string }> {
  const base = await defaultBranch(cwd);
  if (!base) {
    return { diff: "" };
  }
  const diff = await runGitSafeRaw(cwd, ["diff", `${base}...HEAD`]);
  return { base, diff };
}

function capVersion(text: string): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= MAX_VERSION_BYTES) {
    return { text, truncated: false };
  }
  return {
    text: Buffer.from(text, "utf8").subarray(0, MAX_VERSION_BYTES).toString("utf8"),
    truncated: true,
  };
}

/**
 * Full before/after contents of one changed file for the side-by-side viewer.
 *
 * The two sides mirror what `git diff` compares in each mode:
 * - `unstaged`: index (`:0:path`) vs the working tree file
 * - `staged`:   `HEAD:path` vs the index (`:0:path`)
 * Untracked files resolve to an empty original; deleted files to an empty
 * modified side. `originalPath` supports renames (status R) where the old
 * content lives under the previous path.
 */
export async function readFileVersions(
  cwd: string,
  filePath: string,
  mode: "unstaged" | "staged" = "unstaged",
  originalPath?: string,
  commit?: string,
): Promise<DiffFileVersions> {
  assertSafeRelativePath(filePath);
  const fromPath = originalPath ?? filePath;

  let original: string;
  let modified: string;
  if (commit) {
    // Commit scope: compare the commit's parent snapshot against the commit
    // itself — the authoritative "what this commit changed". `commit^` is empty
    // for the root commit, so the original side resolves to "" (all-added).
    original = await gitShowBlob(cwd, `${commit}^:${fromPath}`);
    modified = await gitShowBlob(cwd, `${commit}:${filePath}`);
  } else if (mode === "staged") {
    original = await gitShowBlob(cwd, `HEAD:${fromPath}`);
    modified = await gitShowBlob(cwd, `:0:${filePath}`);
  } else {
    original = await gitShowBlob(cwd, `:0:${fromPath}`);
    modified = await readFile(join(cwd, filePath), "utf8").catch(() => "");
  }

  const binary = original.includes("\u0000") || modified.includes("\u0000");
  const cappedOriginal = capVersion(binary ? "" : original);
  const cappedModified = capVersion(binary ? "" : modified);

  return {
    path: filePath,
    mode,
    original: cappedOriginal.text,
    modified: cappedModified.text,
    binary,
    truncated: cappedOriginal.truncated || cappedModified.truncated,
  };
}

/** Field separator unlikely to appear in commit metadata; record-terminated by NUL. */
const LOG_SEP = "\u001f";

/**
 * Recent commit history for the Source Control "All commits" scope. One `git
 * log` call; files per commit are fetched lazily via `listCommitChanges`.
 */
export async function listCommitLog(cwd: string, limit = 50): Promise<GitCommit[]> {
  const format = ["%H", "%h", "%s", "%an", "%aI", "%ar"].join(LOG_SEP);
  const output = await gitSafe(cwd, [
    "log",
    `--max-count=${Math.max(1, Math.min(limit, 500))}`,
    `--format=${format}%x00`,
  ]);
  const commits: GitCommit[] = [];
  for (const record of output.split("\0")) {
    const line = record.trim();
    if (!line) continue;
    const [hash, shortHash, subject, author, date, relativeDate] = line.split(LOG_SEP);
    if (!hash) continue;
    commits.push({
      hash,
      shortHash: shortHash ?? hash.slice(0, 7),
      subject: subject ?? "",
      author: author ?? "",
      date: date ?? "",
      relativeDate: relativeDate ?? "",
    });
  }
  return commits;
}

/**
 * Files touched by a single commit (vs its first parent), as FileChange records
 * keyed by git's authoritative name-status code. Commit files are not stageable,
 * so staged/unstaged are left false — the renderer reads `status` for the badge.
 */
export async function listCommitChanges(cwd: string, commit: string): Promise<FileChange[]> {
  const output = await gitSafe(cwd, [
    "diff-tree",
    "--no-commit-id",
    "--name-status",
    "-r",
    "-z",
    commit,
  ]);
  const parts = output.split("\0").filter(Boolean);
  const changes: FileChange[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const status = parts[index];
    if (!status) continue;
    const code = status[0];
    const renamed = code === "R" || code === "C";
    if (renamed) {
      const renamedFrom = parts[index + 1];
      const path = parts[index + 2];
      index += 2;
      if (!path) continue;
      changes.push({
        path,
        status: status.trim(),
        staged: false,
        unstaged: false,
        untracked: false,
        ...(renamedFrom !== undefined ? { renamedFrom } : {}),
      });
    } else {
      const path = parts[index + 1];
      index += 1;
      if (!path) continue;
      changes.push({
        path,
        status: status.trim(),
        staged: false,
        unstaged: false,
        untracked: false,
      });
    }
  }
  return changes;
}

/** True when the repo has at least one commit (HEAD resolves); false on an unborn branch. */
async function hasHead(cwd: string): Promise<boolean> {
  return Boolean(await gitSafe(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]));
}

function assertSafeRelativePath(filePath: string): void {
  const trimmed = filePath.trim();
  if (!trimmed) {
    throw new Error("File path is required.");
  }
  if (
    isAbsolute(trimmed) ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("../") ||
    trimmed.includes("..\\")
  ) {
    throw new Error(`Refusing unsafe Git path: ${filePath}`);
  }
}

export async function discardFile(cwd: string, filePath: string): Promise<void> {
  assertSafeRelativePath(filePath);
  assertWritable(cwd);
  const change = (await listChanges(cwd)).find((item) => item.path === filePath);
  if (!change) {
    throw new Error(`No local change found for ${filePath}.`);
  }
  if (change.untracked) {
    throw new Error(
      "Discarding untracked files is disabled. Delete the file manually after review.",
    );
  }

  if (await hasHead(cwd)) {
    await git(cwd, ["restore", "--staged", "--worktree", "--", filePath]);
  } else {
    // Unborn branch: no HEAD to restore to. The only changes possible are staged
    // new files — unstage them (working contents kept), don't fail.
    await git(cwd, ["rm", "--cached", "--quiet", "--", filePath]);
  }
}

/** Stage every working-tree change. Internal — `commitOrPush` always stages all
 * before committing (there is no per-file staging UI). */
async function stageAll(cwd: string): Promise<void> {
  assertWritable(cwd);
  await git(cwd, ["add", "-A"]);
}

async function commitChanges(cwd: string, message: string): Promise<string> {
  assertWritable(cwd);
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error("Commit message is required.");
  }
  const stagedDiff = await git(cwd, ["diff", "--cached"]);
  if (!stagedDiff.trim()) {
    throw new Error("No staged changes to commit.");
  }
  // Run with the user's login-shell PATH so commit/commit-msg hooks can find
  // user-installed binaries even in a packaged GUI build.
  return await runGit(cwd, ["commit", "-m", trimmed], { hookPath: await resolveUserPath() });
}

/* ── Change stats (numstat summaries for the changes card / composer strip) ─ */

/** Cap the per-file list so IPC payloads stay bounded; totals stay exact. */
const MAX_STAT_FILES = 500;
/** Cap reads when counting lines of new untracked files. */
const MAX_COUNT_BYTES = 4 * 1024 * 1024;

function parseNumstat(output: string): FileChangeStat[] {
  const stats: FileChangeStat[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const [addedRaw, removedRaw, ...pathParts] = line.split("\t");
    const path = pathParts.join("\t");
    if (!path) {
      continue;
    }
    const binary = addedRaw === "-" || removedRaw === "-";
    stats.push({
      path,
      added: binary ? 0 : Number.parseInt(addedRaw ?? "0", 10) || 0,
      removed: binary ? 0 : Number.parseInt(removedRaw ?? "0", 10) || 0,
      untracked: false,
      binary,
    });
  }
  return stats;
}

/** Count a new file's lines for +N display; binary (NUL) counts as 0/binary. */
async function countNewFileLines(
  cwd: string,
  path: string,
): Promise<{ lines: number; binary: boolean }> {
  try {
    const { open } = await import("node:fs/promises");
    const handle = await open(join(cwd, path), "r");
    try {
      const { size } = await handle.stat();
      const length = Math.min(Number(size), MAX_COUNT_BYTES);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, 0);
      if (buffer.includes(0)) {
        return { lines: 0, binary: true };
      }
      if (length === 0) {
        return { lines: 0, binary: false };
      }
      let lines = 0;
      for (const byte of buffer) {
        if (byte === 10) lines += 1;
      }
      if (buffer.at(-1) !== 10) {
        lines += 1;
      }
      return { lines, binary: false };
    } finally {
      await handle.close();
    }
  } catch {
    return { lines: 0, binary: false };
  }
}

/**
 * Change summary of the working tree relative to `base` (a commit-ish):
 * numstat for tracked paths plus +line counts for NEW untracked files (files
 * that were already untracked at `base` — i.e. present in its snapshot tree —
 * are not double-reported). Powers the composer changes strip (base = HEAD)
 * and per-turn cards (base = the run's pre-checkpoint snapshot).
 */
export async function getChangeStatsSince(cwd: string, base: string): Promise<WorkingChangeStats> {
  const hasBase = Boolean(await gitSafe(cwd, ["rev-parse", "--verify", `${base}^{commit}`]));
  const tracked = hasBase
    ? parseNumstat(await gitSafe(cwd, ["diff", "--numstat", base, "--"]))
    : [];

  const basePaths = hasBase
    ? new Set(
        (await gitSafe(cwd, ["ls-tree", "-r", "--name-only", "-z", base]))
          .split("\0")
          .filter(Boolean),
      )
    : new Set<string>();
  const untrackedNow = (await gitSafe(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]))
    .split("\0")
    .filter(Boolean);

  const files: FileChangeStat[] = [...tracked];
  for (const path of untrackedNow) {
    if (basePaths.has(path)) {
      continue;
    }
    const { lines, binary } = await countNewFileLines(cwd, path);
    files.push({ path, added: lines, removed: 0, untracked: true, binary });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  const added = files.reduce((total, file) => total + file.added, 0);
  const removed = files.reduce((total, file) => total + file.removed, 0);
  const truncated = files.length > MAX_STAT_FILES;
  return {
    files: truncated ? files.slice(0, MAX_STAT_FILES) : files,
    added,
    removed,
    fileCount: files.length,
    truncated,
  };
}

/** Working-tree change summary vs HEAD — the composer strip / apply review payload. */
export async function getWorkingChangeStats(cwd: string): Promise<WorkingChangeStats> {
  return await getChangeStatsSince(cwd, "HEAD");
}

/**
 * Branch / remote / ahead-behind summary for the review panel.
 *
 * Mirrors the command sequence used by opencode & openai-codex:
 *   - branch:   symbolic-ref --quiet --short HEAD   (empty when detached)
 *   - upstream: rev-parse --abbrev-ref @{upstream}  (fails when untracked)
 *   - sync:     rev-list --left-right --count @{upstream}...HEAD  → "behind  ahead"
 */
export async function getStatusSummary(cwd: string): Promise<GitStatusSummary> {
  const branch = (await gitSafe(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"])) || undefined;
  const remotes = (await gitSafe(cwd, ["remote"])).split("\n").filter(Boolean);
  const hasRemote = remotes.length > 0;

  const upstream = await gitSafe(cwd, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]);
  const hasUpstream = upstream.length > 0;

  let ahead = 0;
  let behind = 0;
  if (hasUpstream) {
    const counts = await gitSafe(cwd, [
      "rev-list",
      "--left-right",
      "--count",
      "@{upstream}...HEAD",
    ]);
    const [behindRaw, aheadRaw] = counts.split(/\s+/);
    behind = Number.parseInt(behindRaw ?? "0", 10) || 0;
    ahead = Number.parseInt(aheadRaw ?? "0", 10) || 0;
  }

  const changes = await listChanges(cwd);
  const stagedCount = changes.filter((change) => change.staged).length;
  const unstagedCount = changes.filter((change) => change.unstaged || change.untracked).length;

  // added/removed reflect the WHOLE working tree (incl. untracked new files),
  // so the commit dialog header matches the panel summary — one source of truth.
  const working = await getWorkingChangeStats(cwd);

  return {
    ...(branch ? { branch } : {}),
    hasRemote,
    hasUpstream,
    ahead,
    behind,
    added: working.added,
    removed: working.removed,
    stagedCount,
    unstagedCount,
  };
}

/**
 * Push the current branch. Sets upstream on first push (mirrors
 * `git push -u origin <branch>` from the reference projects); otherwise a
 * plain `git push`.
 */
export async function pushCurrentBranch(cwd: string): Promise<string> {
  const summary = await getStatusSummary(cwd);
  if (!summary.branch) {
    throw new GitError("detached-head", messageForCode("detached-head"));
  }
  if (!summary.hasRemote) {
    throw new GitError("no-remote", messageForCode("no-remote"));
  }

  if (summary.hasUpstream) {
    return await runGit(cwd, ["push"], { hookPath: await resolveUserPath() });
  }

  const remotes = (await gitSafe(cwd, ["remote"])).split("\n").filter(Boolean);
  const remote = remotes.includes("origin") ? "origin" : (remotes[0] as string);
  return await runGit(cwd, ["push", "--set-upstream", remote, summary.branch], {
    hookPath: await resolveUserPath(),
  });
}

/**
 * High-level entry for the commit dialog. When committing, always stages the
 * whole working tree first (there is no per-file staging UI), commits, then
 * optionally pushes. Any sub-step may be a no-op so callers can request
 * push-only, commit-only, or commit-and-push from one place.
 */
export async function commitOrPush(
  cwd: string,
  options: { message?: string; commit: boolean; push: boolean },
): Promise<GitCommitResult> {
  const outputs: string[] = [];
  let committed = false;
  let commitHash: string | undefined;

  if (options.commit) {
    await stageAll(cwd);
    const message = options.message?.trim();
    if (!message) {
      throw new Error("Commit message is required.");
    }
    const commitOutput = await commitChanges(cwd, message);
    outputs.push(commitOutput.trim());
    committed = true;
    commitHash = (await gitSafe(cwd, ["rev-parse", "--short", "HEAD"])) || undefined;
  }

  let pushed = false;
  if (options.push) {
    const pushOutput = await pushCurrentBranch(cwd);
    if (pushOutput.trim()) outputs.push(pushOutput.trim());
    pushed = true;
  }

  return {
    committed,
    pushed,
    ...(commitHash ? { commit: commitHash } : {}),
    output: outputs.filter(Boolean).join("\n"),
  };
}

/**
 * Local + remote-tracking branches for the branch switcher.
 *
 *   local:  for-each-ref refs/heads   →  name \t HEAD-marker \t upstream
 *   remote: for-each-ref refs/remotes →  name   (origin/HEAD pointer dropped)
 */
export async function listBranches(cwd: string): Promise<GitBranchSummary> {
  const localRaw = await gitSafe(cwd, [
    "for-each-ref",
    "--format=%(refname:short)%09%(HEAD)%09%(upstream:short)",
    "refs/heads",
  ]);
  const remoteRaw = await gitSafe(cwd, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/remotes",
  ]);

  let current: string | undefined;
  const local: GitBranch[] = [];
  for (const line of localRaw.split("\n").filter(Boolean)) {
    const [name, head, upstream] = line.split("\t");
    if (!name) continue;
    const isCurrent = head === "*";
    if (isCurrent) current = name;
    local.push({
      name,
      current: isCurrent,
      remote: false,
      ...(upstream ? { upstream } : {}),
    });
  }
  // Current branch first, then alphabetical — matches how GUIs surface "you are here".
  local.sort((a, b) => (a.current ? -1 : b.current ? 1 : a.name.localeCompare(b.name)));

  const remote: GitBranch[] = remoteRaw
    .split("\n")
    .filter((name) => name && !name.endsWith("/HEAD"))
    .map((name) => ({ name, current: false, remote: true }));

  return {
    ...(current ? { current } : {}),
    local,
    remote,
  };
}

async function branchExistsLocally(cwd: string, name: string): Promise<boolean> {
  try {
    await git(cwd, ["show-ref", "--verify", `refs/heads/${name}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Switch to a branch. `remote` distinguishes a remote-tracking ref
 * ("origin/feature") from a local head — local branch names may themselves
 * contain "/", so we can't infer it from the string. For a remote ref we switch
 * to (or create + track) the matching local branch instead of detaching HEAD.
 * Git refuses (and we surface the error) when uncommitted changes would be lost.
 */
export async function checkoutBranch(cwd: string, name: string, remote = false): Promise<string> {
  const target = name.trim();
  if (!target) {
    throw new Error("Branch name is required.");
  }
  if (!remote) {
    return await git(cwd, ["switch", target]);
  }
  const localName = target.includes("/") ? target.slice(target.indexOf("/") + 1) : target;
  if (await branchExistsLocally(cwd, localName)) {
    return await git(cwd, ["switch", localName]);
  }
  return await git(cwd, ["switch", "--track", target]);
}

function subagentSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "task"
  );
}

function assertManagedWorktreePath(repoRoot: string, worktreePath: string): void {
  const root = resolve(repoRoot, ".modus", "worktrees");
  const target = resolve(worktreePath);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Refusing to manage a worktree outside .modus/worktrees.");
  }
}

async function changedFilesBetween(cwd: string, base: string, target: string): Promise<string[]> {
  return (await gitSafe(cwd, ["diff", "--name-only", "-z", base, target]))
    .split("\0")
    .filter(Boolean);
}

async function unmergedFiles(cwd: string): Promise<string[]> {
  return (await gitSafe(cwd, ["diff", "--name-only", "--diff-filter=U", "-z"]))
    .split("\0")
    .filter(Boolean);
}

async function excludeManagedWorktrees(commonGitDir: string): Promise<void> {
  const excludePath = join(commonGitDir, "info", "exclude");
  const marker = ".modus/worktrees/";
  const current = await readFile(excludePath, "utf8").catch(() => "");
  if (!current.split(/\r?\n/).includes(marker)) {
    await appendFile(excludePath, `${current.endsWith("\n") || !current ? "" : "\n"}${marker}\n`);
  }
}

export async function createSubagentWorktree(
  cwd: string,
  input: { sessionId: string; name: string },
): Promise<SubagentWorktreeInfo> {
  const repo = resolveRepo(cwd);
  if (!repo) {
    throw new Error("Worktree isolation requires a Git repository.");
  }
  const baseSha = await gitSafe(repo.root, ["rev-parse", "--verify", "HEAD"]);
  if (!baseSha) {
    throw new Error("Worktree isolation requires an initial commit.");
  }

  const shortId = input.sessionId.replace(/[^a-f0-9]/gi, "").slice(0, 8);
  const name = `${subagentSlug(input.name)}-${shortId || input.sessionId.slice(0, 8)}`;
  const worktreeRoot = join(repo.root, ".modus", "worktrees");
  const worktreePath = join(worktreeRoot, name);
  const branch = `modus/subagent/${name}`;
  await mkdir(worktreeRoot, { recursive: true });
  await excludeManagedWorktrees(repo.commonGitDir);
  await git(repo.root, ["worktree", "add", "-b", branch, worktreePath, baseSha]);
  return { path: worktreePath, branch, baseSha, integrationStatus: "running" };
}

export async function finishSubagentWorktree(
  worktree: SubagentWorktreeInfo,
  task: string,
): Promise<SubagentWorktreeInfo> {
  const dirty = (await gitSafe(worktree.path, ["status", "--porcelain=v1"])).trim();
  if (dirty) {
    await git(worktree.path, ["add", "-A"]);
    if ((await gitSafe(worktree.path, ["diff", "--cached", "--name-only"])).trim()) {
      await runGit(
        worktree.path,
        [
          "-c",
          "user.name=Modus",
          "-c",
          "user.email=subagent@modus.local",
          "commit",
          "-m",
          `subagent: ${task.trim() || "worktree changes"}`,
        ],
        { hookPath: await resolveUserPath() },
      );
    }
  }
  const changedFiles = await changedFilesBetween(worktree.path, worktree.baseSha, "HEAD");
  return {
    ...worktree,
    integrationStatus: changedFiles.length > 0 ? "ready" : "no_changes",
    changedFiles,
  };
}

export async function applySubagentWorktree(
  parentCwd: string,
  worktree: SubagentWorktreeInfo,
): Promise<SubagentWorktreeInfo> {
  if ((await gitSafe(parentCwd, ["status", "--porcelain=v1"])).trim()) {
    throw new Error("Apply requires a clean main workspace.");
  }
  try {
    await git(parentCwd, ["merge", "--no-commit", "--no-ff", worktree.branch]);
    return {
      path: worktree.path,
      branch: worktree.branch,
      baseSha: worktree.baseSha,
      integrationStatus: "applied",
      ...(worktree.changedFiles ? { changedFiles: worktree.changedFiles } : {}),
    };
  } catch (error) {
    const conflictFiles = await unmergedFiles(parentCwd);
    if (conflictFiles.length > 0) {
      return { ...worktree, integrationStatus: "conflict", conflictFiles };
    }
    throw error;
  }
}

export async function cleanupSubagentWorktree(
  parentCwd: string,
  worktree: SubagentWorktreeInfo,
): Promise<SubagentWorktreeInfo> {
  const repo = resolveRepo(parentCwd);
  if (!repo) {
    throw new Error("Worktree cleanup requires a Git repository.");
  }
  assertManagedWorktreePath(repo.root, worktree.path);
  await git(repo.root, ["worktree", "remove", "--force", worktree.path]);
  await gitSafe(repo.root, ["branch", "-D", worktree.branch]);
  await rm(worktree.path, { recursive: true, force: true }).catch(() => undefined);
  return { ...worktree, integrationStatus: "cleaned" };
}

/* ── Agent checkpoints ───────────────────────────────────────────────────
 * A snapshot is a dangling commit of the ENTIRE working tree (tracked +
 * untracked, .gitignore respected) built through a TEMPORARY index file, so
 * HEAD, the user's real index, and checkout files are never touched. A ref under
 * refs/modus/ keeps the chain reachable so `git gc` cannot prune it.
 */

export type CheckoutSnapshot = {
  commit: string;
  tree: string;
};

export async function captureCheckoutSnapshot(
  cwd: string,
  options: { refName: string; message: string; parent?: string | undefined },
): Promise<CheckoutSnapshot> {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const indexDir = await mkdtemp(join(tmpdir(), "modus-snapshot-"));
  const indexFile = join(indexDir, "index");
  const env = { GIT_INDEX_FILE: indexFile };

  try {
    await git(cwd, ["add", "-A", "--", "."], env);
    const tree = (await git(cwd, ["write-tree"], env)).trim();
    const commitArgs = ["commit-tree", tree, "-m", options.message];
    if (options.parent) {
      commitArgs.push("-p", options.parent);
    }
    const commit = (
      await git(cwd, commitArgs, {
        ...env,
        // commit-tree requires an identity even when the user never set one.
        GIT_AUTHOR_NAME: "Modus",
        GIT_AUTHOR_EMAIL: "checkpoint@modus.local",
        GIT_COMMITTER_NAME: "Modus",
        GIT_COMMITTER_EMAIL: "checkpoint@modus.local",
      })
    ).trim();
    await git(cwd, ["update-ref", options.refName, commit]);
    return { commit, tree };
  } finally {
    await rm(indexDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Make the checkout match a snapshot exactly: restore every file recorded
 * in the snapshot (index + working tree) and delete files that were created since.
 * Ignored files are left alone.
 */
export async function restoreCheckoutSnapshot(cwd: string, commit: string): Promise<void> {
  const { rm } = await import("node:fs/promises");

  const snapshotFiles = new Set(
    (await git(cwd, ["ls-tree", "-r", "--name-only", "-z", commit])).split("\0").filter(Boolean),
  );
  const currentFiles = (
    await git(cwd, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
  )
    .split("\0")
    .filter(Boolean);

  for (const file of currentFiles) {
    if (!snapshotFiles.has(file)) {
      assertSafeRelativePath(file);
      await rm(join(cwd, file), { force: true }).catch(() => {});
      await git(cwd, ["rm", "--cached", "--ignore-unmatch", "--quiet", "--", file]).catch(() => {});
    }
  }

  if (snapshotFiles.size > 0) {
    await git(cwd, ["restore", "--source", commit, "--staged", "--worktree", "--", ":/"]);
  }
}

/** Drop the ref that keeps a session's checkpoint chain alive (cleanup on delete). */
export async function deleteSnapshotRef(cwd: string, refName: string): Promise<void> {
  await gitSafe(cwd, ["update-ref", "-d", refName]);
}
