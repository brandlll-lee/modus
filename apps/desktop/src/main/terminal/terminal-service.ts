import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { app, BrowserWindow, type BrowserWindow as BrowserWindowType } from "electron";
import type { TerminalEvent, TerminalInfo } from "../../shared/contracts";
import { IPC_CHANNELS } from "../ipc/channels";
import { interactiveShellArgs } from "./terminal-output";

type TerminalRecord = {
  info: TerminalInfo;

  exited: boolean;
};

type HostEvent =
  | { type: "spawned"; id: string; pid?: number }
  | { type: "data"; id: string; data: string }
  | { type: "exit"; id: string; exit_code?: number }
  | { type: "error"; id?: string; message: string };

const terminals = new Map<string, TerminalRecord>();
let host: ChildProcessWithoutNullStreams | undefined;
let hostBuffer = "";

let lastWindow: BrowserWindowType | undefined;

const MAX_EXITED_RETAINED = 40;

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
    const data = `\r\n[pty-host error] ${event.message}\r\n`;

    emit({
      type: "terminal.data",
      terminalId: event.id,
      data,
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

  args?: string[];
  window?: BrowserWindowType;
};

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
    startedAt: new Date().toISOString(),
  };

  const record: TerminalRecord = {
    info,
    exited: false,
  };
  terminals.set(id, record);
  writeHost({
    type: "spawn",
    id,
    shell: input.shell,
    cwd: input.cwd || process.cwd(),
    cols: input.cols,
    rows: input.rows,
    // ConPTY pipe bytes are always UTF-8 (Microsoft Pseudoconsole contract).
    encoding: "utf-8",
    ...(input.args !== undefined ? { args: input.args } : {}),
  });

  emit({ type: "terminal.created", terminal: { ...info } }, input.window);

  return record;
}

export function createTerminal(
  window: BrowserWindowType,
  input: { workspaceId: string; cwd?: string; cols?: number; rows?: number },
): TerminalInfo {
  const cwd = input.cwd ?? homedir();
  if (input.cwd === undefined) {
    const existing = [...terminals.values()].find(
      (terminal) =>
        terminal.info.workspaceId === input.workspaceId &&
        terminal.info.status === "running" &&
        terminal.info.cwd === cwd,
    );
    if (existing) {
      return { ...existing.info };
    }
  }
  const shell = defaultShell();
  const interactiveArgs = interactiveShellArgs(shell);
  const record = spawnTerminal({
    workspaceId: input.workspaceId,
    cwd,
    shell,
    cols: input.cols ?? 80,
    rows: input.rows ?? 24,
    window,
    ...(interactiveArgs !== undefined ? { args: interactiveArgs } : {}),
  });
  return { ...record.info };
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

export function killTerminal(terminalId: string): void {
  const terminal = terminals.get(terminalId);
  if (!terminal || terminal.exited) {
    return;
  }
  writeHost({ type: "kill", id: terminalId });
}

export function removeTerminal(terminalId: string): void {
  const terminal = terminals.get(terminalId);
  if (!terminal) {
    return;
  }
  if (!terminal.exited) {
    writeHost({ type: "kill", id: terminalId });
  }

  terminals.delete(terminalId);
}

export function listTerminals(): TerminalInfo[] {
  return [...terminals.values()].map((terminal) => ({ ...terminal.info }));
}

export function shutdownTerminals(): void {
  if (host && !host.killed) writeHost({ type: "shutdown" });
}
