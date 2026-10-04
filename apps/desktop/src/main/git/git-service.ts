import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { GitActionResult, GitBranch, GitBranchSummary } from "../../shared/contracts";
import { resolveRepo } from "./git-repo";
import { runGit, runGitSafe } from "./git-runner";

const git = runGit;
const gitSafe = runGitSafe;

export async function isGitRepository(rootPath: string): Promise<boolean> {
  return (
    existsSync(rootPath) &&
    (await gitSafe(rootPath, ["rev-parse", "--is-inside-work-tree"])) === "true"
  );
}

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
