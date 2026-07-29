/**
 * Workspace path containment — authoritative sandbox for file IPC handlers.
 */

import { isAbsolute, relative, resolve, sep } from "node:path";

/** Resolve `target` against `root`, or throw if it escapes the workspace root. */
export function resolveWithin(root: string, target: string): string {
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
