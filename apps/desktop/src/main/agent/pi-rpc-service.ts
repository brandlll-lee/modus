import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { app, type BrowserWindow } from "electron";
import type { AgentEvent, AgentSessionInfo } from "../../shared/contracts";
import { IPC_CHANNELS } from "../ipc/channels";
import { createAgentSessionRecord, updateAgentSessionStatus } from "./agent-store";
import { readJsonLines } from "./jsonl";

type RuntimeSession = {
  info: AgentSessionInfo;
  process: ChildProcessWithoutNullStreams;
};

const sessions = new Map<string, RuntimeSession>();

function emit(window: BrowserWindow, event: AgentEvent): void {
  window.webContents.send(IPC_CHANNELS.agentEvent, event);
}

export function createPiRpcSession(
  window: BrowserWindow,
  input: { workspaceId: string; cwd: string; title: string },
): AgentSessionInfo {
  const info = createAgentSessionRecord(input);
  const sessionDir = join(app.getPath("userData"), "pi-sessions");
  mkdirSync(sessionDir, { recursive: true });

  const child = spawn("pi", ["--mode", "rpc", "--session-dir", sessionDir, "--name", input.title], {
    cwd: input.cwd,
    windowsHide: true,
  });

  const stdoutState = { buffer: "" };
  child.stdout.on("data", (chunk) => {
    try {
      readJsonLines(chunk, stdoutState, (line) => {
        emit(window, { type: "agent.stdout", sessionId: info.id, line });
      });
    } catch (error) {
      emit(window, {
        type: "agent.error",
        sessionId: info.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  child.stderr.on("data", (chunk) => {
    emit(window, { type: "agent.stderr", sessionId: info.id, data: chunk.toString("utf8") });
  });

  child.on("spawn", () => {
    updateAgentSessionStatus(info.id, "idle");
  });

  child.on("error", (error) => {
    updateAgentSessionStatus(info.id, "error");
    emit(window, { type: "agent.error", sessionId: info.id, message: error.message });
  });

  child.on("exit", (exitCode) => {
    updateAgentSessionStatus(info.id, "exited");
    emit(window, { type: "agent.exit", sessionId: info.id, exitCode });
    sessions.delete(info.id);
  });

  sessions.set(info.id, { info, process: child });
  return info;
}

export function promptPiSession(sessionId: string, message: string): void {
  const session = sessions.get(sessionId);

  if (!session) {
    throw new Error(`Agent session not running: ${sessionId}`);
  }

  updateAgentSessionStatus(sessionId, "running");
  session.process.stdin.write(`${JSON.stringify({ type: "prompt", message })}\n`);
}

export function abortPiSession(sessionId: string): void {
  const session = sessions.get(sessionId);

  if (!session) {
    return;
  }

  session.process.stdin.write(`${JSON.stringify({ type: "abort" })}\n`);
  updateAgentSessionStatus(sessionId, "idle");
}
