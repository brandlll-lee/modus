import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listDirectory, readWorkspaceFile, writeWorkspaceFile } from "./files-service";

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

describe("writeWorkspaceFile", () => {
  it("writes text and returns the new size", () => {
    const next = "export const x = 2;\n";
    const result = writeWorkspaceFile(root, join(root, "src", "app.ts"), next);
    expect(result.relativePath).toBe("src/app.ts");
    expect(result.size).toBe(Buffer.byteLength(next, "utf8"));
    expect(readFileSync(join(root, "src", "app.ts"), "utf8")).toBe(next);
  });

  it("creates a new text file inside the workspace", () => {
    const next = "hello\n";
    const result = writeWorkspaceFile(root, join(root, "src", "new.ts"), next);
    expect(result.relativePath).toBe("src/new.ts");
    expect(readFileSync(join(root, "src", "new.ts"), "utf8")).toBe(next);
  });

  it("rejects writing a directory path", () => {
    expect(() => writeWorkspaceFile(root, join(root, "src"), "nope")).toThrow(/directory/);
  });

  it("rejects overwriting a binary file", () => {
    expect(() => writeWorkspaceFile(root, join(root, "bin.dat"), "text")).toThrow(/binary/);
  });
});

describe("workspace containment (authoritative safety check)", () => {
  it("rejects paths that escape the workspace root", () => {
    expect(() => readWorkspaceFile(root, join(root, "..", "secret.txt"))).toThrow(/outside/);
    expect(() => listDirectory(root, join(root, "..", ".."))).toThrow(/outside/);
    expect(() => writeWorkspaceFile(root, join(root, "..", "secret.txt"), "x")).toThrow(/outside/);
  });
});
