import type { BrowserWindow } from "electron";
import type {
  AgentEvent,
  AgentRunInfo,
  AgentSessionInfo,
  ContextItem,
  ModelInfo,
  PromptDelivery,
} from "../../shared/contracts";

export type CreateAgentRuntimeInput = {
  workspaceId: string;
  cwd: string;
  title: string;
  model?: string;
  worktreeMode?: "auto" | "off";
};

export type PromptAgentInput = {
  sessionId: string;
  message: string;
  context: ContextItem[];
  delivery?: PromptDelivery;
  userMessageId?: string;
};

export type AgentRuntime = {
  create(window: BrowserWindow, input: CreateAgentRuntimeInput): Promise<AgentSessionInfo>;
  prompt(input: PromptAgentInput): Promise<void>;
  abort(sessionId: string): Promise<void>;
  listRuns(sessionId: string): Promise<AgentRunInfo[]>;
  dispose(sessionId: string): Promise<void>;
  setModel(sessionId: string, model: string): Promise<AgentSessionInfo>;
  cycleModel(sessionId: string | undefined, direction?: "forward" | "backward"): Promise<ModelInfo>;
};

export type EmitAgentEvent = (event: AgentEvent) => void;
