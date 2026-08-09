import { AsyncLocalStorage } from "node:async_hooks";
import type { BrowserWindow as BrowserWindowType } from "electron";
import type { ToolProfileName } from "../../../shared/tools";
import type { EmitAgentEvent } from "../runtime";

/**
 * Shared per-session context for process-wide custom tools (terminal, to-dos).
 *
 * Custom tools are registered once and shared across every agent session, so a
 * tool's `execute` has no Modus session identity of its own. During a prompt,
 * AsyncLocalStorage carries the owning session through the real async execution
 * chain. Missing ownership is an error; cwd is not a session identity.
 */
export type AgentToolContext = {
  workspaceId: string;
  cwd: string;
  sessionId: string;
  profile?: ToolProfileName;
  parentSessionId?: string;
  window?: BrowserWindowType;
  /** Persists + pushes an agent event (recordAgentEvent + webContents.send). */
  emit?: EmitAgentEvent;
};

const activeContext = new AsyncLocalStorage<AgentToolContext>();

export function setAgentToolContext(context: AgentToolContext): void {
  activeContext.enterWith(context);
}

export function runWithAgentToolContext<T>(
  context: AgentToolContext,
  fn: () => Promise<T>,
): Promise<T> {
  return activeContext.run(context, fn);
}

export function resolveAgentToolContext(_cwd: string): AgentToolContext {
  const context = activeContext.getStore();
  if (!context) throw new Error("Agent tool has no owning Modus session.");
  return context;
}
