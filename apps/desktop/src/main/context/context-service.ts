import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import type {
  ContextItem,
  ContextKind,
  ContextSuggestion,
  ResolvedContext,
} from "../../shared/contracts";
import { getDocChunk, searchDocs } from "../docs/docs-service";
import { readDiff } from "../git/git-service";
import { getTerminalOutput, listTerminals } from "../terminal/terminal-service";

const MAX_FILE_BYTES = 64 * 1024;
const MAX_FOLDER_ENTRIES = 80;

function inside(root: string, target: string): boolean {
  const rootPath = resolve(root);
  const targetPath = resolve(target);
  return (
    targetPath === rootPath ||
    targetPath.startsWith(`${rootPath}\\`) ||
    targetPath.startsWith(`${rootPath}/`)
  );
}

function toRelative(cwd: string, path: string): string {
  return relative(cwd, path).replace(/\\/g, "/") || basename(path);
}

async function searchFiles(cwd: string, query: string): Promise<ContextSuggestion[]> {
  const target = query.replace(/^@/, "");
  const slashIndex = target.lastIndexOf("/");
  const baseDir = slashIndex >= 0 ? join(cwd, target.slice(0, slashIndex)) : cwd;
  const filter =
    slashIndex >= 0 ? target.slice(slashIndex + 1).toLowerCase() : target.toLowerCase();

  if (!inside(cwd, baseDir)) {
    return [];
  }

  const entries = await readdir(baseDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter(
      (entry) => entry.name !== "node_modules" && entry.name !== ".git" && entry.name !== "target",
    )
    .filter((entry) => entry.name.toLowerCase().includes(filter))
    .slice(0, 30)
    .map((entry) => {
      const path = join(baseDir, entry.name);
      const rel = toRelative(cwd, path);
      const type: ContextKind = entry.isDirectory() ? "folder" : "file";
      return {
        id: `${type}:${path}`,
        type,
        label: entry.isDirectory() ? `${rel}/` : rel,
        detail: entry.isDirectory() ? "folder" : "file",
        item: entry.isDirectory() ? { type: "folder", path } : { type: "file", path },
      };
    });
}

export async function searchContext(input: {
  workspaceId: string;
  cwd: string;
  query: string;
  kind?: ContextKind;
}): Promise<ContextSuggestion[]> {
  const query = input.query.trim();

  if (input.kind === "terminal" || /terminals?/i.test(query)) {
    return listTerminals().map((terminal) => ({
      id: `terminal:${terminal.id}`,
      type: "terminal",
      label: terminal.shell,
      detail: terminal.cwd,
      item: { type: "terminal", terminalId: terminal.id },
    }));
  }

  if (input.kind === "doc" || /^docs?/i.test(query)) {
    return searchDocs(input.workspaceId, query.replace(/^docs?/i, "").trim()).map((hit) => ({
      id: `doc:${hit.chunkId}`,
      type: "doc",
      label: hit.heading ? `${hit.title} / ${hit.heading}` : hit.title,
      detail: hit.snippet,
      item: { type: "doc", docId: hit.chunkId, title: hit.title, query },
    }));
  }

  if (input.kind === "git-diff" || /diff|changes?/i.test(query)) {
    return [
      {
        id: "git-diff:working-state",
        type: "git-diff",
        label: "Working State Diff",
        detail: "Uncommitted changes in this workspace",
        item: { type: "git-diff", mode: "working-state" },
      },
    ];
  }

  return searchFiles(input.cwd, query);
}

export async function resolveContext(
  cwd: string,
  items: ContextItem[],
): Promise<ResolvedContext[]> {
  const resolvedItems: ResolvedContext[] = [];

  for (const item of items) {
    if (item.type === "file") {
      if (!inside(cwd, item.path)) {
        continue;
      }
      const info = await stat(item.path).catch(() => undefined);
      if (!info || info.size > MAX_FILE_BYTES) {
        continue;
      }
      resolvedItems.push({
        item,
        title: `file:${toRelative(cwd, item.path)}`,
        content: await readFile(item.path, "utf8"),
      });
    }

    if (item.type === "folder") {
      if (!inside(cwd, item.path)) {
        continue;
      }
      const entries = await readdir(item.path, { withFileTypes: true }).catch(() => []);
      resolvedItems.push({
        item,
        title: `folder:${toRelative(cwd, item.path)}`,
        content: entries
          .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
          .slice(0, MAX_FOLDER_ENTRIES)
          .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
          .join("\n"),
      });
    }

    if (item.type === "terminal") {
      resolvedItems.push({
        item,
        title: `terminal:${item.terminalId}`,
        content: getTerminalOutput(item.terminalId),
      });
    }

    if (item.type === "git-diff") {
      const diff = await readDiff(cwd);
      resolvedItems.push({
        item,
        title: "git-diff:working-state",
        content: diff.diff,
      });
    }

    if (item.type === "doc") {
      const chunk = getDocChunk(item.docId);
      resolvedItems.push({
        item,
        title: `doc:${item.title}`,
        content: chunk ? `${chunk.heading ?? chunk.title}\n${chunk.content}` : "",
      });
    }
  }

  return resolvedItems;
}

export function formatResolvedContext(items: ResolvedContext[]): string {
  if (items.length === 0) {
    return "";
  }

  return items
    .map((item) => `<context title="${item.title}">\n${item.content}\n</context>`)
    .join("\n\n");
}
