import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CodeGraphRunner,
  resolveFastCodebaseBinary,
  runFastCodebase,
} from "./fast-codebase-service";

describe("Fast Codebase service", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the configured CodeGraph binary when provided", () => {
    vi.stubEnv("MODUS_CODEGRAPH_BIN", "C:\\Tools\\codegraph.exe");
    expect(resolveFastCodebaseBinary()).toBe("C:\\Tools\\codegraph.exe");
  });

  it("indexes before querying when .codegraph is missing", async () => {
    const root = tempGitRoot();
    const calls: string[][] = [];
    const runner: CodeGraphRunner = async (args) => {
      calls.push(args);
      return ok(args[0] === "query" ? '[{"node":{"filePath":"src/run.ts","startLine":7}}]' : "ok");
    };

    const result = await runFastCodebase({ cwd: root, query: "run", runner });

    expect(calls).toEqual([
      ["init", root, "--verbose"],
      ["query", "-p", root, "-l", "8", "--json", "run"],
    ]);
    expect(result.details.indexDir).toBe(join(root, ".codegraph"));
    expect(result.details.indexed).toBe(true);
    expect(result.text).toContain("Index: created");
    expect(result.text).toContain("src/run.ts");
  });

  it("shares one index process for concurrent calls to the same workspace", async () => {
    const root = tempGitRoot();
    let releaseIndex!: () => void;
    const indexReady = new Promise<void>((resolve) => {
      releaseIndex = resolve;
    });
    let indexStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      indexStarted = resolve;
    });
    const calls: string[][] = [];
    const runner: CodeGraphRunner = async (args) => {
      calls.push(args);
      if (args[0] === "init") {
        indexStarted();
        await indexReady;
      }
      return ok("[]");
    };

    const first = runFastCodebase({ cwd: root, query: "one", runner });
    const second = runFastCodebase({ cwd: root, query: "two", runner });
    await started;

    expect(calls.filter(([command]) => command === "init")).toHaveLength(1);
    releaseIndex();
    await Promise.all([first, second]);
    expect(calls.filter(([command]) => command === "query")).toHaveLength(2);
  });

  it("aborts the shared index when the only waiter cancels", async () => {
    const root = tempGitRoot();
    const controller = new AbortController();
    let sharedSignal: AbortSignal | undefined;
    let indexStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      indexStarted = resolve;
    });
    const runner: CodeGraphRunner = async (args, options) => {
      if (args[0] !== "init") {
        return ok("[]");
      }
      sharedSignal = options.signal;
      indexStarted();
      return new Promise((_, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("index aborted")), {
          once: true,
        });
      });
    };

    const result = runFastCodebase({
      cwd: root,
      query: "tools",
      runner,
      signal: controller.signal,
    });
    await started;
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(sharedSignal?.aborted).toBe(true);
  });

  it("returns child git workspace candidates without indexing unsafe cwd", async () => {
    const root = mkdtempSync(join(tmpdir(), "modus-fast-codebase-"));
    const child = join(root, "repo");
    mkdirSync(child);
    initGitRoot(child);
    const runner: CodeGraphRunner = async () => {
      throw new Error("CodeGraph should not start");
    };

    const result = await runFastCodebase({ cwd: root, query: "tools", runner });

    expect(result.details.indexed).toBe(false);
    expect(result.details.candidateWorkspaces).toEqual([child]);
    expect(result.text).toContain("Index: skipped");
    expect(result.text).toContain("workspace_path");
  });

  it("indexes an explicit child git workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "modus-fast-codebase-"));
    const child = join(root, "repo");
    mkdirSync(child);
    initGitRoot(child);
    const calls: string[][] = [];
    const runner: CodeGraphRunner = async (args) => {
      calls.push(args);
      return ok(args[0] === "query" ? "[]" : "ok");
    };

    const result = await runFastCodebase({
      cwd: root,
      query: "tools",
      runner,
      workspacePath: child,
    });

    expect(calls[0]).toEqual(["init", child, "--verbose"]);
    expect(result.details.workspace).toBe(child);
  });

  it("does not index workspace_path outside the current workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "modus-fast-codebase-"));
    const outside = tempGitRoot();
    const runner: CodeGraphRunner = async () => {
      throw new Error("CodeGraph should not start");
    };

    const result = await runFastCodebase({
      cwd: root,
      query: "tools",
      runner,
      workspacePath: outside,
    });

    expect(result.details.indexed).toBe(false);
    expect(result.text).toContain("outside the current workspace");
  });

  it("queries an existing clean index without syncing", async () => {
    const root = tempGitRoot();
    writeIndex(root);
    const calls: string[][] = [];
    const runner: CodeGraphRunner = async (args) => {
      calls.push(args);
      if (args[0] === "status") {
        return ok(statusJson());
      }
      return ok("[]");
    };

    const result = await runFastCodebase({ cwd: root, query: "overview", runner });

    expect(calls).toEqual([
      ["status", root, "--json"],
      ["query", "-p", root, "-l", "8", "--json", "overview"],
    ]);
    expect(result.text).toContain("Index: ready");
  });

  it("does not sync only because CodeGraph recommends a future reindex", async () => {
    const root = tempGitRoot();
    writeIndex(root);
    const calls: string[][] = [];
    const runner: CodeGraphRunner = async (args) => {
      calls.push(args);
      if (args[0] === "status") {
        return ok(statusJson({}, true));
      }
      return ok("[]");
    };

    await runFastCodebase({ cwd: root, query: "overview", runner });

    expect(calls.map(([command]) => command)).toEqual(["status", "query"]);
  });

  it("syncs an existing index when CodeGraph reports pending changes", async () => {
    const root = tempGitRoot();
    writeIndex(root);
    const calls: string[][] = [];
    const runner: CodeGraphRunner = async (args) => {
      calls.push(args);
      if (args[0] === "status") {
        return ok(statusJson({ modified: 1 }));
      }
      return ok("[]");
    };

    const result = await runFastCodebase({ cwd: root, query: "overview", runner });

    expect(calls).toEqual([
      ["status", root, "--json"],
      ["sync", root],
      ["query", "-p", root, "-l", "8", "--json", "overview"],
    ]);
    expect(result.text).toContain("Index: synced");
  });

  it("uses explore only when source snippets are requested", async () => {
    const root = tempGitRoot();
    const calls: string[][] = [];
    const runner: CodeGraphRunner = async (args) => {
      calls.push(args);
      return ok("source");
    };

    await runFastCodebase({ cwd: root, includeCode: true, limit: 30, query: "run", runner });

    expect(calls).toEqual([
      ["init", root, "--verbose"],
      ["explore", "-p", root, "--max-files", "12", "run"],
    ]);
  });

  it("summarizes stderr when queries fail", async () => {
    const root = tempGitRoot();
    writeIndex(root);
    const runner: CodeGraphRunner = async (args) =>
      args[0] === "status"
        ? ok(statusJson())
        : fail("project failed", "debug line 1\ndebug line 2");

    await expect(runFastCodebase({ cwd: root, query: "run", runner })).rejects.toThrow(
      /stderr:\ndebug line 1\ndebug line 2/,
    );
  });
});

function ok(text: string) {
  return {
    exitCode: 0,
    isError: false,
    stderr: "",
    text,
  };
}

function fail(text: string, stderr: string) {
  return {
    exitCode: 1,
    isError: true,
    stderr,
    text,
  };
}

function initGitRoot(path: string): void {
  execFileSync("git", ["init"], { cwd: path, stdio: "ignore" });
}

function tempGitRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "modus-fast-codebase-"));
  initGitRoot(root);
  return root;
}

function writeIndex(root: string): void {
  mkdirSync(join(root, ".codegraph"), { recursive: true });
  writeFileSync(join(root, ".codegraph", "codegraph.db"), "");
}

function statusJson(
  pending: { added?: number; modified?: number; removed?: number } = {},
  reindexRecommended = false,
): string {
  return JSON.stringify({
    index: { reindexRecommended },
    pendingChanges: {
      added: pending.added ?? 0,
      modified: pending.modified ?? 0,
      removed: pending.removed ?? 0,
    },
    worktreeMismatch: null,
  });
}
