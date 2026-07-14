import { describe, expect, it } from "vitest";
import { pruneExpandedKeys, pruneRecordKeys, toggleKey } from "./DiffPanel";
import { previewRequestKey } from "./FileDiffPreview";

describe("toggleKey", () => {
  it("keeps existing expanded file diffs open when another file opens", () => {
    expect([...toggleKey(new Set(["a.ts"]), "b.ts")]).toEqual(["a.ts", "b.ts"]);
  });

  it("collapses only the toggled file", () => {
    expect([...toggleKey(new Set(["a.ts", "b.ts"]), "a.ts")]).toEqual(["b.ts"]);
  });
});

describe("pruneExpandedKeys", () => {
  it("removes expanded rows that no longer exist in the current diff snapshot", () => {
    expect([...pruneExpandedKeys(new Set(["a.ts", "stale.ts"]), ["a.ts", "b.ts"])]).toEqual([
      "a.ts",
    ]);
  });
});

describe("pruneRecordKeys", () => {
  it("keeps cached commit files that still exist in the current commit log", () => {
    expect(pruneRecordKeys({ keep: ["a.ts"], stale: ["b.ts"] }, ["keep", "next"])).toEqual({
      keep: ["a.ts"],
    });
  });
});

describe("previewRequestKey", () => {
  it("stays stable across content refreshes for the same file preview", () => {
    const input = {
      cwd: "repo",
      path: "src/app.ts",
      target: { type: "unstaged" } as const,
      untracked: false,
      ignoreWhitespace: false,
    };

    expect(previewRequestKey(input)).toBe(previewRequestKey({ ...input }));
  });

  it("changes only when the preview identity changes", () => {
    const input = {
      cwd: "repo",
      path: "src/app.ts",
      target: { type: "unstaged" } as const,
      untracked: false,
      ignoreWhitespace: false,
    };

    expect(previewRequestKey({ ...input, path: "src/other.ts" })).not.toBe(
      previewRequestKey(input),
    );
    expect(previewRequestKey({ ...input, target: { type: "staged" } })).not.toBe(
      previewRequestKey(input),
    );
    expect(previewRequestKey({ ...input, ignoreWhitespace: true })).not.toBe(
      previewRequestKey(input),
    );
  });
});
