import type {
  AddDocInput,
  AgentEvent,
  AgentMode,
  AgentReviewDepth,
  AgentReviewResult,
  AgentRollbackResult,
  AgentRunInfo,
  AgentSessionInfo,
  ApprovalMode,
  ApprovalModeState,
  BrowserBounds,
  BrowserEvent,
  BrowserRecentInfo,
  BrowserTabInfo,
  CheckpointInfo,
  ConfigureProviderInput,
  ContextItem,
  ContextKind,
  ContextSuggestion,
  CustomProviderConfig,
  DiffFilePatch,
  DiffReview,
  DiffTarget,
  DocHit,
  DocSource,
  FileDiff,
  FileEntry,
  FileReadResult,
  FilesChangeEvent,
  FileWriteResult,
  GitActionResult,
  GitBranchSummary,
  GitChangeEvent,
  GitCommit,
  GitCommitResult,
  GitStatusSummary,
  ManagedProcessInfo,
  ManagedProcessOrigin,
  McpServerInfo,
  McpServerUpsertInput,
  ModelInfo,
  ModelProviderDetail,
  ModelSettingsState,
  PermissionAction,
  PermissionDecision,
  PersonalizationState,
  PreviewReadResult,
  PromptDelivery,
  PromptImageAttachment,
  ProviderAuthOperationState,
  ProviderConnectionMethod,
  QuestionAnswer,
  QuestionResponse,
  RawMcpEntry,
  ResolvedContext,
  RuleFileInfo,
  SkillDetail,
  SkillInfo,
  SkillSelection,
  SubagentDetail,
  SubagentInfo,
  TerminalEvent,
  TerminalInfo,
  TestCustomProviderInput,
  TestCustomProviderResult,
  ThinkingLevel,
  UpdateModelConfigInput,
  UpsertCustomProviderInput,
  WorkingChangeStats,
  WorkspaceInfo,
} from "../shared/contracts";
import type { StartupMetricInput } from "../shared/startup";

export type SecurityState = {
  contextIsolation: boolean;
  nodeIntegration: boolean;
  sandbox: boolean;
  senderValidation: boolean;
};

/** Resolved Modus theme tokens forwarded to the in-page Design Mode overlay. */
export type DesignModeTheme = {
  accent: string;
  accentContrast: string;
  surface: string;
  elevated: string;
  fg: string;
  fgSubtle: string;
  fontFamily: string;
  border: string;
  shadow: string;
};

export type ModusApi = {
  app: {
    version(): Promise<string>;
    securityState(): Promise<SecurityState>;
    startupMetric(input: StartupMetricInput): Promise<void>;
  };
  workspace: {
    open(): Promise<WorkspaceInfo | undefined>;
    list(): Promise<WorkspaceInfo[]>;
    /** Pin / unpin a project; returns the re-sorted recents. */
    pin(input: { id: string; pinned: boolean }): Promise<WorkspaceInfo[]>;
    /** Rename a project's sidebar label; returns the updated recents. */
    rename(input: { id: string; displayName: string }): Promise<WorkspaceInfo[]>;
    /** Soft-archive all of a project's visible chats; returns the number archived. */
    archiveChats(id: string): Promise<number>;
    /** Permanently delete all of a project's chats; returns the number deleted. */
    deleteChats(id: string): Promise<number>;
    /** Remove a project from Modus (files kept); returns the updated recents. */
    remove(id: string): Promise<WorkspaceInfo[]>;
    /** Reveal a project's root folder in the OS file manager. */
    reveal(id: string): Promise<void>;
  };
  file: {
    /** Open a workspace file in the OS default app. Path may be relative to cwd or absolute. */
    open(input: { cwd: string; path: string }): Promise<void>;
  };
  agent: {
    create(input: {
      workspaceId: string;
      cwd: string;
      title: string;
      model?: string;
    }): Promise<AgentSessionInfo>;
    list(input?: { includeSessionId?: string }): Promise<AgentSessionInfo[]>;
    listArchived(workspaceId: string): Promise<AgentSessionInfo[]>;
    listEvents(
      sessionId: string,
    ): Promise<Array<{ id: string; event: AgentEvent; createdAt?: string }>>;
    listRuns(sessionId: string): Promise<AgentRunInfo[]>;
    ensure(sessionId: string): Promise<AgentSessionInfo>;
    prompt(input: {
      sessionId: string;
      message: string;
      context?: ContextItem[];
      delivery?: PromptDelivery;
      userMessageId?: string;
      attachments?: PromptImageAttachment[];
      skills?: SkillSelection[];
      mode?: AgentMode;
      model?: string;
      thinkingLevel?: ThinkingLevel;
      thinkingVariant?: string;
      /** Set when this prompt is a "Build this plan" action; binds the turn to the plan. */
      planId?: string;
    }): Promise<void>;
    abort(sessionId: string): Promise<void>;
    /**
     * Rewind the session to just before one of its user messages: restores
     * workspace files from the pre-run snapshot and removes the conversation
     * from that message onward. Used by the timeline's "edit & resend".
     */
    rollback(input: { sessionId: string; userMessageId: string }): Promise<AgentRollbackResult>;
    pin(input: { id: string; pinned: boolean }): Promise<AgentSessionInfo | undefined>;
    archive(sessionId: string): Promise<void>;
    restore(sessionId: string): Promise<void>;
    delete(sessionId: string): Promise<void>;
    applySubagentWorktree(sessionId: string): Promise<AgentSessionInfo>;
    abortSubagentWorktreeApply(sessionId: string): Promise<AgentSessionInfo>;
    cleanupSubagentWorktree(sessionId: string): Promise<AgentSessionInfo>;
    setModel(input: {
      sessionId: string;
      model: string;
      thinkingLevel?: ThinkingLevel;
      thinkingVariant?: string;
    }): Promise<AgentSessionInfo>;
    cycleModel(input: {
      sessionId?: string;
      direction?: "forward" | "backward";
    }): Promise<ModelInfo>;
    onEvent(callback: (event: AgentEvent) => void): () => void;
    /** Notification click → bring this session into the focused pane. */
    onFocusSession(callback: (sessionId: string) => void): () => void;
  };
  terminal: {
    create(input: {
      workspaceId: string;
      cwd?: string;
      cols?: number;
      rows?: number;
    }): Promise<TerminalInfo>;
    write(input: { terminalId: string; data: string }): Promise<void>;
    resize(input: { terminalId: string; cols: number; rows: number }): Promise<void>;
    kill(terminalId: string): Promise<void>;
    remove(terminalId: string): Promise<void>;
    list(): Promise<TerminalInfo[]>;
    onEvent(callback: (event: TerminalEvent) => void): () => void;
  };
  process: {
    list(input: {
      workspaceId?: string;
      sessionId?: string;
      origin?: ManagedProcessOrigin;
    }): Promise<ManagedProcessInfo[]>;
    kill(id: string): Promise<boolean>;
    onChanged(callback: () => void): () => void;
  };
  browser: {
    listTabs(input: { workspaceId: string }): Promise<BrowserTabInfo[]>;
    createTab(input: { workspaceId: string; url?: string }): Promise<BrowserTabInfo>;
    selectTab(input: { tabId: string }): Promise<BrowserTabInfo>;
    closeTab(input: { tabId: string }): Promise<void>;
    navigate(input: {
      tabId?: string;
      workspaceId?: string;
      url: string;
      newTab?: boolean;
    }): Promise<BrowserTabInfo>;
    back(input: { tabId: string }): Promise<BrowserTabInfo>;
    forward(input: { tabId: string }): Promise<BrowserTabInfo>;
    reload(input: { tabId: string }): Promise<BrowserTabInfo>;
    setBounds(input: { tabId: string; bounds: BrowserBounds }): Promise<void>;
    show(input: { tabId: string; bounds: BrowserBounds }): Promise<void>;
    hide(input: { tabId: string }): Promise<void>;
    toggleDevtools(input: { tabId: string }): Promise<BrowserTabInfo>;
    openExternal(input: { tabId: string }): Promise<void>;
    /** Toggle Design Mode (point-and-select). `theme` carries Modus light/dark tokens. */
    setDesignMode(input: {
      tabId: string;
      enabled: boolean;
      theme?: DesignModeTheme;
    }): Promise<BrowserTabInfo>;
    find(input: {
      tabId: string;
      query: string;
      forward?: boolean;
      findNext?: boolean;
      matchCase?: boolean;
    }): Promise<void>;
    findStop(input: {
      tabId: string;
      action?: "clearSelection" | "keepSelection" | "activateSelection";
    }): Promise<void>;
    listRecents(input: { workspaceId: string }): Promise<BrowserRecentInfo[]>;
    deleteRecent(input: { id: string }): Promise<void>;
    onEvent(callback: (event: BrowserEvent) => void): () => void;
  };
  diff: {
    review(input: { cwd: string; target: DiffTarget }): Promise<DiffReview>;
    read(input: { cwd: string; path?: string; mode?: FileDiff["mode"] }): Promise<FileDiff>;
    filePatch(input: {
      cwd: string;
      path: string;
      target: DiffTarget;
      originalPath?: string;
      untracked: boolean;
      ignoreWhitespace: boolean;
    }): Promise<DiffFilePatch>;
    stage(input: { cwd: string; path: string }): Promise<void>;
    unstage(input: { cwd: string; path: string }): Promise<void>;
    discardUnstaged(input: { cwd: string; path: string }): Promise<void>;
    status(cwd: string): Promise<GitStatusSummary>;
    /** File list + ± line counters for the changes strip / apply review. */
    stats(cwd: string): Promise<WorkingChangeStats>;
    /** File list + ± line counters since a Git commit-ish. */
    statsSince(input: { cwd: string; base: string }): Promise<WorkingChangeStats>;
    /**
     * Session-scoped change summary: changes since this session's baseline
     * (its first checkpoint), for the composer strip. Empty when the session
     * has no baseline yet (it has changed nothing).
     */
    sessionStats(sessionId: string): Promise<WorkingChangeStats>;
    commitOrPush(input: {
      cwd: string;
      message?: string;
      commit: boolean;
      push: boolean;
      includeUnstaged?: boolean;
    }): Promise<GitCommitResult>;
  };
  files: {
    list(input: { cwd: string; dir?: string }): Promise<FileEntry[]>;
    read(input: { cwd: string; path: string }): Promise<FileReadResult>;
    write(input: { cwd: string; path: string; content: string }): Promise<FileWriteResult>;
    /** Start live-watching the workspace root (ref-counted). Returns resolved root. */
    watch(cwd: string): Promise<string>;
    /** Stop live-watching (ref-counted). */
    unwatch(cwd: string): Promise<void>;
    /** Subscribe to debounced workspace-change events. Returns an unsubscribe fn. */
    onChanged(callback: (event: FilesChangeEvent) => void): () => void;
  };
  preview: {
    read(input: { cwd: string; path: string }): Promise<PreviewReadResult>;
  };
  git: {
    branches(cwd: string): Promise<GitBranchSummary>;
    checkout(input: { cwd: string; name: string; remote?: boolean }): Promise<GitActionResult>;
    isRepository(cwd: string): Promise<boolean>;
    init(cwd: string): Promise<GitActionResult>;
    /** Recent commit history for the Source Control "All commits" scope. */
    log(input: { cwd: string; limit?: number }): Promise<GitCommit[]>;
    /** Start live-watching the repo containing cwd (ref-counted). */
    watch(cwd: string): Promise<string | undefined>;
    /** Stop live-watching (ref-counted). */
    unwatch(cwd: string): Promise<void>;
    /** Subscribe to debounced repository-change events. Returns an unsubscribe fn. */
    onChanged(callback: (event: GitChangeEvent) => void): () => void;
  };
  permission: {
    decide(input: {
      requestId?: string;
      sessionId?: string;
      action: PermissionAction;
      target: string;
      decision: PermissionDecision["decision"];
    }): Promise<PermissionDecision>;
    list(): Promise<PermissionDecision[]>;
    getMode(input?: { cwd?: string }): Promise<ApprovalModeState>;
    setMode(input: { mode: ApprovalMode; cwd?: string }): Promise<ApprovalModeState>;
    clearProjectMode(input: { cwd: string }): Promise<ApprovalModeState>;
  };
  questions: {
    /** Resolve a pending ask_user request with the user's answers (or a skip). */
    respond(input: {
      requestId: string;
      answers: QuestionAnswer[];
      skipped: boolean;
    }): Promise<QuestionResponse | null>;
  };
  context: {
    search(input: {
      workspaceId: string;
      cwd: string;
      query: string;
      kind?: ContextKind;
    }): Promise<ContextSuggestion[]>;
    resolve(input: { cwd: string; items: ContextItem[] }): Promise<ResolvedContext[]>;
  };
  docs: {
    list(workspaceId: string): Promise<DocSource[]>;
    add(input: AddDocInput): Promise<DocSource>;
    search(input: { workspaceId: string; query: string }): Promise<DocHit[]>;
  };
  model: {
    list(): Promise<ModelInfo[]>;
    setDefault(model: string): Promise<void>;
    settings(): Promise<ModelSettingsState>;
    refreshCatalog(): Promise<ModelSettingsState>;
    onCatalogChanged(callback: () => void): () => void;
    providerDetail(provider: string): Promise<ModelProviderDetail | undefined>;
    connectionMethods(provider: string): Promise<ProviderConnectionMethod[]>;
    startProviderAuth(input: { provider: string }): Promise<ProviderAuthOperationState>;
    providerAuthState(input: { operationId: string }): Promise<ProviderAuthOperationState>;
    respondProviderAuth(input: { operationId: string; value?: string }): Promise<void>;
    cancelProviderAuth(input: { operationId: string }): Promise<void>;
    disconnectProvider(provider: string): Promise<void>;
    customProviderConfig(provider: string): Promise<CustomProviderConfig | undefined>;
    deleteCustomProvider(provider: string): Promise<void>;
    configureProvider(input: ConfigureProviderInput): Promise<ModelProviderDetail>;
    upsertCustomProvider(input: UpsertCustomProviderInput): Promise<ModelProviderDetail>;
    /** Live connectivity probe for the custom provider form (nothing is saved). */
    testCustomProvider(input: TestCustomProviderInput): Promise<TestCustomProviderResult>;
    updateConfig(input: UpdateModelConfigInput): Promise<ModelInfo>;
  };
  review: {
    start(input: {
      cwd: string;
      sessionId?: string;
      workspaceId?: string;
      depth?: AgentReviewDepth;
    }): Promise<AgentReviewResult>;
    list(cwd: string): Promise<AgentReviewResult[]>;
  };
  checkpoint: {
    list(sessionId: string): Promise<CheckpointInfo[]>;
    restore(input: { checkpointId: string }): Promise<CheckpointInfo>;
  };
  mcp: {
    list(): Promise<McpServerInfo[]>;
    sync(cwd: string): Promise<McpServerInfo[]>;
    openConfig(cwd: string): Promise<string>;
    upsert(input: { cwd: string } & McpServerUpsertInput): Promise<McpServerInfo[]>;
    delete(input: { cwd: string; name: string }): Promise<McpServerInfo[]>;
    setEnabled(input: { cwd: string; name: string; enabled: boolean }): Promise<McpServerInfo[]>;
    entry(input: { cwd: string; name: string }): Promise<RawMcpEntry | undefined>;
  };
  rules: {
    /** Detected project rule files (AGENTS.md, .cursor/rules…) with apply modes. */
    list(cwd: string): Promise<RuleFileInfo[]>;
  };
  personalization: {
    get(): Promise<PersonalizationState>;
    save(input: { content: string }): Promise<PersonalizationState>;
    open(): Promise<string>;
  };
  skills: {
    list(cwd: string): Promise<SkillInfo[]>;
    get(input: { cwd: string; path: string }): Promise<SkillDetail | undefined>;
    create(input: {
      cwd: string;
      name: string;
      description: string;
      body: string;
    }): Promise<SkillInfo>;
    openDir(cwd: string): Promise<string>;
  };
  subagents: {
    list(cwd: string): Promise<SubagentInfo[]>;
    get(input: { cwd: string; path: string }): Promise<SubagentDetail | undefined>;
    create(input: {
      cwd: string;
      scope?: "user" | "workspace";
      name: string;
      description: string;
      model?: string;
      readOnly: boolean;
      tools?: string[];
      disallowedTools?: string[];
      isolation?: "shared" | "worktree";
      body: string;
    }): Promise<SubagentInfo>;
    update(input: {
      cwd: string;
      path: string;
      name: string;
      description: string;
      model?: string;
      readOnly: boolean;
      tools?: string[];
      disallowedTools?: string[];
      isolation?: "shared" | "worktree";
      body: string;
    }): Promise<SubagentInfo>;
    delete(input: { cwd: string; path: string }): Promise<SubagentInfo[]>;
    openDir(input: { cwd: string; scope?: "user" | "workspace" }): Promise<string>;
  };
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    getState(): Promise<{ maximized: boolean }>;
    onStateChange(listener: (state: { maximized: boolean }) => void): () => void;
  };
  clipboard: {
    /** Write PNG bytes to the OS clipboard as an image. */
    writeImage(input: { png: Uint8Array }): Promise<void>;
  };
  dialog: {
    /** Native Save dialog + write PNG bytes. Cancel → `{ saved: false }`. */
    saveImage(input: {
      png: Uint8Array;
      defaultName?: string;
    }): Promise<{ saved: false } | { saved: true; path: string }>;
  };
};
