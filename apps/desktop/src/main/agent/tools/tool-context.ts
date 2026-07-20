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
 * chain; the cwd cache is only a fallback for older call paths.
 */
export type AgentToolContext = {
  workspaceId: string;
  cwd: string;
  sessionId: string;
  profile?: ToolProfileName;
  parentSessionId?: string;
  window?: BrowserWindowType;
  visualDraft?: {
    ref: string;
    title: string;
    kind: "html" | "svg";
    content: string;
  };
  /** Persists + pushes an agent event (recordAgentEvent + webContents.send). */
  emit?: EmitAgentEvent;
};

const contextByCwd = new Map<string, AgentToolContext>();
const activeContext = new AsyncLocalStorage<AgentToolContext>();
let lastContext: AgentToolContext | undefined;

export function setAgentToolContext(context: AgentToolContext): void {
  contextByCwd.set(context.cwd, context);
  lastContext = context;
}

export function runWithAgentToolContext<T>(
  context: AgentToolContext,
  fn: () => Promise<T>,
): Promise<T> {
  setAgentToolContext(context);
  return activeContext.run(context, fn);
}

export function resolveAgentToolContext(cwd: string): AgentToolContext {
  return (
    activeContext.getStore() ??
    contextByCwd.get(cwd) ??
    lastContext ?? {
      workspaceId: "",
      cwd,
      sessionId: "",
    }
  );
}
