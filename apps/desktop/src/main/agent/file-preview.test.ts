import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEditTool,
  createWriteTool,
  generateDiffString,
} from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { fileDiff } from "../../renderer/src/features/agent/diff/fileDiff";
import { previewEdits } from "./file-preview";
import { toolResultContent } from "./pi-tool-result";

it("previews PI replacement inputs while other fields are still missing", () => {
  expect(previewEdits({ edits: [{ oldText: "old" }] })).toEqual([]);
  expect(previewEdits({ content: "streaming write" })).toEqual([]);
  const replacement = { oldText: "old\n", newText: "new\nnext\n" };
  const expected = [generateDiffString(replacement.oldText, replacement.newText).diff];
  for (const input of [
    { edits: [replacement] },
    { edits: replacement },
    { edits: JSON.stringify([replacement]) },
    replacement,
  ])
    expect(previewEdits(input)).toEqual(expected);
});

it("preserves the native executed diff and distinguishes it from a replacement preview", async () => {
  const root = mkdtempSync(join(tmpdir(), "modus-edit-preview-"));
  try {
    const path = join(root, "example.ts");
    writeFileSync(path, "header\n  old  \nfooter\n");
    const args = { path, edits: [{ oldText: "old", newText: "new\nnext" }] };
    const preview = previewEdits(args);
    expect(readFileSync(path, "utf8")).toBe("header\n  old  \nfooter\n");
    const result = await createEditTool(root).execute("edit", args);
    const projected = toolResultContent(result);
    expect(projected.details).toEqual(result.details);
    const details = projected.details as { diff: string; patch: string; firstChangedLine: number };
    expect(details.diff).not.toEqual(preview[0]);
    expect(details.firstChangedLine).toBe(2);
    expect(details.patch).toContain("@@");
    expect(fileDiff(details)).toMatchObject({ added: 2, removed: 1 });
    expect(fileDiff(details)?.lines).toContainEqual({ kind: "add", newLine: 2, text: "  new" });

    const write = await createWriteTool(root).execute("write", { path, content: "replacement\n" });
    expect(readFileSync(path, "utf8")).toBe("replacement\n");
    expect(fileDiff(toolResultContent(write).details)).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
