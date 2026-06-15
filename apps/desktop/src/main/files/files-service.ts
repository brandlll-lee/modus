/**
 * Read-only workspace file access for the renderer's file panel.
 *
 * Two operations, both lazy by design (the panel lists one directory level at a
 * time and reads a file only when opened), so a huge repo never forces a full
 * tree walk or bulk read. Paths are confined to the workspace root — a request
 * that escapes it (via `..` or an absolute elsewhere) is rejected, which is the
 * authoritative containment check rather than blacklisting names.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FileEntry, FileReadResult } from "../../shared/contracts";

/** Max bytes returned for a single file read; larger files are flagged + capped. */
const MAX_READ_BYTES = 2 * 1024 * 1024;

/** Resolve `target` against `root`, or throw if it escapes the workspace root. */
function resolveWithin(root: string, target: string): string {
  const rootResolved = resolve(root);
  const abs = isAbsolute(target) ? resolve(target) : resolve(rootResolved, target);
  const rel = relative(rootResolved, abs);
  if (rel === "") {
    return abs;
  }
  if (rel.startsWith("..") || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("Refusing to access a path outside the workspace.");
  }
  return abs;
}

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
