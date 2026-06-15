import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listDirectory, readWorkspaceFile } from "./files-service";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "modus-files-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "app.ts"), "export const x = 1;\n");
  writeFileSync(join(root, "README.md"), "# Title\n");
  writeFileSync(join(root, "bin.dat"), Buffer.from([1, 2, 0, 3, 4]));
  mkdirSync(join(root, "zeta"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("listDirectory", () => {
  it("lists immediate children, directories first then alphabetical", () => {
    const entries = listDirectory(root);
    expect(entries.map((e) => e.name)).toEqual(["src", "zeta", "bin.dat", "README.md"]);
    expect(entries[0]?.kind).toBe("directory");
    expect(entries.find((e) => e.name === "app.ts")).toBeUndefined(); // not recursive
  });

  it("lists a subdirectory by path", () => {
    const entries = listDirectory(root, join(root, "src"));
    expect(entries.map((e) => e.name)).toEqual(["app.ts"]);
    expect(entries[0]?.relativePath).toBe("src/app.ts");
  });
});

describe("readWorkspaceFile", () => {
  it("reads a text file", () => {
    const result = readWorkspaceFile(root, join(root, "src", "app.ts"));
    expect(result.binary).toBe(false);
    expect(result.content).toContain("export const x");
    expect(result.relativePath).toBe("src/app.ts");
  });

  it("flags a binary file with no content", () => {
    const result = readWorkspaceFile(root, join(root, "bin.dat"));
    expect(result.binary).toBe(true);
    expect(result.content).toBe("");
  });
});

describe("workspace containment (authoritative safety check)", () => {
  it("rejects paths that escape the workspace root", () => {
    expect(() => readWorkspaceFile(root, join(root, "..", "secret.txt"))).toThrow(/outside/);
    expect(() => listDirectory(root, join(root, "..", ".."))).toThrow(/outside/);
  });
});
