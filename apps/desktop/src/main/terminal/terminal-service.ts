import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { app } from "electron";
import type { TerminalEvent, TerminalInfo } from "../../shared/contracts";
import { getDatabase } from "../db/database";
import { IPC_CHANNELS } from "../ipc/channels";

type TerminalRecord = {
  info: TerminalInfo;
  output: string;
};

type HostEvent =
  | { type: "spawned"; id: string; pid?: number }
  | { type: "data"; id: string; data: string }
  | { type: "exit"; id: string; exit_code?: number }
  | { type: "error"; id?: string; message: string };

const terminals = new Map<string, TerminalRecord>();
let host: ChildProcessWithoutNullStreams | undefined;
let hostBuffer = "";
const MAX_OUTPUT_BYTES = 64 * 1024;
const ANSI_PATTERN = new RegExp(
  `${String.fromCharCode(27)}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])`,
  "g",
);

function defaultShell(): string {
  if (process.platform === "win32") {
    return process.env.COMSPEC ?? "powershell.exe";
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

function emit(window: BrowserWindow, event: TerminalEvent): void {
  window.webContents.send(IPC_CHANNELS.terminalEvent, event);
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

function appendOutput(terminalId: string, data: string): void {
  const terminal = terminals.get(terminalId);
  if (!terminal) {
    return;
  }

  const nextOutput = `${terminal.output}${stripAnsi(data)}`.slice(-MAX_OUTPUT_BYTES);
  terminal.output = nextOutput;
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

function writeHost(command: unknown): void {
  if (!host) {
    throw new Error("PTY host is not running.");
  }

  host.stdin.write(`${JSON.stringify(command)}\n`);
}

function handleHostEvent(window: BrowserWindow, event: HostEvent): void {
  if (event.type === "data") {
    appendOutput(event.id, event.data);
    emit(window, { type: "terminal.data", terminalId: event.id, data: event.data });
    return;
  }

  if (event.type === "exit") {
    emit(window, {
      type: "terminal.exit",
      terminalId: event.id,
      exitCode: event.exit_code ?? 0,
    });
    terminals.delete(event.id);
    return;
  }

  if (event.type === "error" && event.id) {
    emit(window, {
      type: "terminal.data",
      terminalId: event.id,
      data: `\r\n[pty-host error] ${event.message}\r\n`,
    });
  }
}

function ensureHost(window: BrowserWindow): ChildProcessWithoutNullStreams {
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

      handleHostEvent(window, JSON.parse(line) as HostEvent);
    }
  });

  host.stderr.on("data", (chunk) => {
    console.error("[modus-pty-host]", chunk.toString("utf8"));
  });

  host.on("exit", () => {
    host = undefined;
    for (const terminal of terminals.values()) {
      emit(window, {
        type: "terminal.exit",
        terminalId: terminal.info.id,
        exitCode: 1,
      });
    }
    terminals.clear();
  });

  return host;
}

export function createTerminal(
  window: BrowserWindow,
  input: { workspaceId: string; cwd: string; cols?: number; rows?: number },
): TerminalInfo {
  ensureHost(window);

  const shell = defaultShell();
  const cols = input.cols ?? 80;
  const rows = input.rows ?? 24;
  const id = randomUUID();
  const info = {
    id,
    workspaceId: input.workspaceId,
    cwd: input.cwd,
    shell,
    cols,
    rows,
  };

  terminals.set(id, { info, output: "" });
  writeHost({
    type: "spawn",
    id,
    shell,
    cwd: input.cwd || process.cwd(),
    cols,
    rows,
  });

  return info;
}

export function writeTerminal(terminalId: string, data: string): void {
  if (terminals.has(terminalId)) {
    writeHost({ type: "write", id: terminalId, data });
  }
}

export function resizeTerminal(terminalId: string, cols: number, rows: number): void {
  if (terminals.has(terminalId)) {
    writeHost({ type: "resize", id: terminalId, cols, rows });
  }
}

export function killTerminal(terminalId: string): void {
  const terminal = terminals.get(terminalId);

  if (!terminal) {
    return;
  }

  writeHost({ type: "kill", id: terminalId });
  terminals.delete(terminalId);
}

export function listTerminals(): TerminalInfo[] {
  return [...terminals.values()].map((terminal) => terminal.info);
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
