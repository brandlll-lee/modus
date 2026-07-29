import { type FSWatcher, watch } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { BrowserWindow } from "electron";
import type { FilesChangeEvent } from "../../shared/contracts";
import { IPC_CHANNELS } from "../ipc/channels";

/**
 * Live workspace refresh for the Files panel. Watches a workspace root,
 * debounces filesystem bursts, and broadcasts `files:event` so the renderer
 * can refresh the tree and open buffer. Policy: when the open file changes on
 * disk (agent / external editor), disk wins — the renderer overwrites any
 * unsaved local draft.
 */

const DEBOUNCE_MS = 300;

type WatchEntry = {
  refCount: number;
  watcher: FSWatcher | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Absolute paths coalesced in the current burst (empty ⇒ full refresh). */
  pendingPaths: Set<string>;
  root: string;
};

const entries = new Map<string, WatchEntry>();

export function emitFilesEvent(event: FilesChangeEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.filesEvent, event);
    }
  }
}

/**
 * Drop high-churn trees that are not useful for the explorer UI. This is
 * operational noise filtering, not behavior routed by tool / filename kind.
 */
function isNoise(absPath: string, root: string): boolean {
  const rel = relative(root, absPath);
  if (rel.startsWith("..") || rel.startsWith(`..${sep}`)) {
    return true;
  }
  return rel.split(sep).some((part) => part === "node_modules" || part === ".git");
}

function scheduleFlush(entry: WatchEntry): void {
  if (entry.timer) {
    clearTimeout(entry.timer);
  }
  entry.timer = setTimeout(() => {
    entry.timer = undefined;
    const paths = [...entry.pendingPaths];
    entry.pendingPaths.clear();
    emitFilesEvent({ cwd: entry.root, paths });
  }, DEBOUNCE_MS);
}

/** Begin watching `cwd` (ref-counted). Returns the resolved absolute root. */
export function watchWorkspace(cwd: string): string {
  const root = resolve(cwd);
  const existing = entries.get(root);
  if (existing) {
    existing.refCount += 1;
    return root;
  }

  const entry: WatchEntry = {
    refCount: 1,
    watcher: undefined,
    timer: undefined,
    pendingPaths: new Set(),
    root,
  };

  try {
    const watcher = watch(root, { recursive: true }, (_event, filename) => {
      const name =
        typeof filename === "string" ? filename : filename == null ? undefined : String(filename);
      if (name) {
        const abs = join(root, name);
        if (isNoise(abs, root)) {
          return;
        }
        entry.pendingPaths.add(abs);
      }
      // Missing filename (some platforms) ⇒ flush with empty paths = full refresh.
      scheduleFlush(entry);
    });
    watcher.on("error", () => {
      // Watch can drop (e.g. inotify limits). Degrade quietly; next open re-subscribes.
    });
    entry.watcher = watcher;
  } catch {
    // Recursive watch unsupported — panel stays snapshot-only for this root.
  }

  entries.set(root, entry);
  return root;
}

/** Stop watching (ref-counted). Closes the watcher when the last subscriber leaves. */
export function unwatchWorkspace(cwd: string): void {
  const root = resolve(cwd);
  const entry = entries.get(root);
  if (!entry) {
    return;
  }

  entry.refCount -= 1;
  if (entry.refCount > 0) {
    return;
  }

  if (entry.timer) {
    clearTimeout(entry.timer);
  }
  try {
    entry.watcher?.close();
  } catch {
    // already closed
  }
  entries.delete(root);
}
