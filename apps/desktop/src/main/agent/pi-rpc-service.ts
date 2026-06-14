import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { app, type BrowserWindow as BrowserWindowType } from "electron";
import type { AgentEvent, AgentSessionInfo } from "../../shared/contracts";
import { IPC_CHANNELS } from "../ipc/channels";
import { recordAgentEvent } from "./agent-event-store";
import { createAgentSessionRecord, updateAgentSessionStatus } from "./agent-store";
import { readJsonLines } from "./jsonl";

type RuntimeSession = {
  info: AgentSessionInfo;
  process: ChildProcessWithoutNullStreams;
  messageId?: string;
};

const sessions = new Map<string, RuntimeSession>();

function emit(window: BrowserWindowType, event: AgentEvent): void {
  recordAgentEvent(event);
  window.webContents.send(IPC_CHANNELS.agentEvent, event);
}

function stringifyLine(line: unknown): string {
  return typeof line === "string" ? line : JSON.stringify(line, null, 2);
}

export function createPiRpcSession(
  window: BrowserWindowType,
  input: { workspaceId: string; cwd: string; title: string },
): AgentSessionInfo {
  const info = createAgentSessionRecord({ ...input, runtime: "pi-rpc" });
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
        const session = sessions.get(info.id);
        if (!session?.messageId) {
          const messageId = `rpc:${info.id}`;
          if (session) {
            session.messageId = messageId;
          }
          emit(window, {
            type: "message.started",
            sessionId: info.id,
            messageId,
            role: "assistant",
          });
        }
        emit(window, {
          type: "message.delta",
          sessionId: info.id,
          messageId: session?.messageId ?? `rpc:${info.id}`,
          delta: stringifyLine(line),
        });
      });
    } catch (error) {
      emit(window, {
        type: "runtime.error",
        sessionId: info.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  child.stderr.on("data", (chunk) => {
    emit(window, { type: "runtime.error", sessionId: info.id, message: chunk.toString("utf8") });
  });

  child.on("spawn", () => {
    updateAgentSessionStatus(info.id, "idle");
    emit(window, { type: "agent.started", sessionId: info.id });
  });

  child.on("error", (error) => {
    updateAgentSessionStatus(info.id, "error");
    emit(window, { type: "runtime.error", sessionId: info.id, message: error.message });
  });

  child.on("exit", () => {
    updateAgentSessionStatus(info.id, "exited");
    const session = sessions.get(info.id);
    if (session?.messageId) {
      emit(window, { type: "message.completed", sessionId: info.id, messageId: session.messageId });
    }
    emit(window, { type: "agent.ended", sessionId: info.id });
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
