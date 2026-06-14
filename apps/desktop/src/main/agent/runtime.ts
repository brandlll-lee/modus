import type { BrowserWindow as BrowserWindowType } from "electron";
import type {
  AgentEvent,
  AgentRunInfo,
  AgentSessionInfo,
  ContextItem,
  ModelInfo,
  PromptDelivery,
  PromptImageAttachment,
} from "../../shared/contracts";

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
  delivery?: PromptDelivery;
  userMessageId?: string;
  attachments?: PromptImageAttachment[];
  /** Skill ids/names invoked with `/name` in the composer for this prompt. */
  skills?: string[];
};

export type AgentRuntime = {
  create(window: BrowserWindowType, input: CreateAgentRuntimeInput): Promise<AgentSessionInfo>;
  ensure(window: BrowserWindowType, sessionId: string): Promise<AgentSessionInfo>;
  prompt(window: BrowserWindowType, input: PromptAgentInput): Promise<void>;
  abort(sessionId: string): Promise<void>;
  listRuns(sessionId: string): Promise<AgentRunInfo[]>;
  dispose(sessionId: string): Promise<void>;
  setModel(
    window: BrowserWindowType,
    sessionId: string,
    model: string,
    thinkingLevel?: string,
  ): Promise<AgentSessionInfo>;
  cycleModel(
    window: BrowserWindowType | undefined,
    sessionId: string | undefined,
    direction?: "forward" | "backward",
  ): Promise<ModelInfo>;
};

export type EmitAgentEvent = (event: AgentEvent) => void;
