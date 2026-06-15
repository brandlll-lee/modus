/**
 * Plan persistence for Plan Mode. A plan is a single markdown artifact — the
 * durable, human- and agent-editable source of truth that survives the chat
 * window (the v1 interface validated by Cursor/Windsurf/Devin) and later feeds
 * single-agent or fusion execution.
 *
 * Storage policy (mirrors Cursor): plans live OUTSIDE the repo by default (under
 * the app's user-data dir, never committed); "save to workspace" copies the
 * active plan into `<repo>/.modus/specs/<slug>/` when the user opts in.
 *
 * This module is pure I/O over an explicit `rootDir`, so it is unit-testable
 * with a real temp directory and no Electron/mocks.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PlanRef } from "../../shared/contracts";

const PLAN_FILE = "plan.md";
const META_FILE = "plan.json";

/** Kebab-case slug from a plan title; stable, filesystem-safe, never empty. */
export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "plan";
}

/** Content fingerprint, so callers can detect tampering / no-op rewrites. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

/** Directory holding a plan's artifacts: `<rootDir>/<workspaceId>/<slug>/`. */
export function planDir(rootDir: string, workspaceId: string, slug: string): string {
  return join(rootDir, sanitizeSegment(workspaceId), slug);
}

/** A path segment safe to use as a folder name. */
function sanitizeSegment(value: string): string {
  const cleaned = value.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "default";
}

type PlanMeta = Omit<PlanRef, "content">;

function readMeta(dir: string): PlanMeta | undefined {
  const metaPath = join(dir, META_FILE);
  if (!existsSync(metaPath)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(metaPath, "utf8")) as PlanMeta;
  } catch {
    return undefined;
  }
}

/**
 * Write (create or update) a plan. A given `slug` always maps to the same file,
 * so repeated calls from one planning session update one artifact rather than
 * forking new ones. Returns the durable reference.
 */
export function writePlan(
  rootDir: string,
  input: {
    workspaceId: string;
    slug: string;
    title: string;
    content: string;
    sessionId?: string;
  },
): PlanRef {
  const dir = planDir(rootDir, input.workspaceId, input.slug);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, PLAN_FILE);
  writeFileSync(path, input.content, "utf8");

  const now = new Date().toISOString();
  const existing = readMeta(dir);
  const meta: PlanMeta = {
    id: existing?.id ?? `${input.workspaceId}:${input.slug}`,
    slug: input.slug,
    title: input.title,
    path,
    hash: hashContent(input.content),
    workspaceId: input.workspaceId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    savedToWorkspace: existing?.savedToWorkspace ?? false,
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
  };
  writeFileSync(join(dir, META_FILE), JSON.stringify(meta, null, 2), "utf8");
  return { ...meta, content: input.content };
}

/** Read a plan's current markdown + reference, or undefined if it is gone. */
export function readPlan(rootDir: string, workspaceId: string, slug: string): PlanRef | undefined {
  const dir = planDir(rootDir, workspaceId, slug);
  const meta = readMeta(dir);
  if (!meta || !existsSync(meta.path)) {
    return undefined;
  }
  return { ...meta, content: readFileSync(meta.path, "utf8") };
}

/**
 * Copy the active plan into the repository at `<repoCwd>/.modus/specs/<slug>/`
 * so it can be committed and shared. Returns the in-repo path. The user opts
 * into this — plans are not version-controlled by default.
 */
export function saveToWorkspace(rootDir: string, plan: PlanRef, repoCwd: string): string {
  const targetDir = join(repoCwd, ".modus", "specs", plan.slug);
  mkdirSync(targetDir, { recursive: true });
  const targetPath = join(targetDir, PLAN_FILE);
  writeFileSync(targetPath, plan.content, "utf8");

  const dir = planDir(rootDir, plan.workspaceId, plan.slug);
  const meta = readMeta(dir);
  if (meta) {
    writeFileSync(
      join(dir, META_FILE),
      JSON.stringify({ ...meta, savedToWorkspace: true }, null, 2),
      "utf8",
    );
  }
  return targetPath;
}
