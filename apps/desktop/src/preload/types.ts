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
  BrowserBounds,
  BrowserEvent,
  BrowserTabInfo,
  CheckpointInfo,
  ConfigureProviderInput,
  ContextItem,
  ContextKind,
  ContextSuggestion,
  CustomProviderConfig,
  DiffFileVersions,
  DocHit,
  DocSource,
  FileChange,
  FileDiff,
  FileEntry,
  FileReadResult,
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
  PromptDelivery,
  PromptImageAttachment,
  QuestionAnswer,
  QuestionResponse,
  RawMcpEntry,
  ResolvedContext,
  RuleFileInfo,
  SkillDetail,
  SkillInfo,
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

export type SecurityState = {
  contextIsolation: boolean;
  nodeIntegration: boolean;
  sandbox: boolean;
  senderValidation: boolean;
};

/** Resolved Modus theme tokens forwarded to the in-page Design Mode overlay. */
export type DesignModeTheme = {
  accent: string;
  accentSoft: string;
  accentContrast: string;
  surface: string;
  elevated: string;
  fg: string;
  fgSubtle: string;
  border: string;
  shadow: string;
  fill: string;
};

export type ModusApi = {
  app: {
    version(): Promise<string>;
    securityState(): Promise<SecurityState>;
  };
  workspace: {
    open(): Promise<WorkspaceInfo | undefined>;
    list(): Promise<WorkspaceInfo[]>;
    /** Pin / unpin a project; returns the re-sorted recents. */
    pin(input: { id: string; pinned: boolean }): Promise<WorkspaceInfo[]>;
    /** Rename a project's sidebar label; returns the updated recents. */
    rename(input: { id: string; displayName: string }): Promise<WorkspaceInfo[]>;
    /** Archive all of a project's chats; returns the number removed. */
    archiveChats(id: string): Promise<number>;
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
    list(): Promise<AgentSessionInfo[]>;
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
      skills?: string[];
      mode?: AgentMode;
      model?: string;
      thinkingLevel?: ThinkingLevel;
    }): Promise<void>;
    abort(sessionId: string): Promise<void>;
    /**
     * Rewind the session to just before one of its user messages: restores
     * workspace files from the pre-run snapshot and removes the conversation
     * from that message onward. Used by the timeline's "edit & resend".
     */
    rollback(input: { sessionId: string; userMessageId: string }): Promise<AgentRollbackResult>;
    delete(sessionId: string): Promise<void>;
    setModel(input: {
      sessionId: string;
      model: string;
      thinkingLevel?: ThinkingLevel;
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
      cwd: string;
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
    onEvent(callback: (event: BrowserEvent) => void): () => void;
  };
  diff: {
    list(cwd: string): Promise<FileChange[]>;
    read(input: { cwd: string; path?: string; mode?: FileDiff["mode"] }): Promise<FileDiff>;
    fileVersions(input: {
      cwd: string;
      path: string;
      mode?: "unstaged" | "staged";
      originalPath?: string;
      /** When set, diff the commit against its parent instead of the working tree. */
      commit?: string;
    }): Promise<DiffFileVersions>;
    /** Files touched by a single commit (All commits scope). */
    commitChanges(input: { cwd: string; commit: string }): Promise<FileChange[]>;
    discard(input: { cwd: string; path: string }): Promise<void>;
    status(cwd: string): Promise<GitStatusSummary>;
    /** File list + ± line counters for the changes strip / apply review. */
    stats(cwd: string): Promise<WorkingChangeStats>;
    commitOrPush(input: {
      cwd: string;
      message?: string;
      commit: boolean;
      push: boolean;
    }): Promise<GitCommitResult>;
  };
  files: {
    list(input: { cwd: string; dir?: string }): Promise<FileEntry[]>;
    read(input: { cwd: string; path: string }): Promise<FileReadResult>;
  };
  git: {
    branches(cwd: string): Promise<GitBranchSummary>;
    checkout(input: { cwd: string; name: string; remote?: boolean }): Promise<GitActionResult>;
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
    getMode(): Promise<ApprovalMode>;
    setMode(mode: ApprovalMode): Promise<ApprovalMode>;
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
    providerDetail(provider: string): Promise<ModelProviderDetail | undefined>;
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
  skills: {
    list(cwd: string): Promise<SkillInfo[]>;
    get(input: { cwd: string; id: string }): Promise<SkillDetail | undefined>;
    create(input: {
      cwd: string;
      name: string;
      description: string;
      body: string;
    }): Promise<SkillInfo>;
    openDir(cwd: string): Promise<string>;
  };
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    getState(): Promise<{ maximized: boolean }>;
    onStateChange(listener: (state: { maximized: boolean }) => void): () => void;
  };
};
