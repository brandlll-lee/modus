import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const command = vi.hoisted(() => ({ error: undefined as Error | undefined, remove: true }));
vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (_name: string, args: string[], _options: unknown, callback: (error?: Error) => void) => {
      const file = args.at(-1);
      if (!file) throw new Error("Missing session path");
      if (command.remove) unlinkSync(file);
      callback(command.error);
    },
  ),
}));

import { execFile } from "node:child_process";
import { deleteSessionFile } from "./session-file";

let root: string;
let file: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "modus-delete-"));
  file = join(root, "session.jsonl");
  writeFileSync(file, "native history");
  command.error = undefined;
  command.remove = true;
  vi.clearAllMocks();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("uses trash and reports the native deletion method", async () => {
  expect(await deleteSessionFile(file)).toEqual({ method: "trash" });
  expect(execFile).toHaveBeenCalledWith(
    "trash",
    [file],
    { windowsHide: true },
    expect.any(Function),
  );
  expect(existsSync(file)).toBe(false);
});
it("falls back to permanent deletion when trash cannot run", async () => {
  command.error = new Error("command unavailable");
  command.remove = false;
  expect(await deleteSessionFile(file)).toEqual({ method: "unlink" });
  expect(existsSync(file)).toBe(false);
});
it("accepts a completed trash move when the command reports an error", async () => {
  command.error = new Error("command failed after moving the file");
  expect(await deleteSessionFile(file)).toEqual({ method: "trash" });
});
it("reports deletion failure with both causes and keeps the target", async () => {
  command.error = new Error("trash unavailable");
  command.remove = false;
  const target = join(root, "directory");
  mkdirSync(target);
  await expect(deleteSessionFile(target)).rejects.toThrow("Trash: Error: trash unavailable");
  expect(existsSync(target)).toBe(true);
});
