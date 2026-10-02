import type {
  AgentEvent,
  AgentRunInfo,
  AgentSessionInfo,
  BrowserBounds,
  BrowserEvent,
  BrowserRecentInfo,
  BrowserTabInfo,
  ContextUsageInfo,
  DiffFilePatch,
  DiffReview,
  DiffTarget,
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
  ModelInfo,
  ModelProviderDetail,
  ModelSettingsState,
  PreviewReadResult,
  PromptDelivery,
  PromptImageAttachment,
  QuestionAnswer,
  QuestionResponse,
  SkillSelection,
  SkillState,
  TerminalEvent,
  TerminalInfo,
  ThinkingLevel,
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
    getPath(file: File): string;
    prepareImage(input: Pick<PromptImageAttachment, "data" | "mimeType" | "path">): Promise<string>;
  };
  agent: {
    create(input: {
      workspaceId: string;
      cwd: string;
      title: string;
      model?: string;
    }): Promise<AgentSessionInfo>;
    list(input?: { includeSessionId?: string | undefined }): Promise<AgentSessionInfo[]>;
    listArchived(workspaceId: string): Promise<AgentSessionInfo[]>;
    commands(sessionId: string): Promise<Array<{ name: string; description: string }>>;
    listEvents(
      sessionId: string,
    ): Promise<Array<{ id: string; event: AgentEvent; createdAt?: string }>>;
    listRuns(sessionId: string): Promise<AgentRunInfo[]>;
    ensure(sessionId: string): Promise<AgentSessionInfo & { contextUsage?: ContextUsageInfo }>;
    /**
     * Drop in-memory SDK runtime for this session only (no descendant abort /
     * no DB status rewrite). Used when a ChatPane unmounts while idle.
     */
    releaseRuntime(sessionId: string): Promise<void>;
    prompt(input: {
      sessionId: string;
      message: string;
      paths?: string[];
      delivery?: PromptDelivery;
      userMessageId?: string;
      attachments?: PromptImageAttachment[];
      skills?: SkillSelection[];
      model?: string;
      thinkingLevel?: ThinkingLevel;
      thinkingVariant?: string;
    }): Promise<void>;
    compact(sessionId: string): Promise<void>;
    abort(sessionId: string): Promise<string[]>;

    navigate(input: { sessionId: string; userMessageId: string }): Promise<void>;
    pin(input: { id: string; pinned: boolean }): Promise<AgentSessionInfo | undefined>;
    archive(sessionId: string): Promise<void>;
    restore(sessionId: string): Promise<void>;
    delete(sessionId: string): Promise<void>;
    setModel(input: {
      sessionId: string;
      model: string;
      thinkingLevel?: ThinkingLevel;
      thinkingVariant?: string;
    }): Promise<AgentSessionInfo>;
    cycleModel(input: {
      sessionId?: string | undefined;
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
    read(input: { cwd: string; path?: string }): Promise<FileDiff>;
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
  questions: {
    respond(input: {
      requestId: string;
      answers: QuestionAnswer[];
      skipped: boolean;
    }): Promise<QuestionResponse | null>;
  };
  model: {
    list(): Promise<ModelInfo[]>;
    setDefault(model: string): Promise<void>;
    settings(): Promise<ModelSettingsState>;
    refreshCatalog(): Promise<ModelSettingsState>;
    onCatalogChanged(callback: () => void): () => void;
    providerDetail(provider: string): Promise<ModelProviderDetail | undefined>;
    openConfig(provider: string): Promise<void>;
    setThinking(input: { model: string; thinkingVariant: string }): Promise<ModelInfo>;
  };
  mcp: {
    commands(sessionId: string): Promise<Array<{ name: string; description?: string }>>;
    runCommand(input: { sessionId: string; name: string; args: string }): Promise<string>;
    locations(sessionId: string): Promise<string[]>;
    status(sessionId: string): Promise<Array<{ sessionId: string; report: string }>>;
    sync(cwd: string): Promise<void>;
    openConfig(input: { sessionId: string; path: string }): Promise<void>;
  };
  skills: {
    list(sessionId: string): Promise<SkillState>;
    refresh(cwd: string): Promise<void>;
    onChanged(callback: (cwd: string) => void): () => void;
    openDir(input: { sessionId: string; path: string }): Promise<void>;
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
