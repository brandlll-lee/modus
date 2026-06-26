import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CbmRunner,
  fastCodebaseBinaryName,
  projectNameFromPath,
  resolveFastCodebaseBinary,
  runFastCodebase,
} from "./fast-codebase-service";

describe("Fast Codebase service", () => {
  it("derives the same safe project key as the sidecar", () => {
    expect(projectNameFromPath("F:\\CodeHub\\my project")).toBe("F-CodeHub-my-project");
  });

  it("uses the dev resource sidecar when running from the desktop workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "modus-fast-codebase-"));
    const cwd = process.cwd();
    const bin = join(root, "resources", "bin", fastCodebaseBinaryName());
    mkdirSync(join(root, "resources", "bin"), { recursive: true });
    writeFileSync(bin, "");
    try {
      process.chdir(root);
      expect(resolveFastCodebaseBinary()).toBe(bin);
    } finally {
      process.chdir(cwd);
    }
  });

  it("indexes before querying when the project db is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "modus-fast-codebase-"));
    const calls: string[] = [];
    const runner: CbmRunner = async (tool) => {
      calls.push(tool);
      if (tool === "index_repository") {
        return ok(tool, { project: "demo", status: "indexed", nodes: 1, edges: 0 });
      }
      return ok(tool, {
        total: 1,
        results: [
          {
            name: "run",
            qualified_name: "demo.src.run",
            label: "Function",
            file_path: "src/run.ts",
            start_line: 7,
          },
        ],
      });
    };

    const result = await runFastCodebase({
      cacheDir: join(root, "cache"),
      cwd: root,
      query: "run",
      runner,
    });

    expect(calls).toEqual(["index_repository", "search_graph"]);
    expect(result.text).toContain("Index: created");
    expect(result.text).toContain('"file_path": "src/run.ts"');
    expect(result.text).toContain('"start_line": 7');
  });

  it("uses the existing db for overview queries", async () => {
    const root = mkdtempSync(join(tmpdir(), "modus-fast-codebase-"));
    const cacheDir = join(root, "cache");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, `${projectNameFromPath(root)}.db`), "");
    const calls: string[] = [];
    const runner: CbmRunner = async (tool) => {
      calls.push(tool);
      return ok(tool, { languages: [{ language: "TypeScript", file_count: 3 }] });
    };

    const result = await runFastCodebase({
      cacheDir,
      cwd: root,
      query: "architecture overview",
      runner,
    });

    expect(calls).toEqual(["get_architecture"]);
    expect(result.text).toContain("Index: cache hit");
    expect(result.text).toContain("snapshot:");
    expect(result.text).toContain("Architecture Overview");
  });

  it("adds architecture context when search returns no results", async () => {
    const root = mkdtempSync(join(tmpdir(), "modus-fast-codebase-"));
    const cacheDir = join(root, "cache");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, `${projectNameFromPath(root)}.db`), "");
    const calls: string[] = [];
    const runner: CbmRunner = async (tool) => {
      calls.push(tool);
      if (tool === "get_architecture") {
        return ok(tool, { languages: [{ language: "TypeScript", file_count: 3 }] });
      }
      return ok(tool, { total: 0, results: [] });
    };

    const result = await runFastCodebase({
      cacheDir,
      cwd: root,
      query: "missing thing",
      runner,
    });

    expect(calls).toEqual(["search_graph", "get_architecture"]);
    expect(result.text).toContain("Architecture Fallback");
  });

  it("fetches snippets only when includeCode is requested", async () => {
    const root = mkdtempSync(join(tmpdir(), "modus-fast-codebase-"));
    const cacheDir = join(root, "cache");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, `${projectNameFromPath(root)}.db`), "");
    const calls: string[] = [];
    const runner: CbmRunner = async (tool) => {
      calls.push(tool);
      if (tool === "get_code_snippet") {
        return ok(tool, {
          qualified_name: "demo.src.run",
          label: "Function",
          file_path: "src/run.ts",
          start_line: 7,
          source: "export function run() {}",
        });
      }
      return ok(tool, {
        total: 1,
        results: [{ name: "run", qualified_name: "demo.src.run", file_path: "src/run.ts" }],
      });
    };

    const result = await runFastCodebase({
      cacheDir,
      cwd: root,
      includeCode: true,
      query: "run",
      runner,
    });

    expect(calls).toEqual(["search_graph", "get_code_snippet"]);
    expect(result.text).toContain("Source Snippets");
    expect(result.text).toContain("export function run() {}");
  });

  it("summarizes stderr when queries fail", async () => {
    const root = mkdtempSync(join(tmpdir(), "modus-fast-codebase-"));
    const cacheDir = join(root, "cache");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, `${projectNameFromPath(root)}.db`), "");
    const runner: CbmRunner = async (tool) =>
      fail(tool, "project failed", "debug line 1\ndebug line 2");

    await expect(
      runFastCodebase({
        cacheDir,
        cwd: root,
        query: "run",
        runner,
      }),
    ).rejects.toThrow(/stderr:\ndebug line 1\ndebug line 2/);
  });
});

function ok(tool: string, json: unknown) {
  return {
    exitCode: 0,
    isError: false,
    json,
    stderr: "",
    text: JSON.stringify(json),
    tool,
  };
}

function fail(tool: string, text: string, stderr: string) {
  return {
    exitCode: 1,
    isError: true,
    stderr,
    text,
    tool,
  };
}
