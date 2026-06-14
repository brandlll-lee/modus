import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { connect as netConnect } from "node:net";
import { delimiter, join } from "node:path";
import { app, BrowserWindow, type BrowserWindow as BrowserWindowType } from "electron";
import type {
  TerminalEvent,
  TerminalInfo,
  TerminalOrigin,
  TerminalStatus,
} from "../../shared/contracts";
import { getDatabase } from "../db/database";
import { IPC_CHANNELS } from "../ipc/channels";
import { publishManagedProcessChange } from "../process/managed-process-bus";
import { TerminalGrid } from "./terminal-grid";
import {
  deriveTitle,
  matchesReadyLog,
  shellCommandArgs,
  sliceSince,
  tailText,
} from "./terminal-output";

type ExitWaiter = (exitCode: number) => void;

type TerminalRecord = {
  info: TerminalInfo;
  /**
   * Headless VT screen that renders raw PTY output the way the agent would see
   * it (cursor moves / carriage returns / clears applied), so progress bars and
   * spinners collapse instead of duplicating. Backs all agent reads + persist.
   */
  grid: TerminalGrid;
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
let lastWindow: BrowserWindowType | undefined;

/** Cap retained exited terminals so agent history doesn't grow unbounded. */
const MAX_EXITED_RETAINED = 40;

/**
 * Environment for agent-run commands: deterministic, non-interactive, UTF-8.
 * Disables progress spinners/animations (which redraw and bloat output),
 * pagers (which block waiting for a keypress), and color, and forces UTF-8 so
 * tool output decodes cleanly regardless of the host console code page. This is
 * the same hardening CI environments apply.
 */
const AGENT_COMMAND_ENV: Record<string, string> = {
  CI: "1",
  NO_COLOR: "1",
  FORCE_COLOR: "0",
  npm_config_progress: "false",
  npm_config_fund: "false",
  npm_config_audit: "false",
  npm_config_color: "false",
  PIP_PROGRESS_BAR: "off",
  PIP_NO_INPUT: "1",
  PYTHONUTF8: "1",
  PYTHONIOENCODING: "utf-8",
  PAGER: "cat",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
};
/** Default foreground wait before a command is promoted to a background terminal. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
export const MAX_COMMAND_TIMEOUT_MS = 600_000;
/**
 * Default "yield window" for a background launch: spawn the process, watch it
 * for this long, then report whether it stayed ALIVE or already EXITED. This is
 * the liveness check that turns "started a server" into a verifiable outcome
 * instead of a fire-and-forget guess (codex `unified_exec` parity).
 */
export const DEFAULT_BACKGROUND_YIELD_MS = 2_500;
export const MIN_BACKGROUND_YIELD_MS = 500;
export const MAX_BACKGROUND_YIELD_MS = 30_000;
/** Poll cadence while waiting for a background process to exit or become ready. */
const BACKGROUND_POLL_MS = 150;
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
function targetWindow(explicit?: BrowserWindowType): BrowserWindowType | undefined {
  if (explicit && !explicit.isDestroyed()) {
    return explicit;
  }
  if (lastWindow && !lastWindow.isDestroyed()) {
    return lastWindow;
  }
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
}

function emit(event: TerminalEvent, explicit?: BrowserWindowType): void {
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
      terminal.grid.render(),
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
  // Feed raw bytes (ANSI included) into the headless VT screen; it applies
  // cursor moves / clears so the agent later reads the rendered result.
  terminal.grid.write(data);
  schedulePersist(terminalId);
}

/** Drop the oldest exited terminals once we exceed the retention cap. */
function pruneExited(): void {
  const exited = [...terminals.values()]
    .filter((record) => record.exited)
    .sort((a, b) => (a.info.endedAt ?? "").localeCompare(b.info.endedAt ?? ""));
  for (const record of exited.slice(0, Math.max(0, exited.length - MAX_EXITED_RETAINED))) {
    record.grid.dispose();
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
  publishManagedProcessChange();
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

function ensureHost(window?: BrowserWindowType): ChildProcessWithoutNullStreams {
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
  window?: BrowserWindowType;
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

  const record: TerminalRecord = {
    info,
    grid: new TerminalGrid(input.cols, input.rows),
    waiters: [],
    exited: false,
  };
  terminals.set(id, record);

  const isAgent = input.origin === "agent";
  writeHost({
    type: "spawn",
    id,
    shell: input.shell,
    cwd: input.cwd || process.cwd(),
    cols: input.cols,
    rows: input.rows,
    ...(input.args !== undefined ? { args: input.args } : {}),
    // Agent-run commands get a clean, deterministic, UTF-8 environment: no
    // progress animations/pagers to garble the captured screen, and a forced
    // UTF-8 stream so the pty-host decodes it without code-page mojibake.
    ...(isAgent ? { env: AGENT_COMMAND_ENV, encoding: "utf-8" } : {}),
  });

  emit({ type: "terminal.created", terminal: { ...info } }, input.window);
  publishManagedProcessChange();
  return record;
}

export function createTerminal(
  window: BrowserWindowType,
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
  /** Wall-clock time the command ran before this result was produced (ms). */
  durationMs: number;
  /**
   * Real OS process id of the spawned shell — the authoritative identity for
   * inspecting or killing this process. This is the actual Windows/Unix PID,
   * not a shell-internal id (e.g. Git Bash `ps -W` column 1), so the model
   * should use it (or `terminal_kill`) rather than parsing `ps`.
   */
  pid?: number;
  /** Background: the process was still running at the end of the yield window. */
  alive?: boolean;
  /** Background + `readyWhen`: a readiness signal (port/log/http) was satisfied. */
  ready?: boolean;
  /** Human-readable readiness signal, e.g. `port 5173 is accepting connections`. */
  readySignal?: string;
  /** Returned an already-running terminal instead of spawning a duplicate. */
  reused?: boolean;
  /**
   * `readyWhen.port` was already in use by some other process *before* spawn —
   * the new process likely can't bind it (a server may already be running).
   */
  portInUse?: number;
};

/** A readiness contract for a background launch: "ready" when one of these holds. */
export type ReadyWhen = {
  /** A TCP port that should start accepting connections (e.g. a dev server). */
  port?: number;
  /** A regex tested against the terminal's output (e.g. "ready in \\d+ ms"). */
  log?: string;
  /** A URL that should return a 2xx response. */
  httpUrl?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/** Resolve true if a TCP connection to the port succeeds within `timeoutMs`. */
function checkPort(port: number, host = "127.0.0.1", timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = netConnect({ port, host });
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/** Resolve true if `url` answers with a 2xx status within `timeoutMs`. */
async function checkHttp(url: string, timeoutMs = 1500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Evaluate a readiness contract once; returns the first signal that holds. */
async function evaluateReady(
  record: TerminalRecord,
  readyWhen: ReadyWhen,
): Promise<string | undefined> {
  if (readyWhen.log) {
    if (matchesReadyLog(record.grid.render(), readyWhen.log)) {
      return `log matched /${readyWhen.log}/`;
    }
  }
  if (readyWhen.port !== undefined && (await checkPort(readyWhen.port))) {
    return `port ${readyWhen.port} is accepting connections`;
  }
  if (readyWhen.httpUrl && (await checkHttp(readyWhen.httpUrl))) {
    return `${readyWhen.httpUrl} returned a successful response`;
  }
  return undefined;
}

type BackgroundOutcome =
  | { kind: "exited" }
  | { kind: "ready"; signal: string }
  | { kind: "alive" }
  | { kind: "alive-not-ready" };

/**
 * Watch a freshly spawned background process for up to `yieldMs`: resolve as
 * soon as it exits or (when a `readyWhen` contract is given) becomes ready;
 * otherwise resolve "alive" / "alive-not-ready" at the deadline. This is the
 * core liveness/readiness check that lets the agent tell a real start from a
 * launcher that died immediately.
 */
async function waitForReadyOrExit(
  record: TerminalRecord,
  options: { yieldMs: number; readyWhen?: ReadyWhen | undefined },
): Promise<BackgroundOutcome> {
  const deadline = Date.now() + options.yieldMs;
  while (true) {
    if (record.exited) {
      return { kind: "exited" };
    }
    if (options.readyWhen) {
      const signal = await evaluateReady(record, options.readyWhen);
      if (signal) {
        return { kind: "ready", signal };
      }
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }
    await sleep(Math.min(BACKGROUND_POLL_MS, remaining));
  }
  if (record.exited) {
    return { kind: "exited" };
  }
  return options.readyWhen ? { kind: "alive-not-ready" } : { kind: "alive" };
}

/** Normalize a command for reuse matching (collapse whitespace). */
function normalizeCommandKey(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}

/**
 * Find a still-running agent terminal in the same session that is already
 * running the identical command in the same cwd. Lets a background launch reuse
 * a live process instead of spawning a duplicate — the fix for "restart the dev
 * server" spawning a new terminal each time and drifting the port.
 */
function findReusableBackgroundTerminal(input: {
  sessionId?: string;
  cwd: string;
  command: string;
}): TerminalRecord | undefined {
  const key = normalizeCommandKey(input.command);
  for (const record of terminals.values()) {
    if (
      !record.exited &&
      record.info.origin === "agent" &&
      record.info.sessionId === input.sessionId &&
      record.info.cwd === input.cwd &&
      record.info.command !== undefined &&
      normalizeCommandKey(record.info.command) === key
    ) {
      return record;
    }
  }
  return undefined;
}

/**
 * Run a command in a managed PTY terminal that shows up in the side panel.
 *
 * - `background: false` waits up to `timeoutMs` for completion. If it finishes,
 *   the exit code + output are returned. If it outruns the timeout it is left
 *   running (promoted to a background terminal) so the agent never loses a
 *   long-lived process — matching Cursor's behaviour.
 * - `background: true` spawns the process, then watches it for a yield window
 *   (`yieldMs`) and reports whether it stayed ALIVE (optionally READY, via
 *   `readyWhen`) or already EXITED. A process that dies inside the window is
 *   reported as exited-with-code, so a launcher that fails immediately can no
 *   longer be mistaken for a successful start.
 */
export async function runAgentCommand(input: {
  workspaceId: string;
  cwd: string;
  command: string;
  background: boolean;
  sessionId?: string;
  timeoutMs?: number;
  yieldMs?: number;
  readyWhen?: ReadyWhen;
  reuse?: boolean;
  cols?: number;
  rows?: number;
  outputBytes?: number;
  window?: BrowserWindowType;
}): Promise<RunCommandResult> {
  const outputBytes = input.outputBytes ?? 12 * 1024;
  const startedAt = Date.now();

  const resultFor = (
    record: TerminalRecord,
    extra: Partial<RunCommandResult> = {},
  ): RunCommandResult => {
    const tail = tailText(record.grid.render(), outputBytes);
    return {
      terminalId: record.info.id,
      status: record.info.status,
      background: input.background,
      timedOut: false,
      ...(record.info.exitCode !== undefined ? { exitCode: record.info.exitCode } : {}),
      output: tail.text,
      truncated: tail.truncated,
      cursor: record.grid.produced,
      durationMs: Date.now() - startedAt,
      ...(record.info.pid !== undefined ? { pid: record.info.pid } : {}),
      ...extra,
    };
  };

  // Background reuse: if an identical command is already running in this session
  // and cwd, hand back the live terminal instead of spawning a duplicate (avoids
  // port drift from "restart the server" opening a fresh terminal each time).
  if (input.background && input.reuse !== false) {
    const existing = findReusableBackgroundTerminal({
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      cwd: input.cwd,
      command: input.command,
    });
    if (existing) {
      await existing.grid.flush();
      return resultFor(existing, { alive: true, reused: true });
    }
  }

  // Port awareness: detect when the requested readiness port is already taken
  // before we even spawn — a server is probably already up (or the port is
  // occupied), so a fresh launch will likely fail to bind.
  let portInUse: number | undefined;
  if (input.background && input.readyWhen?.port !== undefined) {
    if (await checkPort(input.readyWhen.port)) {
      portInUse = input.readyWhen.port;
    }
  }

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
    args: shellCommandArgs(shell, input.command, { utf8: true }),
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.window !== undefined ? { window: input.window } : {}),
  });

  if (input.background) {
    const yieldMs = Math.min(
      Math.max(input.yieldMs ?? DEFAULT_BACKGROUND_YIELD_MS, MIN_BACKGROUND_YIELD_MS),
      MAX_BACKGROUND_YIELD_MS,
    );
    const outcome = await waitForReadyOrExit(record, {
      yieldMs,
      ...(input.readyWhen ? { readyWhen: input.readyWhen } : {}),
    });
    const extra: Partial<RunCommandResult> = portInUse !== undefined ? { portInUse } : {};
    await record.grid.flush();
    switch (outcome.kind) {
      case "exited":
        return resultFor(record, extra);
      case "ready":
        return resultFor(record, {
          ...extra,
          alive: true,
          ready: true,
          readySignal: outcome.signal,
        });
      case "alive-not-ready":
        return resultFor(record, { ...extra, alive: true, ready: false });
      default:
        return resultFor(record, { ...extra, alive: true });
    }
  }

  const timeoutMs = Math.min(input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS, MAX_COMMAND_TIMEOUT_MS);
  const outcome = await waitForExit(record, timeoutMs);
  await record.grid.flush();
  return resultFor(record, { timedOut: outcome === "timeout" });
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
    terminal.grid.resize(cols, rows);
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
  terminal.grid.dispose();
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
  // New committed history since the cursor, then the live viewport appended.
  // The viewport is volatile (it redraws in place), so it is always returned
  // fresh; committed scrollback bytes are the stable cursor space.
  const { text: history, truncated } = sliceSince({
    output: terminal.grid.scrollback,
    produced: terminal.grid.produced,
    sinceCursor: input.sinceCursor,
    maxBytes,
  });
  const screen = terminal.grid.screen();
  const slice = screen ? (history ? `${history}${screen}` : screen) : history;

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
    cursor: terminal.grid.produced,
    truncated,
  };
}

export function getTerminalOutput(terminalId: string): string {
  const active = terminals.get(terminalId)?.grid.render();
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
      const pid = record.info.pid !== undefined ? `, pid ${record.info.pid}` : "";
      const label = record.info.command ?? `${record.info.shell} (interactive)`;
      const lastLine =
        record.grid
          .render()
          .split("\n")
          .map((value) => value.trim())
          .filter(Boolean)
          .pop() ?? "";
      const tail = lastLine ? ` → ${lastLine.slice(0, 80)}` : "";
      return `- ${record.info.id} [${state}${pid}] ${label}${tail}`;
    });

  return lines.join("\n");
}
