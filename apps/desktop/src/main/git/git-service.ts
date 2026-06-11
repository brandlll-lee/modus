import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type {
  DiffFileVersions,
  DiffMode,
  FileChange,
  FileChangeStat,
  FileDiff,
  GitBranch,
  GitBranchSummary,
  GitCommitResult,
  GitStatusSummary,
  WorkingChangeStats,
} from "../../shared/contracts";

const execFileAsync = promisify(execFile);

async function git(
  cwd: string,
  args: string[],
  extraEnv?: Record<string, string>,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 20,
      // Never block the Electron main process on an interactive credential or
      // editor prompt — network ops (push/pull/fetch) fail fast instead of hanging.
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_EDITOR: "true",
        ...extraEnv,
      },
    });

    return stdout;
  } catch (error) {
    // execFile rejects with stdout/stderr attached; surface the human-readable
    // git message (stderr) rather than the opaque "Command failed: git …".
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr ?? "").trim()
        : "";
    if (stderr) {
      throw new Error(stderr);
    }
    throw error;
  }
}

/** Run git tolerantly: never throws, returns trimmed stdout ("" on failure). */
async function gitSafe(cwd: string, args: string[]): Promise<string> {
  try {
    return (await git(cwd, args)).trim();
  } catch {
    return "";
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
  return await gitSafeRaw(cwd, ["show", spec]);
}

/** Like gitSafe but preserves trailing whitespace (blob contents are not trimmed). */
async function gitSafeRaw(cwd: string, args: string[]): Promise<string> {
  try {
    return await git(cwd, args);
  } catch {
    return "";
  }
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
): Promise<DiffFileVersions> {
  assertSafeRelativePath(filePath);
  const fromPath = originalPath ?? filePath;

  const original =
    mode === "staged"
      ? await gitShowBlob(cwd, `HEAD:${fromPath}`)
      : await gitShowBlob(cwd, `:0:${fromPath}`);

  let modified: string;
  if (mode === "staged") {
    modified = await gitShowBlob(cwd, `:0:${filePath}`);
  } else {
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

export async function revertFile(cwd: string, filePath: string): Promise<void> {
  await git(cwd, ["restore", "--source=HEAD", "--", filePath]);
}

export async function stageFile(cwd: string, filePath: string): Promise<void> {
  await git(cwd, ["add", "--", filePath]);
}

export async function unstageFile(cwd: string, filePath: string): Promise<void> {
  await git(cwd, ["restore", "--staged", "--", filePath]);
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
  const change = (await listChanges(cwd)).find((item) => item.path === filePath);
  if (!change) {
    throw new Error(`No local change found for ${filePath}.`);
  }
  if (change.untracked) {
    throw new Error(
      "Discarding untracked files is disabled. Delete the file manually after review.",
    );
  }

  await git(cwd, ["restore", "--staged", "--worktree", "--", filePath]);
}

export async function stageAll(cwd: string): Promise<void> {
  await git(cwd, ["add", "-A"]);
}

export async function commitChanges(cwd: string, message: string): Promise<string> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error("Commit message is required.");
  }
  const stagedDiff = await git(cwd, ["diff", "--cached"]);
  if (!stagedDiff.trim()) {
    throw new Error("No staged changes to commit.");
  }
  return await git(cwd, ["commit", "-m", trimmed]);
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

function countDiffLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
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

  const staged = countDiffLines(await gitSafe(cwd, ["diff", "--cached"]));
  const unstaged = countDiffLines(await gitSafe(cwd, ["diff"]));

  return {
    ...(branch ? { branch } : {}),
    hasRemote,
    hasUpstream,
    ahead,
    behind,
    added: staged.added + unstaged.added,
    removed: staged.removed + unstaged.removed,
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
    throw new Error("Cannot push from a detached HEAD. Check out a branch first.");
  }
  if (!summary.hasRemote) {
    throw new Error("No git remote configured. Add a remote before pushing.");
  }

  if (summary.hasUpstream) {
    return await git(cwd, ["push"]);
  }

  const remotes = (await gitSafe(cwd, ["remote"])).split("\n").filter(Boolean);
  const remote = remotes.includes("origin") ? "origin" : (remotes[0] as string);
  return await git(cwd, ["push", "--set-upstream", remote, summary.branch]);
}

/**
 * High-level entry for the commit dialog. Optionally stages everything,
 * commits (when a message is given and staged changes exist), then optionally
 * pushes. Any sub-step may be a no-op so callers can request push-only,
 * commit-only, or commit-and-push from one place.
 */
export async function commitOrPush(
  cwd: string,
  options: { message?: string; stageAll?: boolean; commit: boolean; push: boolean },
): Promise<GitCommitResult> {
  const outputs: string[] = [];
  let committed = false;
  let commitHash: string | undefined;

  if (options.commit) {
    if (options.stageAll) {
      await stageAll(cwd);
    }
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

const BRANCH_NAME_PATTERN = /^[^\s~^:?*[\\]+$/;

function assertSafeBranchName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Branch name is required.");
  }
  // Reject characters git itself forbids in ref names up front, with a friendlier message.
  if (
    !BRANCH_NAME_PATTERN.test(trimmed) ||
    trimmed.startsWith("-") ||
    trimmed.startsWith(".") ||
    trimmed.endsWith(".") ||
    trimmed.endsWith(".lock") ||
    trimmed.includes("..") ||
    trimmed.includes("@{") ||
    trimmed.includes("//")
  ) {
    throw new Error(`Invalid branch name: ${name}`);
  }
  return trimmed;
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

/** Create a new branch from the current HEAD and switch to it. */
export async function createBranch(cwd: string, name: string): Promise<string> {
  const safe = assertSafeBranchName(name);
  return await git(cwd, ["switch", "--create", safe]);
}

/**
 * Fast-forward the current branch from its upstream. `--ff-only` keeps the
 * action predictable in a GUI: no surprise merge commits, no editor, no
 * half-finished merge state — it errors cleanly when a plain pull would diverge.
 */
export async function pullCurrentBranch(cwd: string): Promise<string> {
  const summary = await getStatusSummary(cwd);
  if (!summary.branch) {
    throw new Error("Cannot pull from a detached HEAD. Check out a branch first.");
  }
  if (!summary.hasUpstream) {
    throw new Error("Current branch has no upstream to pull from.");
  }
  return await git(cwd, ["pull", "--ff-only"]);
}

/** Fetch all remotes and prune deleted remote-tracking refs. */
export async function fetchAll(cwd: string): Promise<string> {
  if (!(await gitSafe(cwd, ["remote"])).trim()) {
    throw new Error("No git remote configured.");
  }
  // stderr carries fetch progress; return it so the toast shows what changed.
  const { stdout, stderr } = await execFileAsync("git", ["fetch", "--all", "--prune"], {
    cwd,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 20,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
  }).catch((error: unknown) => {
    const message =
      typeof error === "object" && error !== null && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr ?? "").trim()
        : "";
    throw new Error(message || "git fetch failed");
  });
  return `${stdout}${stderr}`.trim();
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
