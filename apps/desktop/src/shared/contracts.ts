export type WorkspaceInfo = {
  id: string;
  rootPath: string;
  displayName: string;
  isGitRepository: boolean;
  lastOpenedAt: string;
  /** Pinned projects sort to the top of the sidebar's Projects list. */
  pinned: boolean;
};

export type AgentSessionInfo = {
  id: string;
  workspaceId: string;
  title: string;
  cwd: string;
  status: "starting" | AgentRunStatus | "idle" | "exited" | "error";
  runtime?: "pi-sdk";
  model?: string;
  thinkingLevel?: ThinkingLevel;
  piSessionId?: string;
  piSessionFile?: string;
  pinnedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentRunStatus = "running" | "completed" | "failed" | "cancelled";

export type SessionDeletionResult = { method: "trash" | "unlink" };

export type PromptDelivery = "normal" | "steer" | "follow-up";

/** PI image block. `data` is the base64 payload (no data: prefix). */
export type ImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

export type PromptImageAttachment = ImageContent & {
  /** Original file name, shown in the timeline chip. */
  name?: string | undefined;
  path?: string | undefined;
};

export type ContextUsageInfo = {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
  totals?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
  };
};

export type AgentSessionSnapshot = AgentSessionInfo & { contextUsage?: ContextUsageInfo };

/** Why PI started/finished an auto or manual compaction (authoritative from the SDK). */
export type CompactionReason = "manual" | "threshold" | "overflow";

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

export type QuestionOption = { label: string };

export type QuestionPrompt = {
  id: string;
  /** The question itself, e.g. "Which rendering view?". */
  header: string;
  /** Optional context shown under the header. */
  detail?: string;
  prefill?: string;
  options: QuestionOption[];
};

export type QuestionRequest = {
  id: string;
  sessionId?: string;
  questions: QuestionPrompt[];
};

export type QuestionAnswer = {
  questionId: string;
  /** Labels of the chosen options (empty when only a custom answer was given). */
  selected: string[];
  /** Free-text "Other…" answer, when the user typed one. */
  custom?: string;
};

export type QuestionResponse = {
  requestId: string;
  answers: QuestionAnswer[];
  skipped: boolean;
};

/** PI's processing state; retry counts and deadlines come from SDK events. */
export type SessionRunStatus =
  | { type: "idle" }
  | { type: "busy" }
  | {
      type: "retry";
      attempt: number;
      maxAttempts: number;
      message: string;
      /** Epoch ms when the next attempt fires, for a live countdown. */
      nextAt: number;
    };

export type AgentEvent =
  | { type: "agent.started"; sessionId: string }
  | { type: "turn.started"; sessionId: string }
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
  | { type: "run.cancelled"; sessionId: string; runId: string }
  | {
      type: "retry.ended";
      sessionId: string;
      success?: boolean;
      attempt?: number;
      finalError?: string;
    }
  | {
      type: "message.started";
      sessionId: string;
      messageId: string;
      role: "assistant" | "user";
      /** Images the user attached to this message (user role only). */
      attachments?: PromptImageAttachment[];
      /**
       * User only: context the prompt carried (file/element/browser/…), shown
       * as removable-looking chips in the message bubble so the sent context
       * stays visible after sending (Cursor parity).
       */
      contextChips?: MessageContextChip[];
      /** User only: original context items, used when edit-and-resend reopens the prompt. */
      contextItems?: ContextItem[];
      /** User only: skills explicitly selected for this prompt. */
      skills?: SkillSelection[];
    }
  | { type: "message.delta"; sessionId: string; messageId: string; delta: string }
  | { type: "message.completed"; sessionId: string; messageId: string }
  | { type: "thinking.delta"; sessionId: string; messageId: string; delta: string }
  | { type: "thinking.completed"; sessionId: string; messageId: string }
  | {
      type: "tool.started";
      sessionId: string;
      toolCallId: string;
      toolName: string;
      parentToolCallId?: string;
      label?: string;
      args?: unknown;
    }
  | {
      /** PI's partial arguments. Fields can arrive in any order. */
      type: "tool.delta";
      sessionId: string;
      toolCallId: string;
      toolName: string;
      args?: unknown;
    }
  | {
      type: "tool.output";
      sessionId: string;
      toolCallId: string;
      parentToolCallId?: string;
      output: string;
      images?: ImageContent[];
      details?: unknown;
    }
  | {
      type: "tool.ended";
      sessionId: string;
      toolCallId: string;
      parentToolCallId?: string;
      output?: string;
      images?: ImageContent[];
      details?: unknown;
      isError: boolean;
    }
  | { type: "question.requested"; sessionId: string; request: QuestionRequest }
  | {
      type: "question.resolved";
      sessionId: string;
      requestId: string;
      answers: QuestionAnswer[];
      skipped: boolean;
    }
  | { type: "queue.updated"; sessionId: string; steering: string[]; followUp: string[] }
  | { type: "compaction.started"; sessionId: string; reason: CompactionReason }
  | {
      type: "compaction.ended";
      sessionId: string;
      reason: CompactionReason | undefined;
      aborted: boolean;
      /** PI may continue the same prompt after automatic compaction. */
      willRetry: boolean;
      /** True when PI reported errorMessage (failed compact). */
      failed?: boolean;
      /** Error text, or a short preview of the compaction summary. */
      summary?: string;
    }
  | { type: "context.updated"; sessionId: string; usage: ContextUsageInfo }
  | { type: "session.status"; sessionId: string; status: SessionRunStatus }
  | { type: "session.updated"; sessionId: string; session: AgentSessionSnapshot }
  | {
      type: "extension.notice";
      sessionId: string;
      message: string;
      level: "info" | "warning" | "error";
    }
  | { type: "runtime.error"; sessionId: string; message: string };

export type TerminalStatus = "running" | "exited";

export type TerminalInfo = {
  id: string;
  workspaceId: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  /** "running" while the PTY is live; "exited" once the process ends. */
  status: TerminalStatus;
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
  /** Linked worktree path when this local branch is checked out elsewhere. */
  worktreePath?: string;
};

/** Local and remote branches for the workspace branch selector. */
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
  kind?: "ok" | "worktree";
  branch?: string;
  worktreePath?: string;
};

export type GitChangeEvent = {
  cwd: string;
  kind: "working" | "index" | "head" | "refs" | "remote-refs" | "config" | "lock";
};

export type ContextKind = "file" | "folder";

export type ContextItem = { type: "file" | "folder"; path: string };

export type ContextSuggestion = {
  id: string;
  type: ContextKind;
  label: string;
  detail: string;
  item: ContextItem;
};

/**
 * A compact, display-only summary of one context item, attached to a sent user
 * message so its chips persist in the timeline bubble (the full `ContextItem`
 * is resolved server-side and not needed for rendering).
 */
export type MessageContextChip = {
  kind: ContextKind;
  /** Primary chip text, e.g. `MDXContent · div "pip install…"` or `app.tsx`. */
  label: string;
  /** Secondary hover detail, e.g. `src/app.tsx:42` for a design element. */
  detail?: string;
};

/* ── Browser (Cursor-compatible in-app browser) ───────────────────────── */

export type BrowserTabInfo = {
  id: string;
  workspaceId: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  devtoolsOpen: boolean;
  createdAt: string;
  updatedAt: string;
  favicon?: string;
};

export type BrowserRecentInfo = {
  id: string;
  workspaceId: string;
  url: string;
  title: string;
  lastOpenedAt: string;
  createdAt: string;
  favicon?: string;
};

export type BrowserEvent =
  | { type: "browser.created"; tab: BrowserTabInfo }
  | { type: "browser.updated"; tab: BrowserTabInfo }
  | { type: "browser.closed"; workspaceId: string; tabId: string }
  | { type: "browser.selected"; workspaceId: string; tabId: string }
  | never
  | {
      type: "browser.find-result";
      workspaceId: string;
      tabId: string;
      matches: number;
      activeMatchOrdinal: number;
      finalUpdate: boolean;
    }
  | {
      /** Keyboard shortcut captured inside the page that the UI must act on. */
      type: "browser.shortcut";
      workspaceId: string;
      tabId: string;
      shortcut: "focus-address";
    }
  | never
  | never
  | never;

export type BrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserConsoleMessage = {
  id: string;
  tabId: string;
  level: "debug" | "info" | "warning" | "error";
  text: string;
  url?: string;
  line?: number;
  column?: number;
  createdAt: string;
};

export type BrowserNetworkRequest = {
  id: string;
  tabId: string;
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  resourceType?: string;
  failed?: boolean;
  errorText?: string;
  startedAt: string;
  completedAt?: string;
};

export type ModelInfo = {
  id: string;
  provider: string;
  providerName?: string;
  name: string;
  available: boolean;
  contextWindow?: number;
  maxTokens?: number;
  supportsThinking: boolean;
  thinkingLevel: ThinkingLevel;
  thinkingLevels: ThinkingLevel[];
  thinkingVariant?: string;
  thinkingOptions?: ThinkingOption[];
};

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ThinkingOption = {
  value: string;
  label: string;
  level: ThinkingLevel;
  wireValue?: string | undefined;
};
export type ModelProviderInfo = {
  id: string;
  name: string;
  configured: boolean;
  modelCount: number;
  availableModelCount: number;
  source?: string;
  authSource?: string;
  error?: string;
};

export type ModelProviderDetail = ModelProviderInfo & { models: ModelInfo[] };

export type ModelSettingsState = {
  errors: string[];
  providers: ModelProviderInfo[];
  models: ModelInfo[];
  defaultModel?: string;
};

/* ── Workspace files (file panel) ──────────────────────────────────────── */

/** One entry in a directory listing for the file panel's lazy tree. */
export type FileEntry = {
  name: string;
  /** Absolute path. */
  path: string;
  /** Workspace-root-relative path with forward slashes (stable id + label). */
  relativePath: string;
  kind: "file" | "directory";
};

/** Result of reading a workspace file for preview / edit. */
export type FileReadResult = {
  path: string;
  relativePath: string;
  size: number;
  /** True when the file is binary (no text preview); `content` is empty. */
  binary: boolean;
  /** True when the file exceeded the read cap and `content` is a prefix. */
  truncated: boolean;
  content: string;
};

/**
 * Structured preview capability from authoritative byte inspection (magic /
 * OOXML part peek). UI routes on this enum — never on filename extensions.
 */
export type PreviewKind = "pdf" | "docx" | "xlsx" | "pptx" | "image" | "unsupported";

/** Result of reading workspace file bytes for in-app document/image preview. */
export type PreviewReadResult = {
  path: string;
  relativePath: string;
  size: number;
  previewKind: PreviewKind;
  mime: string;
  /** Raw file bytes (structured-cloneable over IPC). */
  bytes: Uint8Array;
};

/** Result of writing a workspace text file from the file panel editor. */
export type FileWriteResult = {
  path: string;
  relativePath: string;
  size: number;
};

/**
 * Broadcast when a watched workspace changes on disk (agent / terminal /
 * external editor). Drives live refresh of the Files panel. `paths` are
 * absolute; an empty array means the burst had no filenames (full refresh).
 * Conflict policy: disk / AI wins over unsaved local drafts.
 */
export type FilesChangeEvent = {
  cwd: string;
  paths: string[];
};

/* ── Skills (Agent Skills, 2026 SKILL.md standard) ─────────────────────── */

export type ConfigScope = "workspace" | "user";

/**
 * Where a skill was discovered. Values match PI's `SourceScope` plus Modus's
 * bundled resource root, which PI reports as an ordinary additional path.
 */
export type SkillScope = "user" | "project" | "temporary";

export type SkillSelection = {
  name: string;
  /** Absolute path of the selected skill's SKILL.md. */
  path: string;
};

/**
 * A discovered agent skill. Skills follow the portable `SKILL.md` standard
 * (YAML frontmatter `name` + `description`, Markdown body of instructions),
 * compatible with Claude/Cursor/opencode skill folders. They can be invoked
 * manually with `/name` in the composer, or surfaced to the agent by relevance.
 */
export type SkillInfo = {
  /** Slash-invocable name, e.g. "code-review". */
  name: string;
  description: string;
  scope: SkillScope;
  /** Discovery source reported by PI ("pi", "agents", "auto", "local", …). */
  source: string;
  /** Absolute path of the skill's SKILL.md. */
  path: string;
  allowImplicitInvocation: boolean;
};

export type SkillState = {
  skills: SkillInfo[];
  diagnostics: Array<{ type: "warning" | "error" | "collision"; message: string; path?: string }>;
};
