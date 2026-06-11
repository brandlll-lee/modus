import { describe, expect, it } from "vitest";
import {
  computeEditInlineDiff,
  computeWriteInlineDiff,
  inlineDiffFromToolArgs,
  toolTargetPath,
} from "./computeInlineDiff";

describe("computeWriteInlineDiff", () => {
  it("renders every line as an addition with sequential new-line numbers", () => {
    const diff = computeWriteInlineDiff("a\nb\nc\n");
    expect(diff.added).toBe(3);
    expect(diff.removed).toBe(0);
    expect(diff.lines).toEqual([
      { kind: "add", newLine: 1, text: "a" },
      { kind: "add", newLine: 2, text: "b" },
      { kind: "add", newLine: 3, text: "c" },
    ]);
  });

  it("handles empty content as a zero-line diff", () => {
    const diff = computeWriteInlineDiff("");
    expect(diff.added).toBe(0);
    expect(diff.lines).toHaveLength(0);
  });

  it("treats a file without a trailing newline the same as one with it", () => {
    expect(computeWriteInlineDiff("x\ny").added).toBe(2);
    expect(computeWriteInlineDiff("x\ny\n").added).toBe(2);
  });

  it("normalizes CRLF so line endings don't inflate the count", () => {
    const diff = computeWriteInlineDiff("a\r\nb\r\n");
    expect(diff.added).toBe(2);
    expect(diff.lines.map((line) => line.text)).toEqual(["a", "b"]);
  });

  it("caps rendered rows but keeps the true added count", () => {
    const content = `${Array.from({ length: 50 }, (_, index) => `line ${index}`).join("\n")}\n`;
    const diff = computeWriteInlineDiff(content, { maxLines: 10 });
    expect(diff.added).toBe(50);
    expect(diff.lines).toHaveLength(10);
    expect(diff.truncated).toBe(true);
    expect(diff.hiddenLineCount).toBe(40);
  });
});

describe("computeEditInlineDiff", () => {
  it("counts a single-line replacement as one add and one delete", () => {
    const diff = computeEditInlineDiff([{ oldText: "hello world", newText: "hello there" }]);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    const kinds = diff.lines.map((line) => line.kind);
    expect(kinds).toContain("add");
    expect(kinds).toContain("del");
  });

  it("keeps surrounding context lines around a change", () => {
    const old = "1\n2\n3\n4\n5\n6\n7\n8\n9";
    const next = "1\n2\n3\n4\nFIVE\n6\n7\n8\n9";
    const diff = computeEditInlineDiff([{ oldText: old, newText: next }], { context: 2 });
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    const contextLines = diff.lines.filter((line) => line.kind === "context");
    // 2 lines of context on each side of the single changed line.
    expect(contextLines).toHaveLength(4);
  });

  it("sums counts across multiple edit fragments and inserts a gap between them", () => {
    const diff = computeEditInlineDiff([
      { oldText: "alpha", newText: "ALPHA" },
      { oldText: "omega", newText: "OMEGA" },
    ]);
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(2);
    expect(diff.lines.some((line) => line.kind === "gap")).toBe(true);
  });

  it("assigns fragment-relative line numbers from the hunk start", () => {
    const old = "a\nb\nc\nd\ne";
    const next = "a\nb\nCHANGED\nd\ne";
    const diff = computeEditInlineDiff([{ oldText: old, newText: next }], { context: 1 });
    const added = diff.lines.find((line) => line.kind === "add");
    expect(added?.newLine).toBe(3);
  });
});

describe("inlineDiffFromToolArgs", () => {
  it("builds an edit diff from edit-tool args", () => {
    const diff = inlineDiffFromToolArgs("edit", {
      path: "src/foo.ts",
      edits: [{ oldText: "const a = 1;", newText: "const a = 2;" }],
    });
    expect(diff?.added).toBe(1);
    expect(diff?.removed).toBe(1);
  });

  it("builds an all-green diff from write-tool args", () => {
    const diff = inlineDiffFromToolArgs("write", { path: "new.txt", content: "x\ny\n" });
    expect(diff?.added).toBe(2);
    expect(diff?.removed).toBe(0);
  });

  it("returns undefined for non-writer tools", () => {
    expect(inlineDiffFromToolArgs("read", { path: "x" })).toBeUndefined();
    expect(inlineDiffFromToolArgs("bash", { command: "ls" })).toBeUndefined();
  });

  it("returns undefined when edit args carry no usable edits", () => {
    expect(inlineDiffFromToolArgs("edit", { path: "x", edits: [] })).toBeUndefined();
    expect(inlineDiffFromToolArgs("edit", { path: "x" })).toBeUndefined();
  });

  it("returns undefined when write args carry no content string", () => {
    expect(inlineDiffFromToolArgs("write", { path: "x" })).toBeUndefined();
  });

  it("tolerates malformed args without throwing", () => {
    expect(inlineDiffFromToolArgs("edit", null)).toBeUndefined();
    expect(inlineDiffFromToolArgs("edit", "nope")).toBeUndefined();
    expect(
      inlineDiffFromToolArgs("edit", { edits: [{ oldText: "a" }, { newText: "b" }] }),
    ).toBeUndefined();
  });
});

describe("toolTargetPath", () => {
  it("extracts a non-empty path argument", () => {
    expect(toolTargetPath({ path: "src/app.ts" })).toBe("src/app.ts");
  });

  it("returns undefined when path is missing or blank", () => {
    expect(toolTargetPath({ path: "  " })).toBeUndefined();
    expect(toolTargetPath({})).toBeUndefined();
    expect(toolTargetPath(null)).toBeUndefined();
  });
});
