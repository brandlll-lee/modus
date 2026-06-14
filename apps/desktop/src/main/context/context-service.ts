import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  ContextItem,
  ContextKind,
  ContextSuggestion,
  ResolvedContext,
} from "../../shared/contracts";
import { activeBrowserContext } from "../browser/browser-service";
import { getDocChunk, searchDocs } from "../docs/docs-service";
import { readDiff } from "../git/git-service";
import { getTerminalOutput, listTerminals } from "../terminal/terminal-service";

const MAX_FILE_BYTES = 64 * 1024;
const MAX_FOLDER_ENTRIES = 80;
const execFileAsync = promisify(execFile);

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

async function grepProject(cwd: string, query: string): Promise<string> {
  if (!query.trim()) {
    return "";
  }
  const { stdout } = await execFileAsync(
    "rg",
    ["--line-number", "--hidden", "--glob", "!node_modules", "--glob", "!.git", query],
    { cwd, windowsHide: true, maxBuffer: 1024 * 1024 * 2 },
  ).catch(() => ({ stdout: "" }));
  return stdout.split("\n").slice(0, 80).join("\n");
}

async function projectSummary(cwd: string): Promise<string> {
  const entries = await readdir(cwd, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
    .slice(0, MAX_FOLDER_ENTRIES)
    .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
    .join("\n");
}

async function readRules(cwd: string): Promise<string> {
  const candidates = ["AGENTS.md", "CLAUDE.md", ".cursorrules", ".cursor/rules"];
  const chunks: string[] = [];
  for (const candidate of candidates) {
    const target = join(cwd, candidate);
    const info = await stat(target).catch(() => undefined);
    if (!info || info.isDirectory() || info.size > MAX_FILE_BYTES) {
      continue;
    }
    chunks.push(`${candidate}\n${await readFile(target, "utf8")}`);
  }
  return chunks.join("\n\n");
}

export async function searchContext(input: {
  workspaceId: string;
  cwd: string;
  query: string;
  kind?: ContextKind;
}): Promise<ContextSuggestion[]> {
  const query = input.query.trim();

  if (input.kind === "project-summary" || /project|summary|overview/i.test(query)) {
    return [
      {
        id: "project-summary",
        type: "project-summary",
        label: "Project Summary",
        detail: "Top-level files and folders",
        item: { type: "project-summary" },
      },
    ];
  }

  if (input.kind === "recent-changes" || /recent|history/i.test(query)) {
    return [
      {
        id: "recent-changes",
        type: "recent-changes",
        label: "Recent Changes",
        detail: "Recent Git commits",
        item: { type: "recent-changes", limit: 20 },
      },
    ];
  }

  if (input.kind === "rules" || /rules?|instructions?/i.test(query)) {
    return [
      {
        id: "rules",
        type: "rules",
        label: "Project Rules",
        detail: "AGENTS, CLAUDE, Cursor rules",
        item: { type: "rules" },
      },
    ];
  }

  if (input.kind === "search" || /^search\s+/i.test(query)) {
    const searchQuery = query.replace(/^search\s+/i, "").trim();
    return [
      {
        id: `search:${searchQuery}`,
        type: "search",
        label: `Search: ${searchQuery || query}`,
        detail: "Project text search",
        item: { type: "search", query: searchQuery || query },
      },
    ];
  }

  if (input.kind === "terminal" || /terminals?/i.test(query)) {
    return listTerminals().map((terminal) => ({
      id: `terminal:${terminal.id}`,
      type: "terminal",
      label: terminal.shell,
      detail: terminal.cwd,
      item: { type: "terminal", terminalId: terminal.id },
    }));
  }

  if (input.kind === "browser" || /browser|page|url|tab/i.test(query)) {
    return [
      {
        id: "browser:active",
        type: "browser",
        label: "Current Browser Page",
        detail: "Active in-app browser tab",
        item: { type: "browser", workspaceId: input.workspaceId },
      },
    ];
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

    if (item.type === "browser") {
      const content = item.workspaceId ? activeBrowserContext(item.workspaceId) : undefined;
      resolvedItems.push({
        item,
        title: "browser:active",
        content: content ?? "No active browser tab.",
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

    if (item.type === "project-summary") {
      resolvedItems.push({
        item,
        title: "project-summary",
        content: await projectSummary(cwd),
      });
    }

    if (item.type === "recent-changes") {
      const [status, stat, log] = await Promise.all([
        execFileAsync("git", ["status", "--short"], { cwd, windowsHide: true }).catch(() => ({
          stdout: "",
        })),
        execFileAsync("git", ["diff", "--stat"], { cwd, windowsHide: true }).catch(() => ({
          stdout: "",
        })),
        execFileAsync("git", ["log", "--oneline", `-${item.limit ?? 20}`], {
          cwd,
          windowsHide: true,
        }).catch(() => ({ stdout: "" })),
      ]);
      resolvedItems.push({
        item,
        title: "recent-changes",
        content:
          `Status\n${status.stdout}\n\nDiff stat\n${stat.stdout}\n\nRecent commits\n${log.stdout}`.trim(),
      });
    }

    if (item.type === "rules") {
      resolvedItems.push({
        item,
        title: "project-rules",
        content: await readRules(cwd),
      });
    }

    if (item.type === "search") {
      resolvedItems.push({
        item,
        title: `search:${item.query}`,
        content: await grepProject(cwd, item.query),
      });
    }

    if (item.type === "design-element") {
      const el = item.element;
      const sourceLine = el.source
        ? `${el.source.file}:${el.source.line}${el.source.column ? `:${el.source.column}` : ""}`
        : undefined;
      const styles = el.styleSummary
        ? Object.entries(el.styleSummary)
            .map(([key, value]) => `${key}: ${value}`)
            .join("; ")
        : undefined;
      const attributes = el.attributes
        ? Object.entries(el.attributes)
            .map(([key, value]) => `${key}="${value}"`)
            .join(" ")
        : undefined;
      const props = el.props
        ? Object.entries(el.props)
            .map(([key, value]) => `${key}={${value}}`)
            .join(" ")
        : undefined;
      const ancestry =
        el.ancestors && el.ancestors.length > 0
          ? el.ancestors
              .map((a) => {
                const cls = a.classes ? `.${a.classes.split(" ").join(".")}` : "";
                const id = a.id ? `#${a.id}` : "";
                const role = a.role ? `[role=${a.role}]` : "";
                const text = a.text ? ` "${a.text}"` : "";
                return `${a.tag}${id}${cls}${role}${text}`;
              })
              .reverse()
              .join(" > ")
          : undefined;
      const lines = [
        `Selected UI element from the in-app browser (Design Mode): ${el.label}`,
        el.componentName ? `Component: ${el.componentName}` : "",
        sourceLine ? `Source: ${sourceLine}` : "",
        `Tag: <${el.tagName}>`,
        attributes ? `Attributes: ${attributes}` : "",
        props ? `React props: ${props}` : "",
        `DOM path: ${el.domPath}`,
        ancestry ? `Position in page structure: ${ancestry} > (selected)` : "",
        el.text ? `Text: "${el.text}"` : "",
        styles ? `Key styles: ${styles}` : "",
        `Page URL: ${el.url}`,
        el.screenshotDataUrl ? "A screenshot of this element is attached to the message." : "",
      ].filter(Boolean);
      resolvedItems.push({
        item,
        title: `design-element:${el.label}`,
        content: lines.join("\n"),
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
