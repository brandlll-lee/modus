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
  status: "starting" | "running" | "idle" | "exited" | "error";
  runtime?: "pi-sdk" | "pi-rpc";
  model?: string;
  piSessionId?: string;
  piSessionFile?: string;
  worktreePath?: string;
  createdAt: string;
  updatedAt: string;
};

export type PermissionRequest = {
  id: string;
  action: PermissionAction;
  target: string;
  reason: string;
};

export type AgentEvent =
  | { type: "agent.started"; sessionId: string }
  | { type: "agent.ended"; sessionId: string }
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
  | { type: "queue.updated"; sessionId: string; steering: string[]; followUp: string[] }
  | { type: "compaction.started"; sessionId: string; reason: string }
  | { type: "compaction.ended"; sessionId: string; summary?: string; aborted: boolean }
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
};

export type FileDiff = {
  path: string;
  diff: string;
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

export type ContextKind = "file" | "folder" | "doc" | "terminal" | "git-diff";

export type ContextItem =
  | { type: "file"; path: string }
  | { type: "folder"; path: string }
  | { type: "doc"; docId: string; title: string; query?: string }
  | { type: "terminal"; terminalId: string; range?: { fromLine?: number; toLine?: number } }
  | { type: "git-diff"; mode: "working-state" | "branch"; base?: string };

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
  name: string;
  available: boolean;
};
