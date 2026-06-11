import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

let userData: string;
let cwd: string;

const mocks = vi.hoisted(() => {
  const model = { id: "model", name: "Mock Model", provider: "mock" };
  let subscriber: ((event: unknown) => void) | undefined;
  return {
    createAgentSession: vi.fn(),
    model,
    emitPiEvent: (event: unknown) => subscriber?.(event),
    setPiSubscriber: (next: ((event: unknown) => void) | undefined) => {
      subscriber = next;
    },
    sessionManagerCreate: vi.fn(() => ({ kind: "create" })),
    sessionManagerOpen: vi.fn(() => ({ kind: "open" })),
  };
});

vi.mock("electron", () => ({
  app: {
    getPath: () => userData,
  },
  Notification: class {
    static isSupported(): boolean {
      return false;
    }
    on(): void {}
    show(): void {}
  },
}));

/** Window stub: focused + alive, so background notifications never fire in tests. */
function createWindowStub(): BrowserWindow {
  return {
    webContents: { send: vi.fn() },
    isDestroyed: () => false,
    isFocused: () => true,
    isMinimized: () => false,
  } as unknown as BrowserWindow;
}

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: mocks.createAgentSession,
  defineTool: <T>(tool: T): T => tool,
  DefaultResourceLoader: class {
    async reload(): Promise<void> {}
  },
  SessionManager: {
    create: mocks.sessionManagerCreate,
    open: mocks.sessionManagerOpen,
  },
  SettingsManager: {
    inMemory: vi.fn(() => ({})),
  },
}));

vi.mock("./model-service", () => ({
  cycleDefaultModel: vi.fn(() => ({
    id: "mock/model",
    provider: "mock",
    name: "Mock Model",
    available: true,
    enabled: true,
    configured: true,
    source: "builtin",
    supportsThinking: true,
    thinkingLevel: "off",
    thinkingLevels: ["off", "low", "medium", "high"],
  })),
  findModel: vi.fn(() => mocks.model),
  getDefaultModel: vi.fn(() => mocks.model),
  getModelInfo: vi.fn(() => ({
    id: "mock/model",
    provider: "mock",
    name: "Mock Model",
    available: true,
    enabled: true,
    configured: true,
    source: "builtin",
    supportsThinking: true,
    thinkingLevel: "off",
    thinkingLevels: ["off", "low", "medium", "high"],
  })),
  getModelThinkingLevel: vi.fn(() => "off"),
  getModelRegistry: vi.fn(() => ({ authStorage: {} })),
  listScopedModels: vi.fn(() => [{ model: mocks.model, thinkingLevel: "off" }]),
  modelToId: (model: typeof mocks.model) => `${model.provider}/${model.id}`,
  setDefaultModel: vi.fn(),
  toPiThinkingLevel: vi.fn((level: string) => level),
}));

const { getDatabase } = await import("../db/database");
const { PiSdkRuntime } = await import("./pi-sdk-runtime");

function createMockPiSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    abort: vi.fn(async () => undefined),
    cycleModel: vi.fn(async () => ({ model: mocks.model })),
    dispose: vi.fn(),
    getContextUsage: vi.fn(() => ({
      contextWindow: 1000,
      percent: 24,
      tokens: 240,
    })),
    model: mocks.model,
    prompt: vi.fn(async () => undefined),
    sessionFile: join(userData, "pi-sessions", "resumed.jsonl"),
    sessionId: "pi-resumed",
    // Rollback anchor source: an empty tree reads as the "root" sentinel.
    sessionManager: { getLeafId: vi.fn(() => null) },
    setModel: vi.fn(async () => undefined),
    setThinkingLevel: vi.fn(),
    subscribe: vi.fn((callback) => {
      mocks.setPiSubscriber(callback);
      return vi.fn();
    }),
    ...overrides,
  };
}

function insertSession(
  sessionId: string,
  workspaceId: string,
  missingSessionFile: string,
  title = "session",
): void {
  const now = new Date().toISOString();
  const db = getDatabase();
  db.prepare(
    `insert into workspaces (id, root_path, display_name, is_git_repository, last_opened_at, created_at)
     values (?, ?, ?, ?, ?, ?)`,
  ).run(workspaceId, cwd, "repo", 1, now, now);
  db.prepare(
    `insert into agent_sessions (
      id, workspace_id, title, cwd, status, runtime, model, pi_session_id, pi_session_file,
      created_at, updated_at
     )
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    workspaceId,
    title,
    cwd,
    "idle",
    "pi-sdk",
    "mock/model",
    "old-pi-session",
    missingSessionFile,
    now,
    now,
  );
}

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "modus-pi-runtime-test-"));
  cwd = await mkdtemp(join(tmpdir(), "modus-pi-runtime-cwd-"));
  mocks.createAgentSession.mockReset();
  mocks.setPiSubscriber(undefined);
  mocks.sessionManagerCreate.mockClear();
  mocks.sessionManagerOpen.mockClear();
  mocks.createAgentSession.mockImplementation(async () => ({
    session: createMockPiSession(),
  }));
});

afterAll(async () => {
  await rm(userData, { recursive: true, force: true }).catch(() => undefined);
  await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
});

describe("PiSdkRuntime", () => {
  it("creates new sessions directly in the workspace checkout", async () => {
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `insert into workspaces (id, root_path, display_name, is_git_repository, last_opened_at, created_at)
         values (?, ?, ?, ?, ?, ?)`,
      )
      .run(workspaceId, cwd, "repo", 1, now, now);
    const runtime = new PiSdkRuntime();
    const window = createWindowStub();

    const session = await runtime.create(window, {
      workspaceId,
      cwd,
      title: "New chat",
      model: "mock/model",
    });

    expect(session.cwd).toBe(cwd);
    expect(mocks.sessionManagerCreate).toHaveBeenCalledWith(cwd, expect.any(String));
    const row = getDatabase()
      .prepare("select cwd from agent_sessions where id = ?")
      .get(session.id) as { cwd: string };
    expect(row.cwd).toBe(cwd);
  });

  it("creates a fresh PI backing session when a persisted session is no longer in memory and its PI file is missing", async () => {
    const sessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(sessionId, workspaceId, join(userData, "missing.jsonl"));

    const runtime = new PiSdkRuntime();
    const window = createWindowStub();

    const resumed = await runtime.ensure(window, sessionId);

    expect(resumed.id).toBe(sessionId);
    expect(mocks.sessionManagerCreate).toHaveBeenCalledWith(cwd, expect.any(String));
    expect(mocks.sessionManagerOpen).not.toHaveBeenCalled();
    const row = getDatabase()
      .prepare("select pi_session_file from agent_sessions where id = ?")
      .get(sessionId) as { pi_session_file: string };
    expect(row.pi_session_file).toContain("resumed.jsonl");
  });

  it("records the user prompt as persisted message events before running PI", async () => {
    const sessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(sessionId, workspaceId, join(userData, "missing.jsonl"), "New chat");
    const runtime = new PiSdkRuntime();
    const window = createWindowStub();

    await runtime.prompt(window, {
      context: [],
      delivery: "normal",
      message: "介绍一下你自己",
      sessionId,
      userMessageId: "local-user-1",
    });

    const rows = getDatabase()
      .prepare(
        `select type, payload_json
         from agent_events
         where session_id = ?
         order by created_at asc, rowid asc`,
      )
      .all(sessionId) as Array<{ type: string; payload_json: string }>;

    expect(rows.slice(0, 4).map((row) => row.type)).toEqual([
      "message.started",
      "message.delta",
      "message.completed",
      "run.started",
    ]);
    expect(JSON.parse(rows[1]?.payload_json ?? "{}")).toEqual({
      type: "message.delta",
      sessionId,
      messageId: "local-user-1",
      delta: "介绍一下你自己",
    });
    const session = getDatabase()
      .prepare("select title from agent_sessions where id = ?")
      .get(sessionId) as { title: string };
    expect(session.title).toBe("介绍一下你自己");
  });

  it("publishes context usage snapshots without persisting them to the timeline", async () => {
    const sessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(sessionId, workspaceId, join(userData, "missing.jsonl"));
    const runtime = new PiSdkRuntime();
    const window = createWindowStub();

    await runtime.ensure(window, sessionId);

    expect(window.webContents.send).toHaveBeenCalledWith("agent:event", {
      type: "context.updated",
      sessionId,
      usage: {
        contextWindow: 1000,
        percent: 24,
        tokens: 240,
      },
    });
    const rows = getDatabase()
      .prepare("select type from agent_events where session_id = ?")
      .all(sessionId) as Array<{ type: string }>;
    expect(rows.map((row) => row.type)).not.toContain("context.updated");
  });

  it("marks a run as failed when PI completes without visible output", async () => {
    const sessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(sessionId, workspaceId, join(userData, "missing.jsonl"), "New chat");
    const runtime = new PiSdkRuntime();
    const window = createWindowStub();

    await runtime.prompt(window, {
      context: [],
      delivery: "normal",
      message: "回答我",
      sessionId,
      userMessageId: "local-user-empty",
    });

    const run = getDatabase()
      .prepare(
        "select status, error from agent_runs where session_id = ? order by started_at desc limit 1",
      )
      .get(sessionId) as { status: string; error: string };
    const events = getDatabase()
      .prepare(
        "select type from agent_events where session_id = ? order by created_at asc, rowid asc",
      )
      .all(sessionId) as Array<{ type: string }>;

    expect(run.status).toBe("failed");
    expect(run.error).toContain("finished without returning any assistant output");
    expect(events.map((event) => event.type)).toContain("runtime.error");
    expect(events.map((event) => event.type)).toContain("run.failed");
  });

  it("completes a run when PI emits assistant text", async () => {
    const sessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(sessionId, workspaceId, join(userData, "missing.jsonl"), "New chat");
    mocks.createAgentSession.mockImplementationOnce(async () => ({
      session: createMockPiSession({
        prompt: vi.fn(async () => {
          mocks.emitPiEvent({
            type: "message_start",
            message: { role: "assistant" },
          });
          mocks.emitPiEvent({
            type: "message_update",
            message: { role: "assistant" },
            assistantMessageEvent: { type: "text_delta", delta: "hello" },
          });
          mocks.emitPiEvent({
            type: "message_end",
            message: { role: "assistant" },
          });
        }),
      }),
    }));
    const runtime = new PiSdkRuntime();
    const window = createWindowStub();

    await runtime.prompt(window, {
      context: [],
      delivery: "normal",
      message: "hello",
      sessionId,
      userMessageId: "local-user-output",
    });

    const run = getDatabase()
      .prepare(
        "select status, error from agent_runs where session_id = ? order by started_at desc limit 1",
      )
      .get(sessionId) as { status: string; error: string | null };
    const events = getDatabase()
      .prepare(
        "select type from agent_events where session_id = ? order by created_at asc, rowid asc",
      )
      .all(sessionId) as Array<{ type: string }>;

    expect(run).toEqual({ status: "completed", error: null });
    expect(events.map((event) => event.type)).toContain("message.delta");
    expect(events.map((event) => event.type)).toContain("run.completed");
  });

  it("keeps an aborted in-flight run cancelled instead of failed", async () => {
    const sessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(sessionId, workspaceId, join(userData, "missing.jsonl"), "New chat");
    let rejectPrompt: ((error: Error) => void) | undefined;
    const abort = vi.fn(async () => {
      rejectPrompt?.(new Error("Aborted"));
    });
    mocks.createAgentSession.mockImplementationOnce(async () => ({
      session: createMockPiSession({
        abort,
        prompt: vi.fn(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectPrompt = reject;
            }),
        ),
      }),
    }));
    const runtime = new PiSdkRuntime();
    const window = createWindowStub();

    const promptTask = runtime.prompt(window, {
      context: [],
      delivery: "normal",
      message: "stop me",
      sessionId,
      userMessageId: "local-user-abort",
    });

    await vi.waitFor(() => {
      expect(
        getDatabase()
          .prepare("select count(*) as count from agent_runs where session_id = ?")
          .get(sessionId),
      ).toEqual({ count: 1 });
    });
    await runtime.abort(sessionId);
    await promptTask;

    const run = getDatabase()
      .prepare(
        "select status, error from agent_runs where session_id = ? order by started_at desc limit 1",
      )
      .get(sessionId) as { status: string; error: string | null };
    const events = getDatabase()
      .prepare(
        "select type from agent_events where session_id = ? order by created_at asc, rowid asc",
      )
      .all(sessionId) as Array<{ type: string }>;

    expect(abort).toHaveBeenCalledOnce();
    expect(run).toEqual({ status: "cancelled", error: null });
    expect(events.map((event) => event.type)).toContain("run.cancelled");
    expect(events.map((event) => event.type)).not.toContain("run.failed");
    expect(events.map((event) => event.type)).not.toContain("runtime.error");
  });
});
