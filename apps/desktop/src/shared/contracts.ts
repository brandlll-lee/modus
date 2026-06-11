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
  createdAt: string;
  updatedAt: string;
};

export type AgentRunStatus = "running" | "completed" | "failed" | "blocked" | "cancelled";

export type PromptDelivery = "normal" | "steer" | "follow-up";

/** Image attached to a prompt. `data` is the base64 payload (no data: prefix). */
export type PromptImageAttachment = {
  type: "image";
  data: string;
  mimeType: string;
  /** Original file name, shown in the timeline chip. */
  name?: string | undefined;
};

export type ContextUsageInfo = {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
};

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

/**
 * A point-in-time snapshot of the session's working tree, taken before each
 * run so any agent change can be rolled back from the timeline.
 */
export type CheckpointInfo = {
  id: string;
  sessionId: string;
  /** Run this checkpoint was taken for (absent for restore backups). */
  runId?: string;
  /** User message the checkpoint precedes — anchors the timeline UI. */
  userMessageId?: string;
  cwd: string;
  commitHash: string;
  /** "auto" before a run; "restore-backup" taken right before a restore. */
  kind: "auto" | "restore-backup";
  createdAt: string;
};

/**
 * Result of `agent:rollback` — rewinding a session to just before one of its
 * user messages (Cursor-style "edit & resend"). Conversation history from that
 * message onward is removed and, when a pre-run snapshot exists, the working
 * tree is restored to the state captured before that message ran.
 */
export type AgentRollbackResult = {
  sessionId: string;
  /** The user message the session was rolled back to. */
  userMessageId: string;
  /** True when a pre-run snapshot existed and workspace files were restored. */
  filesRestored: boolean;
  /** The checkpoint used to restore files, when one existed. */
  checkpointId?: string;
  /** Number of runs removed from the session history. */
  removedRuns: number;
};

/* ── Agent to-dos (live task list, Cursor-style) ───────────────────────── */

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type TodoItem = {
  /** Stable id within the session (assigned by the todo tool when omitted). */
  id: string;
  content: string;
  status: TodoStatus;
};

/* ── Project rules (AGENTS.md / .cursor/rules) ─────────────────────────── */

/** Which config family a detected rule file belongs to. */
export type RuleSource = "agents-md" | "claude-md" | "cursorrules" | "cursor-rule";

/** How a rule is applied (mirrors Cursor's .mdc semantics). */
export type RuleMode = "always" | "glob" | "intelligent" | "manual";

export type RuleFileInfo = {
  /** Absolute path of the rule file. */
  path: string;
  /** Path relative to the workspace root (display). */
  relPath: string;
  source: RuleSource;
  mode: RuleMode;
  description?: string;
  globs?: string;
  /** File size in bytes. */
  size: number;
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
      /** What this turn changed on disk (vs the pre-run snapshot). */
      changes?: WorkingChangeStats;
    }
  | { type: "run.failed"; sessionId: string; runId: string; message: string }
  | { type: "run.blocked"; sessionId: string; runId: string; requestId: string; reason: string }
  | { type: "run.cancelled"; sessionId: string; runId: string }
  | {
      type: "message.started";
      sessionId: string;
      messageId: string;
      role: "assistant" | "user";
      /** Images the user attached to this message (user role only). */
      attachments?: PromptImageAttachment[];
    }
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
  | { type: "context.updated"; sessionId: string; usage: ContextUsageInfo }
  | { type: "review.started"; sessionId: string; reviewId: string }
  | { type: "review.completed"; sessionId: string; review: AgentReviewResult }
  | { type: "review.failed"; sessionId: string; reviewId: string; message: string }
  | { type: "checkpoint.created"; sessionId: string; checkpoint: CheckpointInfo }
  | { type: "checkpoint.restored"; sessionId: string; checkpointId: string }
  | { type: "todos.updated"; sessionId: string; todos: TodoItem[] }
  | { type: "runtime.error"; sessionId: string; message: string };

export type TerminalStatus = "running" | "exited";

/** Who opened the terminal: an interactive user shell, or an agent-run command. */
export type TerminalOrigin = "user" | "agent";

export type TerminalInfo = {
  id: string;
  workspaceId: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  /** "running" while the PTY is live; "exited" once the process ends. */
  status: TerminalStatus;
  /** Distinguishes user-opened shells from agent-run command terminals. */
  origin: TerminalOrigin;
  /** The command line an agent ran here (absent for interactive shells). */
  command?: string;
  /** Short label shown in the panel tab / tool cards. */
  title?: string;
  /** Modus agent session that spawned it, when origin === "agent". */
  sessionId?: string;
  /** OS process id, once spawned. */
  pid?: number;
  /** Exit code, once status === "exited". */
  exitCode?: number;
  /** ISO timestamp when the terminal started. */
  startedAt: string;
  /** ISO timestamp when the process exited. */
  endedAt?: string;
};

export type TerminalEvent =
  | { type: "terminal.created"; terminal: TerminalInfo }
  | { type: "terminal.data"; terminalId: string; data: string }
  | {
      type: "terminal.exit";
      terminalId: string;
      exitCode: number;
      signal?: number;
    };

export type FileChange = {
  path: string;
  status: string;
  staged?: boolean;
  unstaged?: boolean;
  untracked?: boolean;
  renamedFrom?: string;
};

export type DiffMode = "unstaged" | "staged" | "working-state";

/** Per-file line counters for change summaries (turn cards / composer strip). */
export type FileChangeStat = {
  path: string;
  /** Lines added ("+" side). 0 for binary files. */
  added: number;
  /** Lines removed ("-" side). 0 for binary files. */
  removed: number;
  /** True for files git does not track yet (counts come from the file body). */
  untracked: boolean;
  /** True when either side of the diff is binary (counters are 0). */
  binary: boolean;
};

/**
 * Aggregated change summary — used for the working tree (composer strip,
 * apply review) and for a single completed turn (timeline changes card).
 */
export type WorkingChangeStats = {
  files: FileChangeStat[];
  /** Total lines added across files. */
  added: number;
  /** Total lines removed across files. */
  removed: number;
  fileCount: number;
  /** True when the file list was capped for IPC size. */
  truncated: boolean;
};

export type FileDiff = {
  path: string;
  diff: string;
  mode?: DiffMode;
};

/**
 * Full before/after contents of one changed file, powering the rich diff
 * viewer. Sides mirror `git diff` semantics for the requested mode.
 */
export type DiffFileVersions = {
  path: string;
  mode: "unstaged" | "staged";
  original: string;
  modified: string;
  /** Either side contains NUL bytes — render a notice instead of text. */
  binary: boolean;
  /** A side was cut at the byte cap to keep IPC payloads bounded. */
  truncated: boolean;
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

/** Branch / remote / sync state for the git review panel header + commit dialog. */
export type GitStatusSummary = {
  /** Current branch name, or undefined when HEAD is detached. */
  branch?: string;
  /** True when at least one remote is configured. */
  hasRemote: boolean;
  /** True when the current branch tracks an upstream ref. */
  hasUpstream: boolean;
  /** Commits on the current branch not yet on the upstream (push count). */
  ahead: number;
  /** Commits on the upstream not yet local (pull count). */
  behind: number;
  /** Total +added lines across the working tree (staged + unstaged). */
  added: number;
  /** Total -removed lines across the working tree (staged + unstaged). */
  removed: number;
  /** Number of staged files. */
  stagedCount: number;
  /** Number of unstaged (tracked-modified + untracked) files. */
  unstagedCount: number;
};

/** Result of a commit and/or push action surfaced back to the renderer. */
export type GitCommitResult = {
  committed: boolean;
  pushed: boolean;
  /** Short commit hash when a commit was created. */
  commit?: string;
  /** Human-readable git output (commit + push), shown on error or as a toast. */
  output: string;
};

/** A single git branch (local head or remote-tracking ref). */
export type GitBranch = {
  /** Display + checkout name. Locals are short ("main"); remotes keep the remote prefix ("origin/main"). */
  name: string;
  /** True for the currently checked-out local branch. */
  current: boolean;
  /** True for remote-tracking refs (refs/remotes/*). */
  remote: boolean;
  /** Upstream tracking ref for a local branch, when configured. */
  upstream?: string;
};

/** Local + remote branch listing for the commit dialog branch switcher. */
export type GitBranchSummary = {
  /** Current branch name, or undefined when HEAD is detached. */
  current?: string;
  /** Local branches (refs/heads), current first. */
  local: GitBranch[];
  /** Remote-tracking branches (refs/remotes), excluding origin/HEAD. */
  remote: GitBranch[];
};

/** Result of a network/branch git action (checkout, pull, fetch, create branch). */
export type GitActionResult = {
  /** Human-readable git output, shown on error or as a toast. */
  output: string;
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
  /** OpenAI-compatible endpoints: how the thinking/reasoning request field is shaped. */
  thinkingFormat?:
    | "none"
    | "openai"
    | "openrouter"
    | "deepseek"
    | "together"
    | "zai"
    | "qwen"
    | "qwen-chat-template"
    | "string-thinking"
    | undefined;
  supportsUsageInStreaming?: boolean | undefined;
  /**
   * Anthropic-compatible endpoints: send adaptive thinking
   * (`thinking.type: "adaptive"` + `output_config.effort`) instead of the
   * deprecated `budget_tokens` form. Required for Claude Opus 4.7+ class
   * models, where manual budgets return HTTP 400.
   */
  forceAdaptiveThinking?: boolean | undefined;
  /**
   * Anthropic-compatible endpoints: replay thinking blocks whose signatures a
   * relay stripped, instead of downgrading them to plain text.
   */
  allowEmptySignature?: boolean | undefined;
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

/** A custom provider's full stored config, returned for lossless edit round-trips. */
export type CustomProviderModelConfig = {
  id: string;
  name: string;
  api?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  reasoning: boolean;
  input: ModelInputKind[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: ModelCost;
  compat?: JsonObject;
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
};

export type CustomProviderConfig = {
  provider: string;
  name: string;
  baseUrl: string;
  api: string;
  authHeader: boolean;
  headers?: Record<string, string>;
  compat?: JsonObject;
  models: CustomProviderModelConfig[];
};

export type UpdateModelConfigInput = {
  model: string;
  enabled?: boolean | undefined;
  thinkingLevel?: ThinkingLevel | undefined;
  contextWindow?: number | undefined;
  maxTokens?: number | undefined;
};

/**
 * One-shot connectivity probe for the custom provider form: sends a tiny
 * prompt straight through the same pi-ai driver the chat would use, so it
 * validates endpoint + key + protocol + (optionally) the thinking setup
 * before anything is saved.
 */
export type TestCustomProviderInput = {
  /** Existing provider id — lets an edit session reuse the stored API key. */
  provider?: string | undefined;
  baseUrl: string;
  api?: string | undefined;
  /** Blank while editing keeps the stored credential. */
  apiKey?: string | undefined;
  authHeader?: boolean | undefined;
  headers?: Record<string, string> | undefined;
  model: {
    id: string;
    api?: string | undefined;
    baseUrl?: string | undefined;
    headers?: Record<string, string> | undefined;
    reasoning?: boolean | undefined;
    contextWindow?: number | undefined;
    maxTokens?: number | undefined;
    compat?: JsonObject | undefined;
    compatibility?: ModelCompatibilityInput | undefined;
    thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>> | undefined;
  };
};

export type TestCustomProviderResult = {
  ok: boolean;
  /** Round-trip time of the probe request. */
  latencyMs: number;
  /** Reply snippet on success; the provider/transport error on failure. */
  message: string;
  /** True when the probe saw thinking deltas (reasoning models only). */
  sawThinking: boolean;
};

/* ── MCP (Model Context Protocol) ──────────────────────────────────────── */

export type McpTransportKind = "stdio" | "http";

export type McpServerStatus = "connecting" | "connected" | "failed" | "disabled";

export type McpToolInfo = {
  /** Tool name as exposed by the server. */
  name: string;
  /** Namespaced name the agent calls (mcp_<server>_<tool>). */
  registeredName: string;
  description?: string | undefined;
};

export type McpServerInfo = {
  name: string;
  transport: McpTransportKind;
  /** Config file this server came from (project beats user on conflicts). */
  source: string;
  status: McpServerStatus;
  error?: string | undefined;
  tools: McpToolInfo[];
};

/** Settings-form payload for creating/updating a server entry. */
export type McpServerUpsertInput = {
  name: string;
  /** Existing name when editing (handles renames). */
  originalName?: string | undefined;
  transport: McpTransportKind;
  command?: string | undefined;
  args?: string[] | undefined;
  env?: Record<string, string> | undefined;
  url?: string | undefined;
  headers?: Record<string, string> | undefined;
  enabled: boolean;
};

/** Raw (un-interpolated) mcp.json entry + the file it lives in. */
export type RawMcpEntry = {
  source: string;
  entry: Record<string, unknown>;
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

/* ── Skills (Agent Skills, 2026 SKILL.md standard) ─────────────────────── */

export type SkillScope = "workspace" | "user";

/**
 * A discovered agent skill. Skills follow the portable `SKILL.md` standard
 * (YAML frontmatter `name` + `description`, Markdown body of instructions),
 * compatible with Claude/Cursor/opencode skill folders. They can be invoked
 * manually with `/name` in the composer, or surfaced to the agent by relevance.
 */
export type SkillInfo = {
  /** Stable id: `${scope}:${source}:${name}`. */
  id: string;
  /** Slash-invocable name, e.g. "code-review". */
  name: string;
  description: string;
  scope: SkillScope;
  /** Config family the skill came from (".modus", ".cursor", ".claude", …). */
  source: string;
  /** Absolute path of the skill's SKILL.md (or `<name>.md`). */
  path: string;
  /** Tools the skill declares it needs, when present in frontmatter. */
  allowedTools?: string[];
};

/** A skill plus its full Markdown instruction body. */
export type SkillDetail = SkillInfo & { body: string };

export type CreateSkillInput = {
  cwd: string;
  /** Human/slash name; normalized to a kebab-case folder name. */
  name: string;
  description: string;
  /** Markdown instructions written to SKILL.md after frontmatter. */
  body: string;
};
