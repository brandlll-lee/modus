import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { FileChange, FileDiff, WorktreeInfo } from "../../shared/contracts";

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
  const output = await git(cwd, ["status", "--porcelain=v1"]);

  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2).trim(),
      path: line.slice(3),
    }));
}

export async function readDiff(cwd: string, filePath?: string): Promise<FileDiff> {
  const args = filePath ? ["diff", "--", filePath] : ["diff"];
  const diff = await git(cwd, args);

  return {
    path: filePath ?? ".",
    diff,
  };
}

export async function revertFile(cwd: string, filePath: string): Promise<void> {
  await git(cwd, ["restore", "--source=HEAD", "--", filePath]);
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
  const normalizedTaskId = taskId.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = join(cwd, ".modus", "worktrees", normalizedTaskId);
  const branch = `modus/${normalizedTaskId}`;

  await git(cwd, ["worktree", "add", "-b", branch, path]);

  return {
    path,
    branch,
    head: "",
  };
}

export async function deleteWorktree(cwd: string, worktreePath: string): Promise<void> {
  await git(cwd, ["worktree", "remove", worktreePath]);
}
