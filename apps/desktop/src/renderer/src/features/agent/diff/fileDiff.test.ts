import { generateDiffString } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { fileDiff, toolTargetPath } from "./fileDiff";

it("renders native line numbers, blank changed lines, and context gaps", () => {
  const lines = Array.from({ length: 35 }, (_, index) => `line ${index + 1}`);
  const changed = [...lines];
  changed[16] = "";
  const native = generateDiffString(lines.join("\n"), changed.join("\n"));
  const diff = fileDiff(native);
  expect(diff).toMatchObject({ added: 1, removed: 1 });
  expect(diff?.lines).toContainEqual({ kind: "add", newLine: 17, text: "" });
  expect(diff?.lines).toContainEqual({ kind: "del", oldLine: 17, text: "line 17" });
  expect(diff?.lines.some((line) => line.kind === "gap")).toBe(true);
});

it("counts the complete native result while bounding displayed rows", () => {
  const native = generateDiffString(
    "old",
    Array.from({ length: 800 }, (_, i) => `new ${i}`).join("\n"),
  );
  expect(fileDiff(native)).toMatchObject({ added: 800, removed: 1, hiddenLineCount: 201 });
  expect(fileDiff(native)?.lines).toHaveLength(600);
});

it("waits for native diff data and an actual path", () => {
  for (const details of [undefined, {}, { diff: "" }, { patch: "patch only" }]) {
    expect(fileDiff(details)).toBeUndefined();
  }
  expect(toolTargetPath({ content: "body before path" })).toBeUndefined();
  expect(toolTargetPath({ path: "C:/work/example.ts" })).toBe("C:/work/example.ts");
});
