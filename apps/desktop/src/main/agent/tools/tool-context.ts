import type { BrowserWindow } from "electron";
import type { EmitAgentEvent } from "../runtime";

/**
 * Shared per-session context for process-wide custom tools (terminal, to-dos).
 *
 * Custom tools are registered once and shared across every agent session, so a
 * tool's `execute` has no Modus session identity of its own. Before each
 * prompt, the runtime publishes the session's context keyed by its cwd. Tools
 * resolve it from `ctx.cwd`; `lastContext` is a safe fallback when multiple
 * sessions share the same project checkout.
 */
export type AgentToolContext = {
  workspaceId: string;
  cwd: string;
  sessionId: string;
  window?: BrowserWindow;
  /** Persists + pushes an agent event (recordAgentEvent + webContents.send). */
  emit?: EmitAgentEvent;
};

const contextByCwd = new Map<string, AgentToolContext>();
let lastContext: AgentToolContext | undefined;

export function setAgentToolContext(context: AgentToolContext): void {
  contextByCwd.set(context.cwd, context);
  lastContext = context;
}

export function resolveAgentToolContext(cwd: string): AgentToolContext {
  return contextByCwd.get(cwd) ?? lastContext ?? { workspaceId: "", cwd, sessionId: "" };
}
