import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveContext } from "./context-service";

const execFileAsync = promisify(execFile);
let repo: string;

async function git(args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: repo, windowsHide: true });
}

beforeEach(async () => {
  repo = await mkdtemp(join(process.cwd(), "modus-context-test-"));
  await git(["init"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "user.name", "Modus Test"]);
  await writeFile(join(repo, "tracked.txt"), "base\n");
  await writeFile(join(repo, "AGENTS.md"), "Follow project rules.\n");
  await git(["add", "."]);
  await git(["commit", "-m", "initial"]);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("context-service", () => {
  it("ignores file context outside cwd", async () => {
    const outside = join(process.cwd(), "outside.txt");
    const resolved = await resolveContext(repo, [{ type: "file", path: outside }]);

    expect(resolved).toEqual([]);
  });

  it("resolves project rules", async () => {
    const resolved = await resolveContext(repo, [{ type: "rules" }]);

    expect(resolved[0]?.content).toContain("Follow project rules");
  });

  it("resolves recent changes with status and diff stat", async () => {
    await writeFile(join(repo, "tracked.txt"), "changed\n");
    const resolved = await resolveContext(repo, [{ type: "recent-changes", limit: 5 }]);

    expect(resolved[0]?.content).toContain("Status");
    expect(resolved[0]?.content).toContain("Diff stat");
  });
});
