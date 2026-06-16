import { type FSWatcher, watch } from "node:fs";
import { join, relative, sep } from "node:path";
import { BrowserWindow } from "electron";
import type { GitChangeEvent } from "../../shared/contracts";
import { IPC_CHANNELS } from "../ipc/channels";
import { resolveRepo } from "./git-repo";

/**
 * Live git refresh (Warp-style). Watches a repository's working tree + git dir,
 * debounces a burst of filesystem events into a single notification, and
 * broadcasts a typed `git:event` so the renderer can refresh the Changes panel
 * and commit dialog without the user pressing refresh.
 *
 * Why this is safe against feedback loops: every git *read* in `git-service`
 * runs with `GIT_OPTIONAL_LOCKS=0` and `-c diff.autoRefreshIndex=false`, so
 * merely refreshing status never writes the index — only real writes (commit,
 * stage, fetch) touch the git dir, and those are exactly what we want to react
 * to.
 */

const DEBOUNCE_MS = 400;

type WatchEntry = {
  refCount: number;
  watchers: FSWatcher[];
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Coalesced kind for the pending burst (most-specific wins). */
  pendingKind: GitChangeEvent["kind"] | undefined;
  gitDir: string;
  commonGitDir: string;
  root: string;
};

const entries = new Map<string, WatchEntry>();

function emitGitEvent(event: GitChangeEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.gitEvent, event);
    }
  }
}

/**
 * Classify a changed path into a refresh kind from authoritative git-dir
 * structure (HEAD / refs / index / config / lock), not file-name guessing of
 * working-tree files. Anything outside the git dir is a working-tree edit.
 */
function classify(entry: WatchEntry, absPath: string): GitChangeEvent["kind"] | undefined {
  const inGitDir = isUnder(absPath, entry.gitDir) || isUnder(absPath, entry.commonGitDir);
  if (!inGitDir) {
    return "working";
  }
  const name = absPath.split(sep).at(-1) ?? "";
  if (name === "index.lock") return "lock";
  if (name === "index") return "index";
  if (name === "HEAD" || name === "ORIG_HEAD" || name === "MERGE_HEAD") return "head";
  if (name === "config") return "config";
  const rel = relativeUnder(absPath, entry.commonGitDir) ?? relativeUnder(absPath, entry.gitDir);
  if (rel?.startsWith(`refs${sep}remotes`)) return "remote-refs";
  if (rel?.startsWith("refs")) return "refs";
  // Other internal churn (objects/, logs/, packed-refs) — still a git change.
  return "refs";
}

function isUnder(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(`..${sep}`));
}

function relativeUnder(path: string, dir: string): string | undefined {
  const rel = relative(dir, path);
  return rel.startsWith("..") ? undefined : rel;
}

/** More-specific kinds win when a burst spans several areas. */
const KIND_RANK: Record<GitChangeEvent["kind"], number> = {
  lock: 5,
  index: 4,
  head: 3,
  "remote-refs": 3,
  refs: 2,
  config: 2,
  working: 1,
};

function mergeKind(
  current: GitChangeEvent["kind"] | undefined,
  next: GitChangeEvent["kind"],
): GitChangeEvent["kind"] {
  if (!current) return next;
  return KIND_RANK[next] > KIND_RANK[current] ? next : current;
}

function scheduleFlush(cwd: string, entry: WatchEntry): void {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = undefined;
    const kind = entry.pendingKind ?? "working";
    entry.pendingKind = undefined;
    emitGitEvent({ cwd, kind });
  }, DEBOUNCE_MS);
}

function makeHandler(cwd: string, watchedDir: string, entry: WatchEntry) {
  return (_event: string, filename: string | Buffer | null): void => {
    const name = typeof filename === "string" ? filename : filename?.toString();
    const absPath = name ? join(watchedDir, name) : watchedDir;
    const kind = classify(entry, absPath);
    if (!kind) return;
    entry.pendingKind = mergeKind(entry.pendingKind, kind);
    scheduleFlush(cwd, entry);
  };
}

function tryWatch(dir: string, handler: ReturnType<typeof makeHandler>): FSWatcher | undefined {
  try {
    // Recursive is supported on Windows/macOS, and on Linux with Node >= 20.
    const watcher = watch(dir, { recursive: true }, handler);
    watcher.on("error", () => {
      // A watch can drop (e.g. inotify limits on a huge tree). Degrade quietly;
      // the git-dir watch and manual refresh still work.
    });
    return watcher;
  } catch {
    return undefined;
  }
}

/**
 * Begin watching the repository that contains `cwd` (ref-counted per repo root).
 * Returns the resolved repo root, or undefined if `cwd` is not a git repo.
 */
export function watchRepo(cwd: string): string | undefined {
  const repo = resolveRepo(cwd);
  if (!repo) return undefined;

  const existing = entries.get(repo.root);
  if (existing) {
    existing.refCount += 1;
    return repo.root;
  }

  const entry: WatchEntry = {
    refCount: 1,
    watchers: [],
    timer: undefined,
    pendingKind: undefined,
    gitDir: repo.gitDir,
    commonGitDir: repo.commonGitDir,
    root: repo.root,
  };

  // Working tree (catches agent/terminal/external edits). The git dir lives
  // under root for normal repos; for linked worktrees it is elsewhere, so watch
  // it (and the common dir) explicitly too.
  const dirs = new Set<string>([repo.root, repo.gitDir, repo.commonGitDir]);
  for (const dir of dirs) {
    const watcher = tryWatch(dir, makeHandler(repo.root, dir, entry));
    if (watcher) entry.watchers.push(watcher);
  }

  entries.set(repo.root, entry);
  return repo.root;
}

/** Stop watching (ref-counted). Closes watchers when the last subscriber leaves. */
export function unwatchRepo(cwd: string): void {
  const repo = resolveRepo(cwd);
  const root = repo?.root;
  // Fall back to a direct map hit so unwatch still works if resolution changed.
  const entry = (root && entries.get(root)) || findEntryForCwd(cwd);
  if (!entry) return;

  entry.refCount -= 1;
  if (entry.refCount > 0) return;

  if (entry.timer) clearTimeout(entry.timer);
  for (const watcher of entry.watchers) {
    try {
      watcher.close();
    } catch {
      // already closed
    }
  }
  entries.delete(entry.root);
}

function findEntryForCwd(cwd: string): WatchEntry | undefined {
  for (const entry of entries.values()) {
    if (isUnder(cwd, entry.root)) return entry;
  }
  return undefined;
}

/** Tear down every watcher (app shutdown). */
export function disposeAllGitWatchers(): void {
  for (const entry of entries.values()) {
    if (entry.timer) clearTimeout(entry.timer);
    for (const watcher of entry.watchers) {
      try {
        watcher.close();
      } catch {
        // already closed
      }
    }
  }
  entries.clear();
}
