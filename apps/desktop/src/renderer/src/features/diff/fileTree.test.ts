import { describe, expect, it } from "vitest";
import type { FileChange } from "../../../../shared/contracts";
import { buildChangeTree, type ChangeTreeNode, flattenChangeTree } from "./fileTree";

function file(path: string): FileChange {
  return { path, status: "M", staged: false, unstaged: true, untracked: false };
}

/** Pull a node's display shape for terse assertions. */
function shape(node: ChangeTreeNode): unknown {
  return node.kind === "file"
    ? node.change.path
    : { dir: node.name, children: node.children.map(shape) };
}

describe("buildChangeTree", () => {
  it("nests files under their directories, dirs before files", () => {
    const tree = buildChangeTree([file("src/a.ts"), file("README.md"), file("src/b.ts")]);
    expect(tree.map(shape)).toEqual([
      { dir: "src", children: ["src/a.ts", "src/b.ts"] },
      "README.md",
    ]);
  });

  it("compacts single-child folder chains like VS Code", () => {
    const tree = buildChangeTree([file("a/b/c/deep.ts")]);
    expect(tree.map(shape)).toEqual([{ dir: "a/b/c", children: ["a/b/c/deep.ts"] }]);
  });

  it("stops compacting where a folder branches", () => {
    const tree = buildChangeTree([file("a/b/one.ts"), file("a/c/two.ts")]);
    expect(tree.map(shape)).toEqual([
      {
        dir: "a",
        children: [
          { dir: "b", children: ["a/b/one.ts"] },
          { dir: "c", children: ["a/c/two.ts"] },
        ],
      },
    ]);
  });

  it("normalizes backslash paths for folder grouping (git emits forward slashes)", () => {
    const tree = buildChangeTree([file("win\\dir\\file.ts")]);
    expect(tree.map(shape)).toEqual([{ dir: "win/dir", children: ["win\\dir\\file.ts"] }]);
  });

  it("flattens only expanded folders for viewport rendering", () => {
    const tree = buildChangeTree([file("src/a.ts"), file("tests/a.test.ts")]);
    expect(flattenChangeTree(tree, new Set(["src"]))).toMatchObject([
      { kind: "dir", path: "src", depth: 0 },
      { kind: "dir", path: "tests", depth: 0 },
      { kind: "file", change: { path: "tests/a.test.ts" }, depth: 1 },
    ]);
  });
});
