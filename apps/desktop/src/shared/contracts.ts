export type WorkspaceInfo = {
  id: string;
  rootPath: string;
  displayName: string;
  isGitRepository: boolean;
  lastOpenedAt: string;
};

export type AgentSessionInfo = {
  id: string;
  workspaceId: string;
  title: string;
  cwd: string;
  status: "starting" | AgentRunStatus | "idle" | "exited" | "error";
  runtime?: "pi-sdk" | "pi-rpc";
  model?: string;
  piSessionId?: string;
  piSessionFile?: string;
  worktreePath?: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentRunStatus = "running" | "completed" | "failed" | "blocked" | "cancelled";

export type PromptDelivery = "normal" | "steer" | "follow-up";

export type AgentRunInfo = {
  id: string;
  sessionId: string;
  userMessageId?: string;
  prompt: string;
  status: AgentRunStatus;
  model?: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
};

export type PermissionRequest = {
  id: string;
  sessionId?: string;
  runId?: string;
  action: PermissionAction;
  target: string;
  reason: string;
  severity?: "medium" | "high" | "danger";
};

export type AgentEvent =
  | { type: "agent.started"; sessionId: string }
  | { type: "agent.ended"; sessionId: string }
  | {
      type: "run.started";
      sessionId: string;
      runId: string;
      userMessageId?: string;
      delivery: PromptDelivery;
    }
  | {
      type: "run.completed";
      sessionId: string;
      runId: string;
      summary?: string;
    }
  | { type: "run.failed"; sessionId: string; runId: string; message: string }
  | { type: "run.blocked"; sessionId: string; runId: string; requestId: string; reason: string }
  | { type: "run.cancelled"; sessionId: string; runId: string }
  | { type: "message.started"; sessionId: string; messageId: string; role: "assistant" | "user" }
  | { type: "message.delta"; sessionId: string; messageId: string; delta: string }
  | { type: "message.completed"; sessionId: string; messageId: string }
  | { type: "thinking.delta"; sessionId: string; messageId: string; delta: string }
  | {
      type: "tool.started";
      sessionId: string;
      toolCallId: string;
      toolName: string;
      args?: unknown;
    }
  | { type: "tool.output"; sessionId: string; toolCallId: string; output: string }
  | { type: "tool.ended"; sessionId: string; toolCallId: string; isError: boolean }
  | { type: "permission.requested"; sessionId: string; request: PermissionRequest }
  | {
      type: "permission.resolved";
      sessionId: string;
      requestId: string;
      decision: PermissionDecision["decision"];
    }
  | { type: "queue.updated"; sessionId: string; steering: string[]; followUp: string[] }
  | { type: "compaction.started"; sessionId: string; reason: string }
  | { type: "compaction.ended"; sessionId: string; summary?: string; aborted: boolean }
  | { type: "review.started"; sessionId: string; reviewId: string }
  | { type: "review.completed"; sessionId: string; review: AgentReviewResult }
  | { type: "review.failed"; sessionId: string; reviewId: string; message: string }
  | { type: "runtime.error"; sessionId: string; message: string };

export type TerminalInfo = {
  id: string;
  workspaceId: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
};

export type TerminalEvent =
  | { type: "terminal.data"; terminalId: string; data: string }
  | { type: "terminal.exit"; terminalId: string; exitCode: number; signal?: number };

export type FileChange = {
  path: string;
  status: string;
  staged?: boolean;
  unstaged?: boolean;
  untracked?: boolean;
  renamedFrom?: string;
};

export type DiffMode = "unstaged" | "staged" | "working-state";

export type FileDiff = {
  path: string;
  diff: string;
  mode?: DiffMode;
};

export type PermissionAction =
  | "shell.execute"
  | "file.write"
  | "file.delete"
  | "git.write"
  | "mcp.call"
  | "external.open";

export type PermissionDecision = {
  id: string;
  action: PermissionAction;
  target: string;
  decision: "allow-once" | "allow-workspace" | "deny";
  createdAt: string;
};

export type WorktreeInfo = {
  path: string;
  branch: string;
  head: string;
};

export type ContextKind =
  | "file"
  | "folder"
  | "doc"
  | "terminal"
  | "git-diff"
  | "project-summary"
  | "recent-changes"
  | "rules"
  | "search";

export type ContextItem =
  | { type: "file"; path: string }
  | { type: "folder"; path: string }
  | { type: "doc"; docId: string; title: string; query?: string }
  | { type: "terminal"; terminalId: string; range?: { fromLine?: number; toLine?: number } }
  | { type: "git-diff"; mode: "working-state" | "branch"; base?: string }
  | { type: "project-summary" }
  | { type: "recent-changes"; limit?: number }
  | { type: "rules" }
  | { type: "search"; query: string };

export type ContextSuggestion = {
  id: string;
  type: ContextKind;
  label: string;
  detail: string;
  item: ContextItem;
};

export type ResolvedContext = {
  item: ContextItem;
  title: string;
  content: string;
};

export type DocSource = {
  id: string;
  workspaceId: string;
  title: string;
  path?: string;
  url?: string;
  createdAt: string;
  updatedAt: string;
};

export type DocHit = {
  sourceId: string;
  chunkId: string;
  title: string;
  heading?: string;
  path?: string;
  snippet: string;
  score: number;
};

export type AddDocInput = {
  workspaceId: string;
  title: string;
  path?: string;
  url?: string;
};

export type ModelInfo = {
  id: string;
  provider: string;
  providerName?: string;
  name: string;
  available: boolean;
  enabled: boolean;
  configured: boolean;
  source: "builtin" | "custom";
  contextWindow?: number;
  maxTokens?: number;
  supportsThinking: boolean;
  thinkingLevel: ThinkingLevel;
  thinkingLevels: ThinkingLevel[];
};

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type ModelInputKind = "text" | "image";

export type JsonObject = Record<string, unknown>;

export type ModelCost = {
  input?: number | undefined;
  output?: number | undefined;
  cacheRead?: number | undefined;
  cacheWrite?: number | undefined;
};

export type ModelProviderInfo = {
  id: string;
  name: string;
  source: "builtin" | "custom";
  configured: boolean;
  authSource?: string;
  authLabel?: string;
  modelCount: number;
  enabledModelCount: number;
  baseUrl?: string;
  api?: string;
  error?: string;
};

export type ProviderModelConfig = {
  id: string;
  name: string;
  enabled: boolean;
  contextWindow?: number;
  maxTokens?: number;
  reasoning: boolean;
  thinkingLevel: ThinkingLevel;
  thinkingLevels: ThinkingLevel[];
};

export type ModelProviderDetail = ModelProviderInfo & {
  models: ProviderModelConfig[];
};

export type ModelSettingsState = {
  providers: ModelProviderInfo[];
  models: ModelInfo[];
  defaultModel?: string;
};

export type ConfigureProviderInput = {
  provider: string;
  apiKey?: string | undefined;
  enabledModelIds?: string[] | undefined;
};

export type ProviderCompatibilityInput = {
  supportsDeveloperRole?: boolean | undefined;
  supportsReasoningEffort?: boolean | undefined;
};

export type ModelCompatibilityInput = {
  thinkingFormat?:
    | "none"
    | "openai"
    | "openrouter"
    | "deepseek"
    | "together"
    | "zai"
    | "qwen"
    | "qwen-chat-template"
    | undefined;
  supportsUsageInStreaming?: boolean | undefined;
};

export type CustomProviderModelInput = {
  id: string;
  name?: string | undefined;
  api?: string | undefined;
  baseUrl?: string | undefined;
  headers?: Record<string, string> | undefined;
  contextWindow?: number | undefined;
  maxTokens?: number | undefined;
  reasoning?: boolean | undefined;
  input?: ModelInputKind[] | undefined;
  cost?: ModelCost | undefined;
  compat?: JsonObject | undefined;
  compatibility?: ModelCompatibilityInput | undefined;
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>> | undefined;
};

export type UpsertCustomProviderInput = {
  provider: string;
  name: string;
  baseUrl: string;
  apiKey?: string | undefined;
  api?: string | undefined;
  authHeader?: boolean | undefined;
  headers?: Record<string, string> | undefined;
  compat?: JsonObject | undefined;
  compatibility?: ProviderCompatibilityInput | undefined;
  models: CustomProviderModelInput[];
};

export type UpdateModelConfigInput = {
  model: string;
  enabled?: boolean | undefined;
  thinkingLevel?: ThinkingLevel | undefined;
  contextWindow?: number | undefined;
  maxTokens?: number | undefined;
};

export type AgentReviewDepth = "fast" | "standard" | "deep";

export type AgentReviewIssue = {
  id: string;
  severity: "low" | "medium" | "high";
  title: string;
  file?: string;
  line?: number;
  detail: string;
};

export type AgentReviewResult = {
  id: string;
  sessionId?: string;
  workspaceId?: string;
  cwd: string;
  depth: AgentReviewDepth;
  status: "completed" | "failed";
  summary: string;
  issues: AgentReviewIssue[];
  createdAt: string;
};
