import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";
import type { SessionDeletionResult } from "../../shared/contracts";

const execute = promisify(execFile);

export async function deleteSessionFile(path: string): Promise<SessionDeletionResult> {
  let trashError: unknown;
  try {
    await execute("trash", path.startsWith("-") ? ["--", path] : [path], { windowsHide: true });
    return { method: "trash" };
  } catch (error) {
    if (!existsSync(path)) return { method: "trash" };
    trashError = error;
  }
  try {
    await unlink(path);
    return { method: "unlink" };
  } catch (error) {
    throw new Error(`Could not delete session: ${String(error)}. Trash: ${String(trashError)}`);
  }
}
