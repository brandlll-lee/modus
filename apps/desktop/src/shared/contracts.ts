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
  createdAt: string;
  updatedAt: string;
};

export type AgentEvent =
  | { type: "agent.stdout"; sessionId: string; line: unknown }
  | { type: "agent.stderr"; sessionId: string; data: string }
  | { type: "agent.exit"; sessionId: string; exitCode: number | null }
  | { type: "agent.error"; sessionId: string; message: string };

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
