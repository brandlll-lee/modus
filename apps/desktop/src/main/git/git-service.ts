import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createTwoFilesPatch } from "diff";
import type {
  DiffFilePatch,
  DiffMode,
  DiffReviewReady,
  DiffTarget,
  FileChange,
  FileChangeStat,
  FileDiff,
  GitActionResult,
  GitBranch,
  GitBranchSummary,
  GitCommit,
  GitCommitResult,
  GitStatusSummary,
  ReviewFile,
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
  return (
    existsSync(rootPath) &&
    (await gitSafe(rootPath, ["rev-parse", "--is-inside-work-tree"])) === "true"
  );
}

export async function initRepository(cwd: string): Promise<GitActionResult> {
  if (await isGitRepository(cwd)) {
    return { output: "Repository already initialized." };
  }
  return { output: await git(cwd, ["init"]) };
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

/** Byte cap for one inline patch; larger changes stay outside the renderer. */
const MAX_PATCH_BYTES = 4 * 1024 * 1024;

/** Read a blob from the object database ("" when the spec doesn't resolve, e.g. new files). */
/**
 * The repo's authoritative default branch: the configured/sole remote HEAD,
 * then an existing `init.defaultBranch`. No branch-name guessing.
 */
export async function defaultBranch(
  cwd: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const current = await runGitSafe(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"], {
    signal,
  });
  const configuredRemote = current
    ? await runGitSafe(cwd, ["config", "--get", `branch.${current}.remote`], { signal })
    : "";
  const remotes = (await runGitSafe(cwd, ["remote"], { signal })).split("\n").filter(Boolean);
  const remote =
    configuredRemote && configuredRemote !== "."
      ? configuredRemote
      : remotes.length === 1
        ? remotes[0]
        : undefined;
  if (remote) {
    const head = await runGitSafe(
      cwd,
      ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`],
      { signal },
    );
    if (head) return head;
  }

  const configured = await runGitSafe(cwd, ["config", "--get", "init.defaultBranch"], {
    signal,
  });
  return configured &&
    (await runGitSafe(cwd, ["rev-parse", "--verify", `${configured}^{commit}`], { signal }))
    ? configured
    : undefined;
}

async function branchMergeBase(
  cwd: string,
  base?: string,
  signal?: AbortSignal,
): Promise<{ base: string; commit: string }> {
  const resolvedBase = base ?? (await defaultBranch(cwd, signal));
  if (!resolvedBase) {
    throw new Error("Choose a base branch to review.");
  }
  const commit = await runGitSafe(cwd, ["merge-base", "HEAD", resolvedBase], { signal });
  if (!commit) {
    throw new Error(`Unable to find a merge base with ${resolvedBase}.`);
  }
  return { base: resolvedBase, commit };
}

/**
 * Diff of the current branch against the repo's default branch, computed from
 * their merge-base (`git diff base...HEAD`) — the "what this branch changed"
 * view. `base` is undefined when no default branch can be determined; `diff`
 * is empty when there is no divergence. Never throws (safe runner).
 */
export async function readBranchDiff(cwd: string): Promise<{ base?: string; diff: string }> {
  try {
    const { base, commit } = await branchMergeBase(cwd);
    return { base, diff: await runGitSafeRaw(cwd, ["diff", commit, "HEAD"]) };
  } catch {
    return { diff: "" };
  }
}

export type GitDiffTarget =
  | Exclude<DiffTarget, { type: "last-turn" }>
  | { type: "snapshot"; from: string; to?: string };

type VersionSide = {
  text: string;
  bytes: number;
  binary: boolean;
  truncated: boolean;
  maxLineLength: number;
};

const EMPTY_VERSION_SIDE: VersionSide = {
  text: "",
  bytes: 0,
  binary: false,
  truncated: false,
  maxLineLength: 0,
};

function inspectVersion(buffer: Buffer, bytes: number, truncated: boolean): VersionSide {
  const binary = buffer.includes(0);
  let lineLength = 0;
  let maxLineLength = 0;
  for (const byte of buffer) {
    if (byte === 10) {
      maxLineLength = Math.max(maxLineLength, lineLength);
      lineLength = 0;
    } else {
      lineLength += 1;
    }
  }
  maxLineLength = Math.max(maxLineLength, lineLength);
  return {
    text: binary ? "" : buffer.toString("utf8"),
    bytes,
    binary,
    truncated,
    maxLineLength,
  };
}

async function readWorkingVersion(path: string): Promise<VersionSide> {
  const { open } = await import("node:fs/promises");
  const handle = await open(path, "r").catch(() => undefined);
  if (!handle) return EMPTY_VERSION_SIDE;
  try {
    const { size } = await handle.stat();
    if (Number(size) > MAX_PATCH_BYTES) {
      return { ...EMPTY_VERSION_SIDE, bytes: Number(size), truncated: true };
    }
    const length = Number(size);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return inspectVersion(buffer.subarray(0, bytesRead), Number(size), false);
  } finally {
    await handle.close();
  }
}

function inspectPatch(patch: string): DiffFilePatch {
  const buffer = Buffer.from(patch, "utf8");
  const inspected = inspectVersion(buffer, buffer.byteLength, false);
  return {
    patch,
    bytes: buffer.byteLength,
    binary: /^(?:Binary files .* differ|GIT binary patch)$/m.test(patch),
    truncated: false,
    maxLineLength: inspected.maxLineLength,
  };
}

/** One bounded Git patch for the read-only inline reviewer. */
export async function readFilePatch(
  cwd: string,
  filePath: string,
  target: GitDiffTarget,
  options: {
    originalPath?: string | undefined;
    untracked: boolean;
    ignoreWhitespace: boolean;
  },
): Promise<DiffFilePatch> {
  assertSafeRelativePath(filePath);
  if (options.originalPath) assertSafeRelativePath(options.originalPath);

  if (options.untracked) {
    const source = await readWorkingVersion(join(cwd, filePath));
    if (source.binary || source.truncated) {
      return {
        patch: "",
        bytes: source.bytes,
        binary: source.binary,
        truncated: source.truncated,
        maxLineLength: source.maxLineLength,
      };
    }
    return inspectPatch(
      createTwoFilesPatch(filePath, filePath, "", source.text, "", "", {
        context: 3,
      }),
    );
  }

  const flags = ["--no-ext-diff", "--no-color", "--unified=3", "-M"];
  if (options.ignoreWhitespace) flags.push("--ignore-space-at-eol");
  const paths = options.originalPath
    ? [options.originalPath, ...(options.originalPath === filePath ? [] : [filePath])]
    : [filePath];

  let args: string[];
  if (target.type === "commit") {
    args = ["show", "--format=", "--root", ...flags, target.commit, "--", ...paths];
  } else if (target.type === "staged") {
    args = ["diff", "--cached", ...flags, "--", ...paths];
  } else if (target.type === "unstaged") {
    args = ["diff", ...flags, "--", ...paths];
  } else if (target.type === "branch") {
    const { commit } = await branchMergeBase(cwd, target.base);
    args = ["diff", ...flags, commit, "--", ...paths];
  } else {
    args = ["diff", ...flags, target.from, ...(target.to ? [target.to] : []), "--", ...paths];
  }

  try {
    return inspectPatch(await runGit(cwd, args, { maxBuffer: MAX_PATCH_BYTES + 1 }));
  } catch (error) {
    if (error instanceof GitError && error.code === "output-too-large") {
      return {
        patch: "",
        bytes: MAX_PATCH_BYTES + 1,
        binary: false,
        truncated: true,
        maxLineLength: 0,
      };
    }
    throw error;
  }
}

/** Field separator unlikely to appear in commit metadata; record-terminated by NUL. */
const LOG_SEP = "\u001f";

/**
 * Recent commit history for the Source Control "All commits" scope. One `git
 * log` call; files per commit are fetched lazily via `listCommitChanges`.
 */
export async function listCommitLog(cwd: string, limit = 50): Promise<GitCommit[]> {
  // %P / %D feed the All-commits single-lane graph (parents → merge node; refs → pills).
  const format = ["%H", "%h", "%s", "%an", "%aI", "%ar", "%P", "%D"].join(LOG_SEP);
  const output = await gitSafe(cwd, [
    "log",
    `--max-count=${Math.max(1, Math.min(limit, 500))}`,
    `--format=${format}%x00`,
  ]);
  const commits: GitCommit[] = [];
  for (const record of output.split("\0")) {
    const line = record.trim();
    if (!line) continue;
    const [hash, shortHash, subject, author, date, relativeDate, parentsRaw, refsRaw] =
      line.split(LOG_SEP);
    if (!hash) continue;
    const parents = (parentsRaw ?? "").trim();
    const refs = (refsRaw ?? "").trim();
    commits.push({
      hash,
      shortHash: shortHash ?? hash.slice(0, 7),
      subject: subject ?? "",
      author: author ?? "",
      date: date ?? "",
      relativeDate: relativeDate ?? "",
      parents: parents ? parents.split(/\s+/) : [],
      refs: refs ? refs.split(", ").map((ref) => ref.trim()).filter(Boolean) : [],
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
    "--root",
    "--no-commit-id",
    "--name-status",
    "-r",
    "-z",
    commit,
  ]);
  return parseNameStatus(output, false, false);
}

function parseNameStatus(output: string, staged: boolean, unstaged: boolean): FileChange[] {
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
        staged,
        unstaged,
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
        staged,
        unstaged,
        untracked: false,
      });
    }
  }
  return changes;
}

function parseReviewDiff(output: string, staged: boolean, unstaged: boolean): ReviewFile[] {
  const parts = output.split("\0");
  const changes: FileChange[] = [];
  let index = 0;
  while (parts[index]?.startsWith(":")) {
    const header = parts[index++] ?? "";
    const status = header.trim().split(/\s+/).at(-1) ?? "M";
    const renamed = status.startsWith("R") || status.startsWith("C");
    const firstPath = parts[index++] ?? "";
    const path = renamed ? (parts[index++] ?? "") : firstPath;
    if (!path) continue;
    changes.push({
      path,
      status,
      staged,
      unstaged,
      untracked: false,
      ...(renamed ? { renamedFrom: firstPath } : {}),
    });
  }

  const stats = new Map<string, Pick<ReviewFile, "added" | "removed" | "binary">>();
  while (index < parts.length) {
    const record = parts[index++] ?? "";
    if (!record) continue;
    const [addedRaw, removedRaw, inlinePath] = record.split("\t");
    const path = inlinePath || parts[index + 1] || parts[index] || "";
    if (!inlinePath) index += 2;
    if (!path) continue;
    const binary = addedRaw === "-" || removedRaw === "-";
    stats.set(path, {
      added: binary ? 0 : Number.parseInt(addedRaw ?? "0", 10) || 0,
      removed: binary ? 0 : Number.parseInt(removedRaw ?? "0", 10) || 0,
      binary,
    });
  }

  return changes.map((change) => ({
    ...change,
    ...(stats.get(change.path) ?? { added: 0, removed: 0, binary: false }),
  }));
}

async function readTrackedReview(
  cwd: string,
  args: string[],
  staged: boolean,
  unstaged: boolean,
  signal?: AbortSignal,
): Promise<ReviewFile[]> {
  return parseReviewDiff(await runGit(cwd, args, { signal }), staged, unstaged);
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

export async function stageFile(cwd: string, filePath: string): Promise<void> {
  assertSafeRelativePath(filePath);
  assertWritable(cwd);
  await git(cwd, ["add", "-A", "--", filePath]);
}

export async function unstageFile(cwd: string, filePath: string): Promise<void> {
  assertSafeRelativePath(filePath);
  assertWritable(cwd);
  if (await hasHead(cwd)) {
    await git(cwd, ["restore", "--staged", "--", filePath]);
  } else {
    await git(cwd, ["rm", "--cached", "--quiet", "--", filePath]);
  }
}

export async function discardUnstagedFile(cwd: string, filePath: string): Promise<void> {
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
  if (!change.unstaged) {
    throw new Error(`No unstaged change found for ${filePath}.`);
  }
  await git(cwd, ["restore", "--worktree", "--", filePath]);
}

/** Stage every working-tree change when the user explicitly includes unstaged files. */
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

function summarizeStats(files: FileChangeStat[]): WorkingChangeStats {
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

async function listUntrackedReviewFiles(cwd: string, signal?: AbortSignal): Promise<ReviewFile[]> {
  const changes = (
    await runGitSafe(cwd, ["ls-files", "--others", "--exclude-standard", "-z"], { signal })
  )
    .split("\0")
    .filter(Boolean);
  const files: ReviewFile[] = [];
  for (let index = 0; index < changes.length; index += 8) {
    signal?.throwIfAborted();
    const batch = changes.slice(index, index + 8);
    files.push(
      ...(await Promise.all(
        batch.map(async (path) => {
          const { lines, binary } = await countNewFileLines(cwd, path);
          return {
            path,
            status: "??",
            staged: false,
            unstaged: true,
            untracked: true,
            added: lines,
            removed: 0,
            binary,
          } satisfies ReviewFile;
        }),
      )),
    );
  }
  return files;
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
  return summarizeStats(files);
}

/** Working-tree change summary vs HEAD — the composer strip / apply review payload. */
export async function getWorkingChangeStats(cwd: string): Promise<WorkingChangeStats> {
  return await getChangeStatsSince(cwd, "HEAD");
}

function readyReview(files: ReviewFile[], resolvedBase?: string): DiffReviewReady {
  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    state: "ready",
    files,
    totals: {
      added: files.reduce((total, file) => total + file.added, 0),
      removed: files.reduce((total, file) => total + file.removed, 0),
      fileCount: files.length,
    },
    ...(resolvedBase ? { resolvedBase } : {}),
  };
}

export async function reviewChanges(
  cwd: string,
  target: GitDiffTarget,
  signal?: AbortSignal,
): Promise<DiffReviewReady> {
  if (target.type === "unstaged") {
    const [tracked, untracked] = await Promise.all([
      readTrackedReview(cwd, ["diff", "-M", "--raw", "--numstat", "-z", "--"], false, true, signal),
      listUntrackedReviewFiles(cwd, signal),
    ]);
    return readyReview([...tracked, ...untracked]);
  }
  if (target.type === "staged") {
    return readyReview(
      await readTrackedReview(
        cwd,
        ["diff", "--cached", "-M", "--raw", "--numstat", "-z", "--"],
        true,
        false,
        signal,
      ),
    );
  }
  if (target.type === "commit") {
    return readyReview(
      await readTrackedReview(
        cwd,
        [
          "diff-tree",
          "--root",
          "--no-commit-id",
          "-r",
          "-M",
          "--raw",
          "--numstat",
          "-z",
          target.commit,
          "--",
        ],
        false,
        false,
        signal,
      ),
    );
  }
  if (target.type === "branch") {
    const { base, commit } = await branchMergeBase(cwd, target.base, signal);
    const [tracked, untracked] = await Promise.all([
      readTrackedReview(
        cwd,
        ["diff", "-M", "--raw", "--numstat", "-z", commit, "--"],
        false,
        false,
        signal,
      ),
      listUntrackedReviewFiles(cwd, signal),
    ]);
    return readyReview([...tracked, ...untracked], base);
  }
  const args = ["diff", "-M", "--raw", "--numstat", "-z", target.from];
  if (target.to) args.push(target.to);
  args.push("--");
  const tracked = await readTrackedReview(cwd, args, false, false, signal);
  return readyReview(
    target.to ? tracked : [...tracked, ...(await listUntrackedReviewFiles(cwd, signal))],
  );
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
  const mergeInProgress = Boolean(await gitSafe(cwd, ["rev-parse", "--verify", "MERGE_HEAD"]));
  const conflictFiles = mergeInProgress ? await unmergedFiles(cwd) : [];

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
    mergeInProgress,
    conflictFiles,
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
 * High-level entry for the commit dialog. The index is the commit boundary;
 * unstaged files are included only when the user explicitly requests it.
 */
export async function commitOrPush(
  cwd: string,
  options: { message?: string; commit: boolean; push: boolean; includeUnstaged?: boolean },
): Promise<GitCommitResult> {
  const outputs: string[] = [];
  let committed = false;
  let commitHash: string | undefined;

  if (options.commit) {
    if (options.includeUnstaged) await stageAll(cwd);
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
  const worktreeBranches = await listWorktreeBranches(cwd);
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
    const worktreePath = worktreeBranches.get(name);
    local.push({
      name,
      current: isCurrent,
      remote: false,
      ...(upstream ? { upstream } : {}),
      ...(worktreePath && !isCurrent ? { worktreePath } : {}),
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

async function listWorktreeBranches(cwd: string): Promise<Map<string, string>> {
  const output = await gitSafe(cwd, ["worktree", "list", "--porcelain"]);
  const branches = new Map<string, string>();
  let worktreePath: string | undefined;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      worktreePath = line.slice("worktree ".length);
    } else if (line.startsWith("branch refs/heads/") && worktreePath) {
      branches.set(line.slice("branch refs/heads/".length), worktreePath);
    } else if (!line) {
      worktreePath = undefined;
    }
  }
  return branches;
}

async function linkedWorktreeForBranch(cwd: string, branch: string): Promise<string | undefined> {
  const worktreePath = (await listWorktreeBranches(cwd)).get(branch);
  const repo = resolveRepo(cwd);
  if (!worktreePath || !repo || resolve(worktreePath) === resolve(repo.root)) {
    return undefined;
  }
  return worktreePath;
}

/**
 * Switch to a branch. `remote` distinguishes a remote-tracking ref
 * ("origin/feature") from a local head — local branch names may themselves
 * contain "/", so we can't infer it from the string. For a remote ref we switch
 * to (or create + track) the matching local branch instead of detaching HEAD.
 * Git refuses (and we surface the error) when uncommitted changes would be lost.
 */
export async function checkoutBranch(
  cwd: string,
  name: string,
  remote = false,
): Promise<GitActionResult> {
  const target = name.trim();
  if (!target) {
    throw new Error("Branch name is required.");
  }
  if (!remote) {
    const worktreePath = await linkedWorktreeForBranch(cwd, target);
    if (worktreePath) {
      return {
        kind: "worktree",
        branch: target,
        worktreePath,
        output: `Branch "${target}" is checked out in a linked worktree: ${worktreePath}`,
      };
    }
    return { kind: "ok", output: await git(cwd, ["switch", target]) };
  }
  const localName = target.includes("/") ? target.slice(target.indexOf("/") + 1) : target;
  if (await branchExistsLocally(cwd, localName)) {
    const worktreePath = await linkedWorktreeForBranch(cwd, localName);
    if (worktreePath) {
      return {
        kind: "worktree",
        branch: localName,
        worktreePath,
        output: `Branch "${localName}" is checked out in a linked worktree: ${worktreePath}`,
      };
    }
    return { kind: "ok", output: await git(cwd, ["switch", localName]) };
  }
  return { kind: "ok", output: await git(cwd, ["switch", "--track", target]) };
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
  if (await mergeHead(parentCwd)) {
    throw new Error("Commit or abort the pending worktree apply before applying another worktree.");
  }
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

export async function abortSubagentWorktreeApply(
  parentCwd: string,
  worktree: SubagentWorktreeInfo,
): Promise<SubagentWorktreeInfo> {
  if (!(await mergeHead(parentCwd))) {
    throw new Error("No pending worktree apply to abort.");
  }
  if (!(await mergeHeadBelongsToWorktree(parentCwd, worktree))) {
    throw new Error("The pending merge does not belong to this subagent worktree.");
  }
  await git(parentCwd, ["merge", "--abort"]);
  const { conflictFiles: _conflictFiles, ...rest } = worktree;
  return { ...rest, integrationStatus: "ready" };
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
  if (await mergeHeadBelongsToWorktree(repo.root, worktree)) {
    throw new Error("Commit or abort the pending worktree apply before cleanup.");
  }
  await git(repo.root, ["worktree", "remove", "--force", worktree.path]);
  await gitSafe(repo.root, ["branch", "-D", worktree.branch]);
  await rm(worktree.path, { recursive: true, force: true }).catch(() => undefined);
  return { ...worktree, integrationStatus: "cleaned" };
}

async function mergeHead(cwd: string): Promise<string | undefined> {
  return (await gitSafe(cwd, ["rev-parse", "--verify", "MERGE_HEAD"])) || undefined;
}

async function mergeHeadBelongsToWorktree(
  cwd: string,
  worktree: SubagentWorktreeInfo,
): Promise<boolean> {
  const head = await mergeHead(cwd);
  if (!head) return false;
  return head === (await gitSafe(cwd, ["rev-parse", "--verify", `${worktree.branch}^{commit}`]));
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
