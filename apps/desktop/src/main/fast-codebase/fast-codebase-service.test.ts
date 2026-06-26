import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
      return ok(tool, {
        entry_points: [
          ...Array.from({ length: 10 }, (_, i) => ({
            name: `built-${i}`,
            file: `out/src/built-${i}.js`,
          })),
          { name: "main", file: "src/main.ts" },
        ],
        hotspots: Array.from({ length: 10 }, (_, i) => ({
          name: `hot-${i}`,
          file: `src/hot-${i}.ts`,
        })),
        languages: [{ language: "TypeScript", file_count: 3 }],
      });
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
    expect(result.text).toContain('"suggested_reads"');
    expect(result.text).toContain("src/main.ts");
    expect(result.text).not.toContain("out/src/built-0.js");
    expect(result.text).not.toContain("hot-9");
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

  it("prunes cached index rows outside git tracked files", async () => {
    const root = mkdtempSync(join(tmpdir(), "modus-fast-codebase-"));
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "out", "src"), { recursive: true });
    mkdirSync(join(root, "out-verify", "src"), { recursive: true });
    mkdirSync(join(root, ".modus", "worktrees"), { recursive: true });
    writeFileSync(join(root, "src", "main.ts"), "export const main = true;");
    writeFileSync(join(root, "out", "src", "main.js"), "export const main = true;");
    writeFileSync(join(root, "out-verify", "src", "only-built.js"), "export const built = true;");
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { outDir: "out" } }),
    );
    writeFileSync(join(root, "generated.ts"), "export const generated = true;");
    writeFileSync(join(root, ".modus", "worktrees", "scratch.ts"), "export const scratch = true;");
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync(
      "git",
      ["add", "src/main.ts", "out/src/main.js", "out-verify/src/only-built.js", "tsconfig.json"],
      {
        cwd: root,
        stdio: "ignore",
      },
    );
    const cacheDir = join(root, "cache");
    mkdirSync(cacheDir, { recursive: true });
    const dbPath = join(cacheDir, `${projectNameFromPath(root)}.db`);
    writeIndexDb(dbPath, projectNameFromPath(root));
    const runner: CbmRunner = async (tool) =>
      ok(tool, { entry_points: [{ name: "main", file: "src/main.ts" }] });

    await runFastCodebase({ cacheDir, cwd: root, query: "architecture overview", runner });

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      expect(
        db.prepare("select file_path from nodes where file_path <> '' order by file_path").all(),
      ).toEqual([{ file_path: "src/main.ts" }]);
      expect(db.prepare("select rel_path from file_hashes order by rel_path").all()).toEqual([
        { rel_path: "src/main.ts" },
      ]);
      expect(db.prepare("select count(*) as count from edges").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
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

function writeIndexDb(dbPath: string, project: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      create table projects (name text primary key, indexed_at text not null, root_path text not null);
      create table nodes (
        id integer primary key autoincrement,
        project text not null,
        label text not null,
        name text not null,
        qualified_name text not null,
        file_path text default '',
        start_line integer default 0,
        end_line integer default 0,
        properties text default '{}',
        unique(project, qualified_name)
      );
      create table edges (
        id integer primary key autoincrement,
        project text not null,
        source_id integer not null,
        target_id integer not null,
        type text not null,
        properties text default '{}'
      );
      create table file_hashes (
        project text not null,
        rel_path text not null,
        sha256 text not null,
        mtime_ns integer not null default 0,
        size integer not null default 0,
        primary key(project, rel_path)
      );
      insert into projects(name, indexed_at, root_path) values ('${project}', 'now', 'root');
      insert into nodes(project, label, name, qualified_name, file_path) values
        ('${project}', 'Project', 'demo', '${project}', ''),
        ('${project}', 'Function', 'main', '${project}.main', 'src/main.ts'),
        ('${project}', 'Function', 'mainBuilt', '${project}.mainBuilt', 'out/src/main.js'),
        ('${project}', 'Function', 'onlyBuilt', '${project}.onlyBuilt', 'out-verify/src/only-built.js'),
        ('${project}', 'Function', 'generated', '${project}.generated', 'generated.ts'),
        ('${project}', 'Function', 'scratch', '${project}.scratch', '.modus/worktrees/scratch.ts');
      insert into edges(project, source_id, target_id, type) values ('${project}', 2, 5, 'CALLS');
      insert into file_hashes(project, rel_path, sha256) values
        ('${project}', 'src/main.ts', '1'),
        ('${project}', 'out/src/main.js', '2'),
        ('${project}', 'out-verify/src/only-built.js', '3'),
        ('${project}', 'generated.ts', '4'),
        ('${project}', '.modus/worktrees/scratch.ts', '5');
    `);
  } finally {
    db.close();
  }
}
