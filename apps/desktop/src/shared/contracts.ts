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
  runtime?: "pi-sdk" | "pi-rpc";
  model?: string;
  piSessionId?: string;
  piSessionFile?: string;
  parentSessionId?: string;
  subagentTask?: string;
  subagentType?: string;
  subagentReadOnly?: boolean;
  subagentWorktree?: SubagentWorktreeInfo;
  createdAt: string;
  updatedAt: string;
};

export type AgentRunStatus = "running" | "completed" | "failed" | "blocked" | "cancelled";

export type SubagentWorktreeInfo = {
  path: string;
  branch: string;
  baseSha: string;
  integrationStatus: "running" | "ready" | "no_changes" | "applied" | "conflict" | "cleaned";
  changedFiles?: string[];
  conflictFiles?: string[];
};

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

/* ── Global personalization (Codex-style AGENTS.md guidance) ───────────── */

export type PersonalizationState = {
  basePath: string;
  overridePath: string;
  activePath: string;
  overrideActive: boolean;
  content: string;
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

/* ── Interactive questions (ask_user, Cursor-style) ────────────────────── */

export type QuestionOption = {
  /** Choice text shown on the option row and returned when selected. */
  label: string;
  /** Optional one-line clarifier under the label. */
  description?: string;
  /** Marks the planner's suggested default (rendered "— recommended"). */
  recommended?: boolean;
};

export type QuestionPrompt = {
  /** Stable id within the request (assigned by the ask_user tool). */
  id: string;
  /** The question itself, e.g. "Which rendering view?". */
  header: string;
  /** Optional context shown under the header. */
  detail?: string;
  /** true → multiple options may be chosen; false → single choice. */
  multiSelect: boolean;
  options: QuestionOption[];
};

export type QuestionRequest = {
  id: string;
  sessionId?: string;
  runId?: string;
  questions: QuestionPrompt[];
};

export type QuestionAnswer = {
  questionId: string;
  /** Labels of the chosen options (empty when only a custom answer was given). */
  selected: string[];
  /** Free-text "Other…" answer, when the user typed one. */
  custom?: string;
};

/** Resolution of an ask_user round-trip — answers, or `skipped` when dismissed. */
export type QuestionResponse = {
  requestId: string;
  answers: QuestionAnswer[];
  skipped: boolean;
};

/**
 * Authoritative run-status for a session, mirrored from the runtime's real
 * processing state (pi's streaming turn + its internal auto-retry). This — not
 * a reconstruction from the run-event log — is the single source of truth the
 * composer's lock/border follow. Aligned with opencode's SessionStatus:
 *
 * - `idle`  — no turn is processing; the composer accepts a new prompt.
 * - `busy`  — a turn is streaming; the composer is locked, border animates.
 * - `retry` — a transient error was hit and the runtime is auto-retrying. The
 *   turn is STILL working, so the composer stays locked; the UI shows a single
 *   non-fatal line ("retrying … attempt N/M") instead of a red error. Carries
 *   the authoritative `attempt`/`maxAttempts` from the runtime and `nextAt` for
 *   a live countdown.
 */
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

export type SubagentActivity =
  | { kind: "tool"; name: string }
  | { kind: "thinking" }
  | { kind: "writing" };

export type SubagentStatus = "running" | "completed" | "failed" | "blocked" | "cancelled";

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
      /**
       * User only: present when this message is a "Build this plan" action. The
       * timeline renders it as a compact Build card (title + N To-dos) instead
       * of the raw build instruction text.
       */
      planBuild?: { planId: string; title: string; todoCount: number };
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
  | {
      /**
       * Live, non-persisted progress for a tool call while the model is still
       * streaming its arguments (path first, then content). Carries the
       * best-effort partial args so the tool card renders immediately and its
       * diff +/- counts grow in real time — instead of appearing only once the
       * whole (possibly huge) call has been generated. Same shape as
       * `tool.started`; the durable `tool.started` supersedes it on completion.
       */
      type: "tool.delta";
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
  | { type: "question.requested"; sessionId: string; request: QuestionRequest }
  | {
      type: "question.resolved";
      sessionId: string;
      requestId: string;
      answers: QuestionAnswer[];
      skipped: boolean;
    }
  | { type: "queue.updated"; sessionId: string; steering: string[]; followUp: string[] }
  | { type: "compaction.started"; sessionId: string; reason: string }
  | { type: "compaction.ended"; sessionId: string; summary?: string; aborted: boolean }
  | { type: "context.updated"; sessionId: string; usage: ContextUsageInfo }
  | { type: "review.started"; sessionId: string; reviewId: string }
  | { type: "review.completed"; sessionId: string; review: AgentReviewResult }
  | { type: "review.failed"; sessionId: string; reviewId: string; message: string }
  | { type: "plan.updated"; sessionId: string; plan: PlanRef }
  | { type: "checkpoint.created"; sessionId: string; checkpoint: CheckpointInfo }
  | { type: "checkpoint.restored"; sessionId: string; checkpointId: string }
  | { type: "todos.updated"; sessionId: string; todos: TodoItem[] }
  | {
      type: "subagent.started";
      sessionId: string;
      childSessionId: string;
      task: string;
      subagentType: string;
      background: boolean;
      model?: string;
    }
  | {
      type: "subagent.updated";
      sessionId: string;
      childSessionId: string;
      status: SubagentStatus;
      activity?: SubagentActivity;
    }
  | { type: "session.status"; sessionId: string; status: SessionRunStatus }
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

/**
 * Unified "managed process" — the single source of truth that backs both the
 * composer running-process bar and the right-panel terminal grouping. A managed
 * process is either a PTY-backed terminal or a detached GUI app, opened by a
 * user or an agent. Both UIs render the same shape and filter it by scope, so a
 * new process kind only needs a mapper to appear everywhere.
 */
export type ManagedProcessKind = "terminal" | "app";
export type ManagedProcessOrigin = TerminalOrigin;
export type ManagedProcessStatus = TerminalStatus;

export type ManagedProcessInfo = {
  id: string;
  kind: ManagedProcessKind;
  origin: ManagedProcessOrigin;
  /** Workspace that owns the process (always set for user terminals). */
  workspaceId?: string;
  /** Agent session that started it; the isolation key for agent processes. */
  sessionId?: string;
  /** Human-readable label: the agent command, app name, or shell name. */
  label: string;
  status: ManagedProcessStatus;
  /** ISO timestamp when the process started; drives the elapsed timer. */
  startedAt: string;
  pid?: number;
  /** Window title for GUI apps. */
  windowTitle?: string;
  exitCode?: number;
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
  | "external.open"
  | "browser.control";

export type PermissionDecision = {
  id: string;
  action: PermissionAction;
  target: string;
  decision: "allow-once" | "allow-workspace" | "deny";
  createdAt: string;
};

/**
 * Global approval mode chosen in the composer. Collapses Codex's
 * approval×sandbox preset into a single "when to prompt" axis (Modus has no OS
 * sandbox): the decision logic + per-mode metadata live in `shared/approval.ts`.
 */
export type ApprovalMode = "request-approval" | "auto" | "full-access";

/**
 * Composer execution mode. `build` is the normal coding agent. `plan` runs the
 * read-only planning harness (research + write a single plan.md via plan_write;
 * no edit/write/bash). Carried per-prompt so the user can toggle it freely.
 */
export type AgentMode = "build" | "plan";

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
  /** True while Git has an unfinished merge in this checkout. */
  mergeInProgress: boolean;
  /** Files with unresolved merge entries, when any. */
  conflictFiles: string[];
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
  /** Linked worktree path when this local branch is checked out elsewhere. */
  worktreePath?: string;
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
  kind?: "ok" | "worktree";
  branch?: string;
  worktreePath?: string;
};

/**
 * Broadcast when a watched repository changes on disk (commit, stage, branch
 * switch, fetch, or a working-tree edit). Drives live refresh of the Changes
 * panel + commit dialog. `kind` is the most-specific area that changed in the
 * debounced burst, so the renderer can refresh narrowly if it wants.
 */
export type GitChangeEvent = {
  cwd: string;
  kind: "working" | "index" | "head" | "refs" | "remote-refs" | "config" | "lock";
};

/**
 * One commit in the Source Control "All commits" scope. Files are fetched
 * lazily per commit (on expand) via `diff.commitChanges`, mirroring how the
 * working tree loads file versions on demand — keeps the log payload bounded.
 */
export type GitCommit = {
  /** Full 40-char object id (used as the authoritative diff base). */
  hash: string;
  /** Abbreviated id for display. */
  shortHash: string;
  /** First line of the commit message. */
  subject: string;
  /** Author name. */
  author: string;
  /** Author date, ISO 8601. */
  date: string;
  /** Human relative date ("3 hours ago"), from git itself. */
  relativeDate: string;
};

export type ContextKind =
  | "file"
  | "folder"
  | "doc"
  | "terminal"
  | "browser"
  | "git-diff"
  | "past-chat"
  | "project-summary"
  | "recent-changes"
  | "rules"
  | "search"
  | "design-element";

export type ContextItem =
  | { type: "file"; path: string }
  | { type: "folder"; path: string }
  | { type: "doc"; docId: string; title: string; query?: string }
  | { type: "terminal"; terminalId: string; range?: { fromLine?: number; toLine?: number } }
  | { type: "browser"; workspaceId?: string; viewId?: string }
  | { type: "git-diff"; mode: "working-state" | "branch"; base?: string }
  | { type: "past-chat"; sessionId: string; title: string }
  | { type: "project-summary" }
  | { type: "recent-changes"; limit?: number }
  | { type: "rules" }
  | { type: "search"; query: string }
  /**
   * A page element captured from the in-app browser's Design Mode (point-and-
   * select). Self-contained: the payload is a point-in-time snapshot of the
   * element (the live page may have changed by the time the agent reads it), so
   * unlike file/doc refs it is NOT re-resolved from an id — `resolveContext`
   * just formats `element` into model-readable text.
   */
  | { type: "design-element"; element: DesignElementPayload };

/**
 * A point-in-time capture of a DOM element selected via the browser's Design
 * Mode. Built in the page (identity/source via React fiber `_debugSource`,
 * with a DOM-path fallback) + main process (element-clipped screenshot), then
 * carried verbatim into the chat composer as a removable chip + thumbnail.
 */
export type DesignElementPayload = {
  /** Stable id for de-dup / removal in the composer. */
  id: string;
  /** Browser tab the element was captured from. */
  tabId: string;
  /** Page URL at capture time. */
  url: string;
  /** Chip label, e.g. `MDXContent · span "Kimi K2.7 Co…"`. */
  label: string;
  /** Lowercased tag name, e.g. "span". */
  tagName: string;
  /** React component display name (fiber `_debugOwner`), when resolvable. */
  componentName?: string;
  /** Source location from React fiber `_debugSource` (dev builds only). */
  source?: { file: string; line: number; column?: number };
  /** Stable CSS selector — the universal fallback when there's no source map. */
  domPath: string;
  /** Truncated visible text. */
  text?: string;
  /** A few salient computed styles (color/font/spacing/layout…) for the model. */
  styleSummary?: Record<string, string>;
  /**
   * Salient HTML attributes (id, class, href, role, aria-*, type, name, alt,
   * title, placeholder, value, data-*…) — Cursor parity for element identity.
   */
  attributes?: Record<string, string>;
  /**
   * Ancestor chain (nearest first, ~4 levels), giving the element's position in
   * the page structure: tag + id + classes + role + short text per level.
   */
  ancestors?: Array<{
    tag: string;
    id?: string;
    classes?: string;
    role?: string;
    text?: string;
  }>;
  /** Serializable React props from the element's host fiber (primitives only). */
  props?: Record<string, string>;
  /** Element bounding box in CSS pixels (root viewport). */
  rect: { x: number; y: number; width: number; height: number };
  /** Element-clipped screenshot as a data URL (PNG). Shown as a thumbnail. */
  screenshotDataUrl?: string;
};

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

export type ResolvedContext = {
  item: ContextItem;
  title: string;
  content: string;
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
  locked: boolean;
  createdAt: string;
  updatedAt: string;
  favicon?: string;
};

export type BrowserEvent =
  | { type: "browser.created"; tab: BrowserTabInfo }
  | { type: "browser.updated"; tab: BrowserTabInfo }
  | { type: "browser.closed"; workspaceId: string; tabId: string }
  | { type: "browser.selected"; workspaceId: string; tabId: string }
  | {
      /** An agent-initiated navigation — the renderer auto-reveals the browser panel. */
      type: "browser.agent-activity";
      workspaceId: string;
      tabId: string;
    }
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
      shortcut: "focus-address" | "toggle-design";
    }
  | {
      /** Design Mode toggled (from the toolbar, a shortcut, or page-side). */
      type: "browser.design-mode-changed";
      workspaceId: string;
      tabId: string;
      enabled: boolean;
    }
  | {
      /** User selected an element in Design Mode and asked to add it to chat. */
      type: "browser.design-select";
      workspaceId: string;
      tabId: string;
      element: DesignElementPayload;
    };

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
  thinkingVariant?: string;
  thinkingOptions?: ThinkingOption[];
};

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type ThinkingOption = {
  value: string;
  label: string;
  level: ThinkingLevel;
};
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
  thinkingVariant?: string;
  thinkingOptions?: ThinkingOption[];
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
  /**
   * Optional custom endpoint for a built-in provider: relay the provider's
   * native protocol through an OpenAI/Anthropic/Google-compatible gateway.
   * `undefined` leaves the current setting untouched; an empty string reverts
   * to the official endpoint; a URL overrides every built-in model's base URL.
   */
  baseUrl?: string | undefined;
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
  thinkingVariant?: string | undefined;
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
  /** New servers land in the selected config scope; existing servers write back to source. */
  scope?: "user" | "project" | undefined;
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

/* ── Workspace files (read-only file panel) ────────────────────────────── */

/** One entry in a directory listing for the file panel's lazy tree. */
export type FileEntry = {
  name: string;
  /** Absolute path. */
  path: string;
  /** Workspace-root-relative path with forward slashes (stable id + label). */
  relativePath: string;
  kind: "file" | "directory";
};

/** Result of reading a workspace file for preview. */
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

/* ── Plan Mode ─────────────────────────────────────────────────────────── */

/**
 * A plan produced by Plan Mode — a single markdown artifact that is the durable
 * source of truth for a feature, editable by both human and agent, and the
 * shared input to single-agent or fusion execution. Stored outside the repo by
 * default (not version-controlled); `savedToWorkspace` flips when the user
 * copies it into `<repo>/.modus/specs/<slug>/`.
 */
/**
 * A single plan task. Authored by the planner via `plan_write` (structured, not
 * parsed from markdown), so it is the authoritative source for the Build card's
 * "N To-dos" and the Plan panel's checklist. `status` is `pending` until the
 * v2 runtime binds live `todo_write` progress; v1 never fakes completion.
 */
export type PlanTodo = { id: string; content: string; status: "pending" | "completed" };

/**
 * Build lifecycle of a plan, driven authoritatively by the build turn's run
 * lifecycle (run.started → building, run.completed → built, failure/cancel/
 * disconnect → not_built). The Review card shows only while `not_built`.
 */
export type PlanBuildStatus = "not_built" | "building" | "built";

export type PlanRef = {
  /** Stable id `${workspaceId}:${slug}`. */
  id: string;
  slug: string;
  title: string;
  /** One-paragraph summary (Review card subtitle). */
  overview: string;
  /** Absolute path to the active `plan.md`. */
  path: string;
  /** Content fingerprint. */
  hash: string;
  workspaceId: string;
  sessionId?: string;
  /** Current markdown body. */
  content: string;
  /** Structured task list — the source of the Build card count + Plan checklist. */
  todos: PlanTodo[];
  /** Build lifecycle state (see PlanBuildStatus). */
  buildStatus: PlanBuildStatus;
  createdAt: string;
  updatedAt: string;
  /** True once copied into the repository for version control. */
  savedToWorkspace: boolean;
};

/* ── Skills (Agent Skills, 2026 SKILL.md standard) ─────────────────────── */

export type SkillScope = "workspace" | "user";

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
  /** Config family the skill came from (".modus", ".cursor", ".claude", …). */
  source: string;
  /** Absolute path of the skill's SKILL.md (or `<name>.md`). */
  path: string;
  enabled: boolean;
  allowImplicitInvocation: boolean;
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

export type SubagentInfo = {
  name: string;
  description: string;
  scope: SkillScope;
  source: string;
  path: string;
  model: string;
  readOnly: boolean;
  isBackground: boolean;
  tools?: string[];
  disallowedTools?: string[];
  isolation: "shared" | "worktree";
  editable: boolean;
  deletable: boolean;
};

export type SubagentDetail = SubagentInfo & { body: string };

export type CreateSubagentInput = {
  cwd: string;
  /** New subagents are written to the selected agents folder. */
  scope?: SkillScope | undefined;
  name: string;
  description: string;
  model?: string;
  readOnly: boolean;
  isBackground: boolean;
  tools?: string[];
  disallowedTools?: string[];
  isolation?: "shared" | "worktree";
  body: string;
};

export type UpdateSubagentInput = CreateSubagentInput & {
  path: string;
};
