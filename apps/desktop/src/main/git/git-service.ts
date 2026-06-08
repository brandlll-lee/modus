import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type {
  DiffMode,
  FileChange,
  FileDiff,
  GitBranch,
  GitBranchSummary,
  GitCommitResult,
  GitStatusSummary,
  WorktreeInfo,
} from "../../shared/contracts";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
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

export async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  const output = await git(cwd, ["worktree", "list", "--porcelain"]);
  const chunks = output.split("\n\n").filter(Boolean);

  return chunks.map((chunk) => {
    const fields = Object.fromEntries(
      chunk.split("\n").map((line) => {
        const [key, ...rest] = line.split(" ");
        return [key, rest.join(" ")];
      }),
    );

    return {
      path: fields.worktree ?? "",
      head: fields.HEAD ?? "",
      branch: fields.branch ?? "detached",
    };
  });
}

export async function createWorktree(cwd: string, taskId: string): Promise<WorktreeInfo> {
  const baseTaskId = taskId.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || "task";
  let lastError: unknown;

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const normalizedTaskId = attempt === 1 ? baseTaskId : `${baseTaskId}-${attempt}`;
    const path = join(cwd, ".modus", "worktrees", normalizedTaskId);
    const branch = `modus/${normalizedTaskId}`;

    if (existsSync(path)) {
      lastError = new Error(`Worktree path already exists: ${path}`);
      continue;
    }

    try {
      await git(cwd, ["rev-parse", "--verify", branch]);
      lastError = new Error(`Worktree branch already exists: ${branch}`);
      continue;
    } catch {
      // Branch does not exist; safe to try this suffix.
    }

    try {
      await mkdir(dirname(path), { recursive: true });
      await git(cwd, ["worktree", "add", "-b", branch, path]);
      const head = (await git(path, ["rev-parse", "HEAD"])).trim();
      return {
        path,
        branch,
        head,
      };
    } catch (error) {
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Unable to create an isolated worktree after 10 attempts. ${message}`);
}

export async function deleteWorktree(cwd: string, worktreePath: string): Promise<void> {
  await git(cwd, ["worktree", "remove", worktreePath]);
}
