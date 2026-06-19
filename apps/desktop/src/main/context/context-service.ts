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
import { listAgentEvents } from "../agent/agent-event-store";
import { listAgentSessions } from "../agent/agent-store";
import { activeBrowserContext } from "../browser/browser-service";
import { getDocChunk } from "../docs/docs-service";
import { isGitRepository, readBranchDiff, readDiff } from "../git/git-service";
import { getTerminalOutput } from "../terminal/terminal-service";

const MAX_FILE_BYTES = 64 * 1024;
const MAX_FOLDER_ENTRIES = 80;
/** Byte cap for a branch/working diff or a past-chat transcript injected as context. */
const MAX_CONTEXT_TEXT_BYTES = 60 * 1024;
const execFileAsync = promisify(execFile);

/** Cap large context text so a single @ item can't blow the context window. */
function capText(text: string): string {
  if (Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_TEXT_BYTES) {
    return text;
  }
  return `${Buffer.from(text, "utf8").subarray(0, MAX_CONTEXT_TEXT_BYTES).toString("utf8")}\n…(truncated)`;
}

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
      const type: ContextKind = entry.isDirectory() ? "folder" : "file";
      // Cursor parity: label is the bare name; detail is the containing
      // directory (empty at the workspace root → a clean single-line row).
      const dir = relative(cwd, baseDir).replace(/\\/g, "/");
      return {
        id: `${type}:${path}`,
        type,
        label: entry.isDirectory() ? `${entry.name}/` : entry.name,
        detail: dir,
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

  // Route by the category the user explicitly opened in the @ menu — never by
  // guessing intent from the query text. Past Chats lists this workspace's
  // sessions; every other category (and root free-typing) lists files/folders.
  if (input.kind === "past-chat") {
    return searchPastChats(input.workspaceId, query);
  }
  return searchFiles(input.cwd, query);
}

/** Sessions in this workspace, newest-first, for the @ Past Chats category. */
function searchPastChats(workspaceId: string, query: string): ContextSuggestion[] {
  const needle = query.toLowerCase();
  return listAgentSessions()
    .filter((session) => session.workspaceId === workspaceId)
    .filter((session) => !needle || (session.title ?? "").toLowerCase().includes(needle))
    .slice(0, 30)
    .map((session) => {
      const title = session.title?.trim() || "New chat";
      return {
        id: `past-chat:${session.id}`,
        type: "past-chat" as const,
        label: title,
        detail: "Past Chat",
        item: { type: "past-chat", sessionId: session.id, title },
      };
    });
}

/**
 * Flatten a session's persisted events into a "User: …/Assistant: …" transcript
 * (capped). Reconstructed from the same event stream the timeline replays, so it
 * reflects exactly what was said — no separate storage to drift.
 */
function readSessionTranscript(sessionId: string): string {
  const parts: string[] = [];
  let role: "user" | "assistant" | undefined;
  let buffer = "";
  const flush = (): void => {
    const text = buffer.trim();
    if (role && text) {
      parts.push(`${role === "user" ? "User" : "Assistant"}: ${text}`);
    }
    buffer = "";
  };
  for (const { event } of listAgentEvents(sessionId)) {
    if (event.type === "message.started") {
      flush();
      role = event.role;
    } else if (event.type === "message.delta" && role) {
      buffer += event.delta;
    } else if (event.type === "message.completed") {
      flush();
      role = undefined;
    }
  }
  flush();
  return capText(parts.join("\n\n"));
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
      const listing = entries
        .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
        .slice(0, MAX_FOLDER_ENTRIES)
        .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
        .join("\n");
      resolvedItems.push({
        item,
        title: `folder:${toRelative(cwd, item.path)}`,
        // Reference, not a dump: list the folder and let the agent read the
        // specific files it needs with its tools (keeps the window lean).
        content: `${listing}\n\n(Directory listing — read the specific files you need with the read tool.)`,
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
      // Guidance, not content: @Browser signals the turn should use the in-app
      // browser tools; we add the active page as a lightweight hint when present.
      const page = item.workspaceId ? activeBrowserContext(item.workspaceId) : undefined;
      resolvedItems.push({
        item,
        title: "browser",
        content: page
          ? `This turn should use the in-app browser tools (navigate, click, read, screenshot). Active page:\n${page}`
          : "This turn should use the in-app browser tools (navigate, click, read, screenshot). No browser tab is open yet — open one with the browser tools.",
      });
    }

    if (item.type === "git-diff") {
      resolvedItems.push(await resolveGitDiff(cwd, item));
    }

    if (item.type === "past-chat") {
      resolvedItems.push({
        item,
        title: `past-chat:${item.title}`,
        content: readSessionTranscript(item.sessionId) || "This conversation has no messages yet.",
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

/**
 * Resolve a git-diff context item, reporting the authoritative git state:
 * non-repo → an honest "not a git repo" note; branch → diff vs the default
 * branch; working-state → uncommitted diff. Never throws.
 */
async function resolveGitDiff(
  cwd: string,
  item: Extract<ContextItem, { type: "git-diff" }>,
): Promise<ResolvedContext> {
  if (!(await isGitRepository(cwd))) {
    return {
      item,
      title: "branch-diff",
      content:
        "This workspace is not a git repository (no .git found), so no diff is available. Open the project inside a git repo, or run `git init` / `git clone` first.",
    };
  }

  if (item.mode === "branch") {
    const { base, diff } = await readBranchDiff(cwd);
    const content = !base
      ? "Could not determine a default branch (origin HEAD / main / master) to diff against."
      : diff.trim()
        ? `Diff of the current branch vs ${base} (base your answer on these changes):\n\n${capText(diff)}`
        : `No differences from the default branch (${base}).`;
    return { item, title: "branch-diff", content };
  }

  const diff = await readDiff(cwd);
  return {
    item,
    title: "git-diff:working-state",
    content: diff.diff.trim() ? capText(diff.diff) : "No uncommitted changes in this workspace.",
  };
}

export function formatResolvedContext(items: ResolvedContext[]): string {
  if (items.length === 0) {
    return "";
  }

  return items
    .map((item) => `<context title="${item.title}">\n${item.content}\n</context>`)
    .join("\n\n");
}
