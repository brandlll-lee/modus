/**
 * Workspace file access for the renderer's file panel.
 *
 * List/read are lazy (one directory level, one file on open). Write is the
 * symmetric counterpart for in-panel edits. Paths are confined to the workspace
 * root — escape via `..` or an absolute elsewhere is rejected (authoritative
 * containment, not a name blacklist).
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { FileEntry, FileReadResult, FileWriteResult } from "../../shared/contracts";
import { resolveWithin } from "./path-within";

/** Max bytes returned for a single file read; larger files are flagged + capped. */
const MAX_READ_BYTES = 2 * 1024 * 1024;

/**
 * List the immediate children of `dir` (defaults to the workspace root).
 * Directories first, then files, each alphabetical (case-insensitive) — the
 * conventional explorer ordering. Unreadable entries are skipped, not fatal.
 */
export function listDirectory(root: string, dir?: string): FileEntry[] {
  const abs = dir ? resolveWithin(root, dir) : resolve(root);
  const entries: FileEntry[] = [];
  for (const dirent of readdirSync(abs, { withFileTypes: true })) {
    const childAbs = join(abs, dirent.name);
    const isDir = dirent.isDirectory();
    // Resolve symlinks defensively; a broken link is simply omitted.
    if (!isDir && !dirent.isFile() && !dirent.isSymbolicLink()) {
      continue;
    }
    let kind: FileEntry["kind"] = isDir ? "directory" : "file";
    if (dirent.isSymbolicLink()) {
      try {
        kind = statSync(childAbs).isDirectory() ? "directory" : "file";
      } catch {
        continue;
      }
    }
    entries.push({
      name: dirent.name,
      path: childAbs,
      relativePath: relative(resolve(root), childAbs).split(sep).join("/"),
      kind,
    });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "accent" });
  });
  return entries;
}

const BINARY_SNIFF_BYTES = 8000;

/** Heuristic: a NUL byte in the head means binary (matches git's own check). */
function looksBinary(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < limit; i += 1) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

/** Read a workspace file as UTF-8 text, flagging binary and over-cap files. */
export function readWorkspaceFile(root: string, path: string): FileReadResult {
  const abs = resolveWithin(root, path);
  const stat = statSync(abs);
  if (stat.isDirectory()) {
    throw new Error("Path is a directory, not a file.");
  }
  const relativePath = relative(resolve(root), abs).split(sep).join("/");
  const base = {
    path: abs,
    relativePath,
    size: stat.size,
  };
  const raw = readFileSync(abs);
  if (looksBinary(raw)) {
    return { ...base, binary: true, truncated: false, content: "" };
  }
  const truncated = raw.length > MAX_READ_BYTES;
  const slice = truncated ? raw.subarray(0, MAX_READ_BYTES) : raw;
  return { ...base, binary: false, truncated, content: slice.toString("utf8") };
}

/**
 * Atomically write UTF-8 text into a workspace file. Refuses directories and
 * existing binary files (NUL-sniff) so a text editor cannot clobber them.
 */
export function writeWorkspaceFile(root: string, path: string, content: string): FileWriteResult {
  const abs = resolveWithin(root, path);
  if (existsSync(abs)) {
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      throw new Error("Path is a directory, not a file.");
    }
    if (looksBinary(readFileSync(abs))) {
      throw new Error("Refusing to overwrite a binary file.");
    }
  }
  const temporaryPath = `${abs}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporaryPath, content, "utf8");
    renameSync(temporaryPath, abs);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  const size = Buffer.byteLength(content, "utf8");
  return {
    path: abs,
    relativePath: relative(resolve(root), abs).split(sep).join("/"),
    size,
  };
}
