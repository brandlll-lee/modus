import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { publishManagedProcessChange } from "./managed-process-bus";
import { createPlatformProcessOps } from "./platform-process-ops";

/**
 * Launch and track GUI desktop applications — programs that open their own
 * window and run independently of any shell (editors, IDEs, games, Electron
 * apps). Unlike `terminal-service` (which owns a PTY child and streams its
 * output), an app is launched *detached*: it is its own top-level process, so
 * Modus records its real OS pid, verifies the window came up, and can still
 * terminate it later. Platform specifics (liveness, window title, tree-kill)
 * are delegated entirely to `PlatformProcessOps`, so this service is OS-neutral.
 */

const ops = createPlatformProcessOps();

export type AppProcessInfo = {
  id: string;
  pid: number;
  /** Resolved absolute executable path. */
  command: string;
  args: string[];
  cwd: string;
  name: string;
  windowTitle?: string;
  workspaceId?: string;
  sessionId?: string;
  startedAt: string;
  status: "running" | "exited";
};

export type LaunchAppResult = AppProcessInfo & {
  /** Whether the process was still alive after the verification window. */
  alive: boolean;
  /** Wall-clock time from launch to verification (ms). */
  durationMs: number;
};

/** How long to let the window come up before verifying liveness. */
const APP_VERIFY_DELAY_MS = 1000;

const apps = new Map<string, AppProcessInfo>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** Resolve liveness for every tracked app, flipping dead ones to "exited". */
function refresh(): void {
  for (const info of apps.values()) {
    if (info.status === "running" && !ops.isAlive(info.pid)) {
      info.status = "exited";
    }
  }
}

/**
 * Launch a GUI desktop app detached, then verify it stayed up. The returned
 * `alive` distinguishes a real start (window running, pid tracked) from a
 * binary that died immediately — the same liveness contract the PTY path uses,
 * so the agent never mistakes a failed launch for success.
 */
export async function launchApp(input: {
  path: string;
  args?: string[];
  cwd: string;
  workspaceId?: string;
  sessionId?: string;
}): Promise<LaunchAppResult> {
  const start = Date.now();
  const exe = isAbsolute(input.path) ? input.path : resolve(input.cwd, input.path);

  const child = spawn(exe, input.args ?? [], {
    cwd: input.cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });

  // Distinguish a spawn failure (missing/again-not-executable binary) from a
  // successful launch using Node's "spawn"/"error" events.
  const spawnError = await new Promise<Error | undefined>((resolveSpawn) => {
    let settled = false;
    const settle = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolveSpawn(error);
    };
    child.once("error", (error) => settle(error));
    child.once("spawn", () => settle(undefined));
  });
  if (spawnError) {
    throw new Error(`Failed to launch ${exe}: ${spawnError.message}`);
  }
  const pid = child.pid;
  if (pid === undefined) {
    throw new Error(`Failed to launch ${exe}: the OS returned no process id.`);
  }
  // Detach so the app's lifetime is independent of Modus.
  child.unref();

  await delay(APP_VERIFY_DELAY_MS);
  const alive = ops.isAlive(pid);
  const description = alive ? await ops.describe(pid) : { pid, name: basename(exe) };

  const info: AppProcessInfo = {
    id: randomUUID(),
    pid,
    command: exe,
    args: input.args ?? [],
    cwd: input.cwd,
    name: description.name,
    ...(description.windowTitle ? { windowTitle: description.windowTitle } : {}),
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    startedAt: new Date().toISOString(),
    status: alive ? "running" : "exited",
  };
  apps.set(info.id, info);
  publishManagedProcessChange();
  return { ...info, alive, durationMs: Date.now() - start };
}

export function isAppId(id: string): boolean {
  return apps.has(id);
}

/** Terminate a tracked app and its tree. Returns false if the id is unknown. */
export async function killApp(id: string): Promise<boolean> {
  const info = apps.get(id);
  if (!info) {
    return false;
  }
  await ops.killTree(info.pid);
  info.status = "exited";
  publishManagedProcessChange();
  return true;
}

export function listApps(filter?: { sessionId?: string; workspaceId?: string }): AppProcessInfo[] {
  refresh();
  return [...apps.values()]
    .filter((info) => {
      if (filter?.sessionId && info.sessionId !== filter.sessionId) {
        return false;
      }
      if (filter?.workspaceId && info.workspaceId !== filter.workspaceId) {
        return false;
      }
      return true;
    })
    .map((info) => ({ ...info }));
}

/** Compact, model-facing summary of tracked apps for passive awareness. */
export function summarizeApps(filter?: { sessionId?: string; workspaceId?: string }): string {
  const lines = listApps(filter)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .slice(-12)
    .map((info) => {
      const state = info.status === "running" ? "running" : "exited";
      const title = info.windowTitle ? ` "${info.windowTitle.slice(0, 60)}"` : "";
      return `- ${info.id} [${state}, pid ${info.pid}] app: ${info.name}${title}`;
    });
  return lines.join("\n");
}
