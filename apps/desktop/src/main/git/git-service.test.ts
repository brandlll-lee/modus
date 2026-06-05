import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  commitChanges,
  discardFile,
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
});
