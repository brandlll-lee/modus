import type { BrowserWindow as BrowserWindowType } from "electron";
import type {
  AgentEvent,
  AgentMode,
  AgentRunInfo,
  AgentSessionInfo,
  ContextItem,
  ModelInfo,
  PromptDelivery,
  PromptImageAttachment,
  ThinkingLevel,
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
  /** Execution mode for this turn. Defaults to `build`. */
  mode?: AgentMode;
  /**
   * Model + thinking for THIS turn. The composer's current selection travels with
   * every prompt and is applied authoritatively at turn start, so a turn is
   * self-describing and never runs with stale model/thinking — surviving
   * mid-session switches, rollback/edit-resend, and session resume without
   * relying on session-state plumbing. Omitted ⇒ keep the session's current model.
   */
  model?: string;
  thinkingLevel?: ThinkingLevel;
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
