import type { BrowserWindow } from "electron";
import type { AgentEvent, AgentSessionInfo, ContextItem, ModelInfo } from "../../shared/contracts";

export type CreateAgentRuntimeInput = {
  workspaceId: string;
  cwd: string;
  title: string;
  model?: string;
};

export type PromptAgentInput = {
  sessionId: string;
  message: string;
  context: ContextItem[];
};

export type AgentRuntime = {
  create(window: BrowserWindow, input: CreateAgentRuntimeInput): Promise<AgentSessionInfo>;
  prompt(input: PromptAgentInput): Promise<void>;
  abort(sessionId: string): Promise<void>;
  dispose(sessionId: string): Promise<void>;
  setModel(sessionId: string, model: string): Promise<AgentSessionInfo>;
  cycleModel(sessionId: string | undefined, direction?: "forward" | "backward"): Promise<ModelInfo>;
};

export type EmitAgentEvent = (event: AgentEvent) => void;
