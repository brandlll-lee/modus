import type {
  ManagedProcessInfo,
  ManagedProcessOrigin,
  TerminalInfo,
} from "../../shared/contracts";
import type { AppProcessInfo } from "./app-process-service";

/**
 * Pure mapping/filtering/formatting for the unified "managed process" view —
 * the single source of truth that backs both the composer running-process bar
 * and the right-panel terminal grouping. Kept free of Electron/Node so it is
 * directly unit-testable. The Electron-coupled `managed-process-facade` only
 * gathers the live records and delegates the shaping here.
 */

function basename(value: string): string {
  return value.split(/[/\\]/).filter(Boolean).at(-1) ?? value;
}

/** Drop a trailing `.exe`/`.cmd`/`.bat` so a shell path reads as a name. */
function shellName(shell: string): string {
  return basename(shell).replace(/\.(exe|cmd|bat|ps1)$/i, "") || shell;
}

/** A label for a terminal: the agent's command, else the shell name. */
export function terminalLabel(info: TerminalInfo): string {
  if (info.origin === "agent") {
    return info.title ?? info.command ?? shellName(info.shell);
  }
  return shellName(info.shell);
}

export function terminalToManaged(info: TerminalInfo): ManagedProcessInfo {
  return {
    id: info.id,
    kind: "terminal",
    origin: info.origin,
    workspaceId: info.workspaceId,
    ...(info.sessionId !== undefined ? { sessionId: info.sessionId } : {}),
    label: terminalLabel(info),
    status: info.status,
    startedAt: info.startedAt,
    ...(info.pid !== undefined ? { pid: info.pid } : {}),
    ...(info.exitCode !== undefined ? { exitCode: info.exitCode } : {}),
  };
}

export function appToManaged(info: AppProcessInfo): ManagedProcessInfo {
  return {
    id: info.id,
    kind: "app",
    origin: "agent",
    ...(info.workspaceId !== undefined ? { workspaceId: info.workspaceId } : {}),
    ...(info.sessionId !== undefined ? { sessionId: info.sessionId } : {}),
    label: info.name,
    status: info.status,
    startedAt: info.startedAt,
    pid: info.pid,
    ...(info.windowTitle !== undefined ? { windowTitle: info.windowTitle } : {}),
  } as ManagedProcessInfo;
}

/**
 * Scope rule (the heart of per-session isolation): agent-owned processes belong
 * to the session that started them and only appear there; user-opened terminals
 * are workspace-level and shared across that workspace's sessions.
 */
export function matchesScope(
  process: ManagedProcessInfo,
  scope: { workspaceId?: string | undefined; sessionId?: string | undefined },
): boolean {
  if (process.origin === "agent") {
    return scope.sessionId !== undefined && process.sessionId === scope.sessionId;
  }
  return scope.workspaceId !== undefined && process.workspaceId === scope.workspaceId;
}

/**
 * A query over the unified managed-process model. `origin` is a first-class
 * predicate so each view declares the slice it wants: the composer bar asks for
 * agent-owned processes only (the "agent is running N things" pill), while a
 * roster view can omit it to take the full set. Adding a future predicate
 * (e.g. `kind`) is a one-line extension here — never a branch in the UIs.
 */
export type ManagedProcessQuery = {
  workspaceId?: string | undefined;
  sessionId?: string | undefined;
  origin?: ManagedProcessOrigin | undefined;
};

/**
 * Pure selection over a gathered process list: apply the isolation scope, the
 * optional origin predicate, then sort oldest-first. The Electron-coupled
 * facade only gathers the live records and delegates here, so this — the actual
 * filtering semantics every view depends on — stays unit-testable.
 */
export function selectManagedProcesses(
  all: ManagedProcessInfo[],
  query: ManagedProcessQuery,
): ManagedProcessInfo[] {
  return all
    .filter((process) => matchesScope(process, query))
    .filter((process) => query.origin === undefined || process.origin === query.origin)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** Compact elapsed label, e.g. `45s`, `2m 27s`, `1h 5m` (Cursor-style). */
export { formatElapsed } from "../../shared/managed-process";
