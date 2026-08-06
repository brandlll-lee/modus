/** Session-scoped Plan Mode persistence. */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PlanBlock, PlanBuildStatus, PlanRef, PlanTodo } from "../../shared/contracts";

const PLAN_FILE = "plan.md";
const META_FILE = "plan.json";

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

/** One temporary plan per session; rewrites update this directory in place. */
export function planDir(rootDir: string, sessionId: string): string {
  return join(rootDir, sanitizeSegment(sessionId));
}

function sanitizeSegment(value: string): string {
  const cleaned = value.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "default";
}

type PlanMeta = Omit<PlanRef, "content">;

/** Historical plan.json may still store visual blocks; project them to Markdown. */
type LegacyPlanBlock =
  | PlanBlock
  | {
      type: "visual";
      title?: string;
      kind?: string;
      content?: string;
      fallback?: string;
    };

function buildTodos(items: ReadonlyArray<{ content: string }>): PlanTodo[] {
  return items.map((item, index) => ({
    id: hashContent(`${index}:${item.content}`),
    content: item.content,
    status: "pending",
  }));
}

function blockToMarkdown(block: LegacyPlanBlock): string {
  if (block.type === "markdown") return block.content.trim();
  const title = typeof block.title === "string" ? block.title.trim() : "";
  const fallback = typeof block.fallback === "string" ? block.fallback.trim() : "";
  return [title ? `### ${title}` : "", fallback].filter(Boolean).join("\n\n");
}

/** Coerce stored blocks (including legacy visual) into markdown-only PlanBlocks. */
function normalizeBlocks(
  rawBlocks: readonly LegacyPlanBlock[] | undefined,
  content: string,
): PlanBlock[] {
  if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) {
    return [{ type: "markdown", content }];
  }
  return rawBlocks.map((block) =>
    block.type === "markdown"
      ? block
      : { type: "markdown" as const, content: blockToMarkdown(block) },
  );
}

function readMeta(dir: string): Partial<PlanMeta> | undefined {
  const metaPath = join(dir, META_FILE);
  if (!existsSync(metaPath)) return undefined;
  try {
    return JSON.parse(readFileSync(metaPath, "utf8")) as Partial<PlanMeta>;
  } catch {
    return undefined;
  }
}

function readPlanDir(dir: string): PlanRef | undefined {
  const raw = readMeta(dir);
  const path = typeof raw?.path === "string" ? raw.path : join(dir, PLAN_FILE);
  if (!raw || !existsSync(path)) return undefined;
  const content = readFileSync(path, "utf8");
  const blocks = normalizeBlocks(raw.blocks as LegacyPlanBlock[] | undefined, content);
  return {
    id: raw.id ?? raw.sessionId ?? "legacy-plan",
    title: raw.title ?? "Plan",
    overview: raw.overview ?? "",
    path,
    hash: raw.hash ?? hashContent(content),
    workspaceId: raw.workspaceId ?? "",
    sessionId: raw.sessionId ?? raw.id ?? "legacy-plan",
    blocks,
    content,
    todos: raw.todos ?? [],
    buildStatus: raw.buildStatus ?? "not_built",
    createdAt: raw.createdAt ?? "",
    updatedAt: raw.updatedAt ?? "",
  };
}

function resolvePlanDir(rootDir: string, id: string): string | undefined {
  const current = planDir(rootDir, id);
  if (existsSync(join(current, META_FILE))) return current;

  // Historical plans used `<workspaceId>/<slug>` and ids shaped as
  // `${workspaceId}:${slug}`. Keep them readable without preserving that layout
  // for new writes.
  const separator = id.indexOf(":");
  if (separator < 0) return undefined;
  const legacy = join(rootDir, sanitizeSegment(id.slice(0, separator)), id.slice(separator + 1));
  return existsSync(join(legacy, META_FILE)) ? legacy : undefined;
}

export function writePlan(
  rootDir: string,
  input: {
    workspaceId: string;
    sessionId: string;
    title: string;
    overview: string;
    content: string;
    todos: ReadonlyArray<{ content: string }>;
  },
): PlanRef {
  const dir = planDir(rootDir, input.sessionId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, PLAN_FILE);
  const content = input.content.trim();
  const blocks: PlanBlock[] = [{ type: "markdown", content }];
  writeFileSync(path, content, "utf8");

  const now = new Date().toISOString();
  const existing = readMeta(dir);
  const meta: PlanMeta = {
    id: input.sessionId,
    title: input.title,
    overview: input.overview,
    path,
    hash: hashContent(content),
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    blocks,
    todos: buildTodos(input.todos),
    buildStatus: "not_built",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  writeFileSync(join(dir, META_FILE), JSON.stringify(meta, null, 2), "utf8");
  return { ...meta, content };
}

export function setPlanBuildStatusById(
  rootDir: string,
  id: string,
  buildStatus: PlanBuildStatus,
): PlanRef | undefined {
  const dir = resolvePlanDir(rootDir, id);
  if (!dir) return undefined;
  const plan = readPlanDir(dir);
  if (!plan) return undefined;
  const { content: _content, ...meta } = plan;
  const next: PlanMeta = { ...meta, buildStatus, updatedAt: new Date().toISOString() };
  writeFileSync(join(dir, META_FILE), JSON.stringify(next, null, 2), "utf8");
  return { ...next, content: plan.content };
}

export function readPlan(rootDir: string, sessionId: string): PlanRef | undefined {
  return readPlanDir(planDir(rootDir, sessionId));
}

export function readPlanById(rootDir: string, id: string): PlanRef | undefined {
  const dir = resolvePlanDir(rootDir, id);
  return dir ? readPlanDir(dir) : undefined;
}

export function deleteSessionPlan(rootDir: string, sessionId: string): void {
  rmSync(planDir(rootDir, sessionId), { recursive: true, force: true });
  if (!existsSync(rootDir)) return;
  for (const owner of readdirSync(rootDir, { withFileTypes: true })) {
    if (!owner.isDirectory()) continue;
    const ownerDir = join(rootDir, owner.name);
    for (const entry of readdirSync(ownerDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const legacyDir = join(ownerDir, entry.name);
      if (readMeta(legacyDir)?.sessionId === sessionId) {
        rmSync(legacyDir, { recursive: true, force: true });
      }
    }
  }
}
