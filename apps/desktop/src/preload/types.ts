import type {
  AddDocInput,
  AgentEvent,
  AgentSessionInfo,
  ContextItem,
  ContextKind,
  ContextSuggestion,
  DocHit,
  DocSource,
  FileChange,
  FileDiff,
  ModelInfo,
  PermissionAction,
  PermissionDecision,
  ResolvedContext,
  TerminalEvent,
  TerminalInfo,
  WorkspaceInfo,
  WorktreeInfo,
} from "../shared/contracts";

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
  };
  workspace: {
    open(): Promise<WorkspaceInfo | undefined>;
    list(): Promise<WorkspaceInfo[]>;
  };
  agent: {
    create(input: {
      workspaceId: string;
      cwd: string;
      title: string;
      model?: string;
    }): Promise<AgentSessionInfo>;
    prompt(input: { sessionId: string; message: string; context?: ContextItem[] }): Promise<void>;
    abort(sessionId: string): Promise<void>;
    setModel(input: { sessionId: string; model: string }): Promise<AgentSessionInfo>;
    cycleModel(input: {
      sessionId?: string;
      direction?: "forward" | "backward";
    }): Promise<ModelInfo>;
    onEvent(callback: (event: AgentEvent) => void): () => void;
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
    list(): Promise<TerminalInfo[]>;
    onEvent(callback: (event: TerminalEvent) => void): () => void;
  };
  diff: {
    list(cwd: string): Promise<FileChange[]>;
    read(input: { cwd: string; path?: string }): Promise<FileDiff>;
    revert(input: { cwd: string; path: string }): Promise<void>;
  };
  permission: {
    decide(input: {
      action: PermissionAction;
      target: string;
      decision: PermissionDecision["decision"];
    }): Promise<PermissionDecision>;
    list(): Promise<PermissionDecision[]>;
  };
  worktree: {
    list(cwd: string): Promise<WorktreeInfo[]>;
    create(input: { cwd: string; taskId: string }): Promise<WorktreeInfo>;
    delete(input: { cwd: string; path: string }): Promise<void>;
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
  };
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    getState(): Promise<{ maximized: boolean }>;
    onStateChange(listener: (state: { maximized: boolean }) => void): () => void;
  };
};
