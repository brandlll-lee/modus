import type { BrowserWindow as BrowserWindowType } from "electron";
import type {
  AgentEvent,
  AgentRunInfo,
  AgentSessionInfo,
  ContextUsageInfo,
  ModelInfo,
  ModelSettingsState,
  PromptDelivery,
  PromptImageAttachment,
  SkillSelection,
  ThinkingLevel,
} from "../../shared/contracts";

export type CreateAgentRuntimeInput = {
  id?: string;
  workspaceId: string;
  cwd: string;
  title: string;
  model?: string;
};

export type PromptAgentInput = {
  sessionId: string;
  message: string;
  paths?: string[];
  delivery?: PromptDelivery;
  userMessageId?: string;
  attachments?: PromptImageAttachment[];
  /** Skills explicitly selected with `/name` in the composer for this prompt. */
  skills?: SkillSelection[];

  model?: string;
  thinkingLevel?: ThinkingLevel;
  thinkingVariant?: string;
};

export type AgentRuntime = {
  assertIdle(): void;
  reloadConfiguration(): Promise<ModelSettingsState>;
  create(window: BrowserWindowType, input: CreateAgentRuntimeInput): Promise<AgentSessionInfo>;
  ensure(
    window: BrowserWindowType,
    sessionId: string,
  ): Promise<AgentSessionInfo & { contextUsage?: ContextUsageInfo }>;
  prompt(window: BrowserWindowType, input: PromptAgentInput): Promise<void>;
  navigate(window: BrowserWindowType, sessionId: string, messageId: string): Promise<void>;
  compact(window: BrowserWindowType, sessionId: string): Promise<void>;
  abort(sessionId: string): Promise<string[]>;
  listRuns(sessionId: string): Promise<AgentRunInfo[]>;
  dispose(sessionId: string): Promise<void>;
  /** Release an idle SDK runtime while preserving the conversation and managed processes. */
  releaseRuntime(sessionId: string): Promise<void>;
  setModel(
    window: BrowserWindowType,
    sessionId: string,
    model: string,
    thinkingVariant?: string,
  ): Promise<AgentSessionInfo>;
  cycleModel(
    window: BrowserWindowType | undefined,
    sessionId: string | undefined,
    direction?: "forward" | "backward",
  ): Promise<ModelInfo>;
};

export type EmitAgentEvent = (event: AgentEvent) => void;
