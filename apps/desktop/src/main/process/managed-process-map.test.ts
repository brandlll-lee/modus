import { describe, expect, it } from "vitest";
import type { TerminalInfo } from "../../shared/contracts";
import type { AppProcessInfo } from "./app-process-service";
import {
  appToManaged,
  matchesScope,
  selectManagedProcesses,
  terminalLabel,
  terminalToManaged,
} from "./managed-process-map";

function terminal(overrides: Partial<TerminalInfo>): TerminalInfo {
  return {
    id: "t1",
    workspaceId: "ws1",
    cwd: "/repo",
    shell: "C:\\WINDOWS\\System32\\pwsh.exe",
    cols: 80,
    rows: 24,
    status: "running",
    origin: "user",
    startedAt: "2026-06-14T07:00:00.000Z",
    ...overrides,
  };
}

function appProcess(overrides: Partial<AppProcessInfo>): AppProcessInfo {
  return {
    id: "a1",
    pid: 4321,
    command: "C:\\apps\\editor.exe",
    args: [],
    cwd: "/repo",
    name: "editor",
    startedAt: "2026-06-14T07:01:00.000Z",
    status: "running",
    ...overrides,
  };
}

describe("terminalLabel", () => {
  it("uses the agent command title for agent terminals", () => {
    expect(terminalLabel(terminal({ origin: "agent", title: "npm run dev" }))).toBe("npm run dev");
  });

  it("falls back to the agent command when there is no title", () => {
    expect(terminalLabel(terminal({ origin: "agent", command: "cargo build" }))).toBe(
      "cargo build",
    );
  });

  it("uses the cleaned shell name for user terminals", () => {
    expect(terminalLabel(terminal({ origin: "user" }))).toBe("pwsh");
  });
});

describe("terminalToManaged", () => {
  it("maps a running agent terminal, preserving scope and identity", () => {
    const mapped = terminalToManaged(
      terminal({
        id: "term-7",
        origin: "agent",
        sessionId: "sess-A",
        command: "npm run dev",
        title: "npm run dev",
        pid: 9090,
      }),
    );
    expect(mapped).toMatchObject({
      id: "term-7",
      kind: "terminal",
      origin: "agent",
      workspaceId: "ws1",
      sessionId: "sess-A",
      label: "npm run dev",
      status: "running",
      pid: 9090,
    });
  });

  it("omits sessionId for a user terminal that has none", () => {
    const mapped = terminalToManaged(terminal({ origin: "user" }));
    expect(mapped.sessionId).toBeUndefined();
    expect(mapped.origin).toBe("user");
  });

  it("carries the exit code once a terminal has exited", () => {
    const mapped = terminalToManaged(terminal({ status: "exited", exitCode: 1 }));
    expect(mapped.status).toBe("exited");
    expect(mapped.exitCode).toBe(1);
  });
});

describe("appToManaged", () => {
  it("maps a GUI app as an agent-owned managed process", () => {
    const mapped = appToManaged(
      appProcess({
        id: "app-3",
        sessionId: "sess-A",
        workspaceId: "ws1",
        name: "Solers",
        windowTitle: "Solers — main",
        pid: 22600,
      }),
    );
    expect(mapped).toMatchObject({
      id: "app-3",
      kind: "app",
      origin: "agent",
      sessionId: "sess-A",
      workspaceId: "ws1",
      label: "Solers",
      windowTitle: "Solers — main",
      pid: 22600,
      status: "running",
    });
  });
});

describe("matchesScope (per-session isolation)", () => {
  const agentA = terminalToManaged(
    terminal({ id: "ag-A", origin: "agent", sessionId: "sess-A", workspaceId: "ws1" }),
  );
  const userWs1 = terminalToManaged(terminal({ id: "u1", origin: "user", workspaceId: "ws1" }));

  it("shows an agent process only in its own session", () => {
    expect(matchesScope(agentA, { workspaceId: "ws1", sessionId: "sess-A" })).toBe(true);
    expect(matchesScope(agentA, { workspaceId: "ws1", sessionId: "sess-B" })).toBe(false);
  });

  it("hides agent processes when no session is in scope", () => {
    expect(matchesScope(agentA, { workspaceId: "ws1" })).toBe(false);
  });

  it("shows a user terminal across sessions of the same workspace", () => {
    expect(matchesScope(userWs1, { workspaceId: "ws1", sessionId: "sess-A" })).toBe(true);
    expect(matchesScope(userWs1, { workspaceId: "ws1", sessionId: "sess-B" })).toBe(true);
  });

  it("hides a user terminal from a different workspace", () => {
    expect(matchesScope(userWs1, { workspaceId: "ws2", sessionId: "sess-A" })).toBe(false);
  });
});

describe("selectManagedProcesses", () => {
  const agentA = terminalToManaged(
    terminal({
      id: "ag-A",
      origin: "agent",
      sessionId: "sess-A",
      workspaceId: "ws1",
      command: "npm run dev",
      title: "npm run dev",
      startedAt: "2026-06-14T07:02:00.000Z",
    }),
  );
  const agentB = terminalToManaged(
    terminal({
      id: "ag-B",
      origin: "agent",
      sessionId: "sess-B",
      workspaceId: "ws1",
      command: "cargo run",
      title: "cargo run",
      startedAt: "2026-06-14T07:03:00.000Z",
    }),
  );
  const userShell = terminalToManaged(
    terminal({
      id: "user-1",
      origin: "user",
      workspaceId: "ws1",
      startedAt: "2026-06-14T07:00:00.000Z",
    }),
  );
  const appA = appToManaged(
    appProcess({
      id: "app-A",
      sessionId: "sess-A",
      workspaceId: "ws1",
      name: "Solers",
      startedAt: "2026-06-14T07:01:00.000Z",
    }),
  );
  const all = [agentB, userShell, agentA, appA];

  it("the composer-bar query (origin=agent) excludes the user shell", () => {
    const ids = selectManagedProcesses(all, {
      workspaceId: "ws1",
      sessionId: "sess-A",
      origin: "agent",
    }).map((process) => process.id);
    // Agent terminal + agent-launched app for session A, oldest first; no user shell.
    expect(ids).toEqual(["app-A", "ag-A"]);
  });

  it("isolates the agent slice to its own session", () => {
    expect(
      selectManagedProcesses(all, { workspaceId: "ws1", sessionId: "sess-B", origin: "agent" }).map(
        (process) => process.id,
      ),
    ).toEqual(["ag-B"]);
  });

  it("without an origin predicate, returns the scoped roster (agent session + user workspace)", () => {
    const ids = selectManagedProcesses(all, { workspaceId: "ws1", sessionId: "sess-A" }).map(
      (process) => process.id,
    );
    // user shell (workspace) + session-A agent processes, sorted oldest-first.
    expect(ids).toEqual(["user-1", "app-A", "ag-A"]);
  });

  it("origin=user returns only workspace shells, across sessions", () => {
    expect(
      selectManagedProcesses(all, { workspaceId: "ws1", sessionId: "sess-A", origin: "user" }).map(
        (process) => process.id,
      ),
    ).toEqual(["user-1"]);
  });
});
