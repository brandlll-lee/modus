import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type { DiffMode, FileChange, FileDiff, WorktreeInfo } from "../../shared/contracts";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 20,
  });

  return stdout;
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
