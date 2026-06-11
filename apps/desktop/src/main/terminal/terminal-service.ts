import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { app, BrowserWindow } from "electron";
import type {
  TerminalEvent,
  TerminalInfo,
  TerminalOrigin,
  TerminalStatus,
} from "../../shared/contracts";
import { getDatabase } from "../db/database";
import { IPC_CHANNELS } from "../ipc/channels";
import { deriveTitle, shellCommandArgs, sliceSince, stripAnsi, tailText } from "./terminal-output";

type ExitWaiter = (exitCode: number) => void;

type TerminalRecord = {
  info: TerminalInfo;
  /** ANSI-stripped scrollback (capped). Used for agent reads + persistence. */
  output: string;
  /** Total ANSI-stripped bytes ever produced — the cursor space for reads. */
  produced: number;
  /** Foreground awaiters resolved when the process exits. */
  waiters: ExitWaiter[];
  exited: boolean;
};

type HostEvent =
  | { type: "spawned"; id: string; pid?: number }
  | { type: "data"; id: string; data: string }
  | { type: "exit"; id: string; exit_code?: number }
  | { type: "error"; id?: string; message: string };

const terminals = new Map<string, TerminalRecord>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
let host: ChildProcessWithoutNullStreams | undefined;
let hostBuffer = "";
/** Last window that touched the terminal system; agent-run terminals emit here. */
let lastWindow: BrowserWindow | undefined;

const MAX_OUTPUT_BYTES = 64 * 1024;
/** Cap retained exited terminals so agent history doesn't grow unbounded. */
const MAX_EXITED_RETAINED = 40;
/** Default foreground wait before a command is promoted to a background terminal. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
export const MAX_COMMAND_TIMEOUT_MS = 600_000;
/** How long a background launch waits to capture the process's first output. */
const BACKGROUND_PRIME_MS = 700;
// Cap how often a terminal's scrollback snapshot hits SQLite. Without this, a
// burst of output (think `npm install`) fires one synchronous upsert per chunk
// on the main process and visibly stalls every terminal.
const PERSIST_THROTTLE_MS = 600;

/** First match for `exe` across the PATH dirs, or undefined. */
function resolveOnPath(exe: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) {
      continue;
    }
    const candidate = join(dir, exe);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Pick the default shell. On Windows we mirror what Cursor/VS Code do: prefer
 * PowerShell 7 (`pwsh`), then Windows PowerShell (always present in System32),
 * and only fall back to the bare `cmd` from COMSPEC. `MODUS_DEFAULT_SHELL`
 * overrides everything.
 */
function defaultShell(): string {
  if (process.env.MODUS_DEFAULT_SHELL) {
    return process.env.MODUS_DEFAULT_SHELL;
  }

  if (process.platform === "win32") {
    return resolveOnPath("pwsh.exe") ?? "powershell.exe";
  }

  return process.env.SHELL ?? "bash";
}

function sidecarExecutableName(): string {
  return process.platform === "win32" ? "modus-pty-host.exe" : "modus-pty-host";
}

function resolveSidecarPath(): string {
  const executable = sidecarExecutableName();
  const candidates = [
    process.env.MODUS_PTY_HOST_PATH,
    app.isPackaged ? join(process.resourcesPath, "bin", executable) : undefined,
    join(process.cwd(), "target", "release", executable),
    join(process.cwd(), "..", "..", "target", "release", executable),
    join(process.cwd(), "target", "debug", executable),
    join(process.cwd(), "..", "..", "target", "debug", executable),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const match = candidates.find((candidate) => existsSync(candidate));

  if (!match) {
    throw new Error(
      `Unable to find ${executable}. Run npm --workspace @modus/desktop run build:pty.`,
    );
  }

  return match;
}

/** Best window to deliver terminal events to (single-window app). */
function targetWindow(explicit?: BrowserWindow): BrowserWindow | undefined {
  if (explicit && !explicit.isDestroyed()) {
    return explicit;
  }
  if (lastWindow && !lastWindow.isDestroyed()) {
    return lastWindow;
  }
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
}

function emit(event: TerminalEvent, explicit?: BrowserWindow): void {
  const window = targetWindow(explicit);
  if (window) {
    window.webContents.send(IPC_CHANNELS.terminalEvent, event);
  }
}

function persistOutput(terminalId: string): void {
  const terminal = terminals.get(terminalId);
  if (!terminal) {
    return;
  }

  getDatabase()
    .prepare(
      `insert into terminal_outputs (terminal_id, workspace_id, cwd, output, updated_at)
       values (?, ?, ?, ?, ?)
       on conflict(terminal_id) do update set
         output = excluded.output,
         updated_at = excluded.updated_at`,
    )
    .run(
      terminal.info.id,
      terminal.info.workspaceId,
      terminal.info.cwd,
      terminal.output,
      new Date().toISOString(),
    );
}

/** Throttle SQLite writes: at most one upsert per terminal per window. */
function schedulePersist(terminalId: string): void {
  if (persistTimers.has(terminalId)) {
    return;
  }
  const timer = setTimeout(() => {
    persistTimers.delete(terminalId);
    persistOutput(terminalId);
  }, PERSIST_THROTTLE_MS);
  // Don't let a pending snapshot keep the process alive on shutdown.
  timer.unref?.();
  persistTimers.set(terminalId, timer);
}

/** Persist immediately and cancel any pending throttle (used on exit/kill). */
function flushPersist(terminalId: string): void {
  const timer = persistTimers.get(terminalId);
  if (timer) {
    clearTimeout(timer);
    persistTimers.delete(terminalId);
  }
  persistOutput(terminalId);
}

function appendOutput(terminalId: string, data: string): void {
  const terminal = terminals.get(terminalId);
  if (!terminal) {
    return;
  }

  const clean = stripAnsi(data);
  terminal.produced += Buffer.byteLength(clean, "utf8");
  terminal.output = `${terminal.output}${clean}`.slice(-MAX_OUTPUT_BYTES);
  schedulePersist(terminalId);
}

/** Drop the oldest exited terminals once we exceed the retention cap. */
function pruneExited(): void {
  const exited = [...terminals.values()]
    .filter((record) => record.exited)
    .sort((a, b) => (a.info.endedAt ?? "").localeCompare(b.info.endedAt ?? ""));
  for (const record of exited.slice(0, Math.max(0, exited.length - MAX_EXITED_RETAINED))) {
    terminals.delete(record.info.id);
  }
}

function writeHost(command: unknown): void {
  if (!host) {
    throw new Error("PTY host is not running.");
  }

  host.stdin.write(`${JSON.stringify(command)}\n`);
}

function markExited(terminalId: string, exitCode: number): void {
  const terminal = terminals.get(terminalId);
  if (!terminal || terminal.exited) {
    return;
  }
  terminal.exited = true;
  terminal.info.status = "exited";
  terminal.info.exitCode = exitCode;
  terminal.info.endedAt = new Date().toISOString();
  flushPersist(terminalId);
  const waiters = terminal.waiters.splice(0);
  for (const waiter of waiters) {
    waiter(exitCode);
  }
  pruneExited();
}

function handleHostEvent(event: HostEvent): void {
  if (event.type === "spawned") {
    const terminal = terminals.get(event.id);
    if (terminal && event.pid !== undefined) {
      terminal.info.pid = event.pid;
    }
    return;
  }

  if (event.type === "data") {
    appendOutput(event.id, event.data);
    emit({ type: "terminal.data", terminalId: event.id, data: event.data });
    return;
  }

  if (event.type === "exit") {
    emit({
      type: "terminal.exit",
      terminalId: event.id,
      exitCode: event.exit_code ?? 0,
    });
    markExited(event.id, event.exit_code ?? 0);
    return;
  }

  if (event.type === "error" && event.id) {
    emit({
      type: "terminal.data",
      terminalId: event.id,
      data: `\r\n[pty-host error] ${event.message}\r\n`,
    });
  }
}

function ensureHost(window?: BrowserWindow): ChildProcessWithoutNullStreams {
  if (window && !window.isDestroyed()) {
    lastWindow = window;
  }

  if (host && !host.killed) {
    return host;
  }

  host = spawn(resolveSidecarPath(), [], {
    windowsHide: true,
  });
  hostBuffer = "";

  host.stdout.on("data", (chunk) => {
    hostBuffer += chunk.toString("utf8");

    while (true) {
      const newlineIndex = hostBuffer.indexOf("\n");

      if (newlineIndex === -1) {
        break;
      }

      const line = hostBuffer.slice(0, newlineIndex).trim();
      hostBuffer = hostBuffer.slice(newlineIndex + 1);

      if (!line) {
        continue;
      }

      handleHostEvent(JSON.parse(line) as HostEvent);
    }
  });

  host.stderr.on("data", (chunk) => {
    console.error("[modus-pty-host]", chunk.toString("utf8"));
  });

  host.on("exit", () => {
    host = undefined;
    for (const terminal of terminals.values()) {
      if (!terminal.exited) {
        emit({ type: "terminal.exit", terminalId: terminal.info.id, exitCode: 1 });
        markExited(terminal.info.id, 1);
      }
    }
  });

  return host;
}

type SpawnTerminalInput = {
  workspaceId: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  origin: TerminalOrigin;
  command?: string;
  title?: string;
  sessionId?: string;
  args?: string[];
  window?: BrowserWindow;
};

/** Shared spawn path for both interactive shells and agent-run commands. */
function spawnTerminal(input: SpawnTerminalInput): TerminalRecord {
  ensureHost(input.window);

  const id = randomUUID();
  const info: TerminalInfo = {
    id,
    workspaceId: input.workspaceId,
    cwd: input.cwd,
    shell: input.shell,
    cols: input.cols,
    rows: input.rows,
    status: "running",
    origin: input.origin,
    startedAt: new Date().toISOString(),
    ...(input.command !== undefined ? { command: input.command } : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
  };

  const record: TerminalRecord = { info, output: "", produced: 0, waiters: [], exited: false };
  terminals.set(id, record);

  writeHost({
    type: "spawn",
    id,
    shell: input.shell,
    cwd: input.cwd || process.cwd(),
    cols: input.cols,
    rows: input.rows,
    ...(input.args !== undefined ? { args: input.args } : {}),
  });

  emit({ type: "terminal.created", terminal: { ...info } }, input.window);
  return record;
}

export function createTerminal(
  window: BrowserWindow,
  input: { workspaceId: string; cwd: string; cols?: number; rows?: number; sessionId?: string },
): TerminalInfo {
  const record = spawnTerminal({
    workspaceId: input.workspaceId,
    cwd: input.cwd,
    shell: defaultShell(),
    cols: input.cols ?? 80,
    rows: input.rows ?? 24,
    origin: "user",
    window,
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
  });
  return { ...record.info };
}

function waitForExit(record: TerminalRecord, timeoutMs: number): Promise<"exited" | "timeout"> {
  if (record.exited) {
    return Promise.resolve("exited");
  }
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      const index = record.waiters.indexOf(waiter);
      if (index >= 0) {
        record.waiters.splice(index, 1);
      }
      resolve("timeout");
    }, timeoutMs);
    timer.unref?.();
    const waiter: ExitWaiter = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve("exited");
    };
    record.waiters.push(waiter);
  });
}

export type RunCommandResult = {
  terminalId: string;
  status: TerminalStatus;
  background: boolean;
  /** True when a foreground command outran its timeout and was kept running. */
  timedOut: boolean;
  exitCode?: number;
  output: string;
  truncated: boolean;
  /** Cursor to pass to `readTerminal` for incremental follow-up reads. */
  cursor: number;
};

/**
 * Run a command in a managed PTY terminal that shows up in the side panel.
 *
 * - `background: false` waits up to `timeoutMs` for completion. If it finishes,
 *   the exit code + output are returned. If it outruns the timeout it is left
 *   running (promoted to a background terminal) so the agent never loses a
 *   long-lived process — matching Cursor's behaviour.
 * - `background: true` returns immediately (after a short prime window to
 *   capture the first output) with the terminal id to observe later.
 */
export async function runAgentCommand(input: {
  workspaceId: string;
  cwd: string;
  command: string;
  background: boolean;
  sessionId?: string;
  timeoutMs?: number;
  cols?: number;
  rows?: number;
  outputBytes?: number;
  window?: BrowserWindow;
}): Promise<RunCommandResult> {
  const shell = defaultShell();
  const record = spawnTerminal({
    workspaceId: input.workspaceId,
    cwd: input.cwd,
    shell,
    cols: input.cols ?? 120,
    rows: input.rows ?? 30,
    origin: "agent",
    command: input.command,
    title: deriveTitle(input.command),
    args: shellCommandArgs(shell, input.command),
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.window !== undefined ? { window: input.window } : {}),
  });

  const outputBytes = input.outputBytes ?? 12 * 1024;
  const result = (): RunCommandResult => {
    const tail = tailText(record.output, outputBytes);
    return {
      terminalId: record.info.id,
      status: record.info.status,
      background: input.background,
      timedOut: false,
      ...(record.info.exitCode !== undefined ? { exitCode: record.info.exitCode } : {}),
      output: tail.text,
      truncated: tail.truncated,
      cursor: record.produced,
    };
  };

  if (input.background) {
    await waitForExit(record, BACKGROUND_PRIME_MS);
    return result();
  }

  const timeoutMs = Math.min(input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS, MAX_COMMAND_TIMEOUT_MS);
  const outcome = await waitForExit(record, timeoutMs);
  return { ...result(), timedOut: outcome === "timeout" };
}

export function writeTerminal(terminalId: string, data: string): void {
  const terminal = terminals.get(terminalId);
  if (terminal && !terminal.exited) {
    writeHost({ type: "write", id: terminalId, data });
  }
}

export function resizeTerminal(terminalId: string, cols: number, rows: number): void {
  const terminal = terminals.get(terminalId);
  if (terminal && !terminal.exited) {
    terminal.info.cols = cols;
    terminal.info.rows = rows;
    writeHost({ type: "resize", id: terminalId, cols, rows });
  }
}

/** Stop the process but keep the record as `exited` (history stays readable). */
export function killTerminal(terminalId: string): void {
  const terminal = terminals.get(terminalId);
  if (!terminal || terminal.exited) {
    return;
  }
  writeHost({ type: "kill", id: terminalId });
}

/** Stop (if running) and forget the terminal entirely. */
export function removeTerminal(terminalId: string): void {
  const terminal = terminals.get(terminalId);
  if (!terminal) {
    return;
  }
  if (!terminal.exited) {
    writeHost({ type: "kill", id: terminalId });
  }
  flushPersist(terminalId);
  terminals.delete(terminalId);
}

export function listTerminals(): TerminalInfo[] {
  return [...terminals.values()].map((terminal) => ({ ...terminal.info }));
}

export type TerminalRead = {
  terminalId: string;
  status: TerminalStatus;
  origin: TerminalOrigin;
  command?: string;
  cwd: string;
  shell: string;
  pid?: number;
  exitCode?: number;
  startedAt: string;
  endedAt?: string;
  output: string;
  cursor: number;
  truncated: boolean;
};

/** Read a terminal's output incrementally from `sinceCursor`. */
export function readTerminal(input: {
  terminalId: string;
  sinceCursor?: number;
  maxBytes?: number;
}): TerminalRead | undefined {
  const terminal = terminals.get(input.terminalId);
  if (!terminal) {
    const stored = getTerminalOutput(input.terminalId);
    if (!stored) {
      return undefined;
    }
    return {
      terminalId: input.terminalId,
      status: "exited",
      origin: "user",
      cwd: "",
      shell: "",
      startedAt: "",
      output: stored,
      cursor: Buffer.byteLength(stored, "utf8"),
      truncated: false,
    };
  }

  const maxBytes = input.maxBytes ?? 16 * 1024;
  const { text: slice, truncated } = sliceSince({
    output: terminal.output,
    produced: terminal.produced,
    sinceCursor: input.sinceCursor,
    maxBytes,
  });

  return {
    terminalId: terminal.info.id,
    status: terminal.info.status,
    origin: terminal.info.origin,
    ...(terminal.info.command !== undefined ? { command: terminal.info.command } : {}),
    cwd: terminal.info.cwd,
    shell: terminal.info.shell,
    ...(terminal.info.pid !== undefined ? { pid: terminal.info.pid } : {}),
    ...(terminal.info.exitCode !== undefined ? { exitCode: terminal.info.exitCode } : {}),
    startedAt: terminal.info.startedAt,
    ...(terminal.info.endedAt !== undefined ? { endedAt: terminal.info.endedAt } : {}),
    output: slice,
    cursor: terminal.produced,
    truncated,
  };
}

export function getTerminalOutput(terminalId: string): string {
  const active = terminals.get(terminalId)?.output;
  if (active !== undefined) {
    return active;
  }

  const row = getDatabase()
    .prepare("select output from terminal_outputs where terminal_id = ?")
    .get(terminalId) as { output: string } | undefined;
  return row?.output ?? "";
}

/**
 * A compact, model-facing snapshot of the terminals relevant to a session, used
 * to give the agent passive awareness of what's running (like Cursor's terminal
 * status). Returns "" when there is nothing to report.
 */
export function summarizeTerminals(filter?: { sessionId?: string; workspaceId?: string }): string {
  const records = [...terminals.values()].filter((record) => {
    if (filter?.sessionId && record.info.sessionId !== filter.sessionId) {
      return record.info.origin === "user" && record.info.workspaceId === filter.workspaceId;
    }
    if (filter?.workspaceId && record.info.workspaceId !== filter.workspaceId) {
      return false;
    }
    return true;
  });
  if (records.length === 0) {
    return "";
  }

  const lines = records
    .sort((a, b) => a.info.startedAt.localeCompare(b.info.startedAt))
    .slice(-12)
    .map((record) => {
      const state =
        record.info.status === "running" ? "running" : `exited ${record.info.exitCode ?? "?"}`;
      const label = record.info.command ?? `${record.info.shell} (interactive)`;
      const lastLine =
        record.output
          .split("\n")
          .map((value) => value.trim())
          .filter(Boolean)
          .pop() ?? "";
      const tail = lastLine ? ` → ${lastLine.slice(0, 80)}` : "";
      return `- ${record.info.id} [${state}] ${label}${tail}`;
    });

  return lines.join("\n");
}
