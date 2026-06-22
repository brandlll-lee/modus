import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { BrowserWindow as BrowserWindowType } from "electron";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

let userData: string;
let cwd: string;
const execFileAsync = promisify(execFile);

const mocks = vi.hoisted(() => {
  const model = { id: "model", name: "Mock Model", provider: "mock" };
  let subscriber: ((event: unknown) => void) | undefined;
  const processState = { processes: [] as unknown[] };
  return {
    createAgentSession: vi.fn(),
    killManagedProcess: vi.fn(async () => true),
    listManagedProcesses: vi.fn((query: { sessionId?: string; origin?: string }) =>
      processState.processes.filter((process) => {
        const item = process as { sessionId?: string; origin?: string };
        return (
          (query.sessionId === undefined || item.sessionId === query.sessionId) &&
          (query.origin === undefined || item.origin === query.origin)
        );
      }),
    ),
    model,
    emitPiEvent: (event: unknown) => subscriber?.(event),
    setManagedProcesses: (processes: unknown[]) => {
      processState.processes = processes;
    },
    setPiSubscriber: (next: ((event: unknown) => void) | undefined) => {
      subscriber = next;
    },
    sessionManagerCreate: vi.fn(() => ({ kind: "create" })),
    sessionManagerOpen: vi.fn(() => ({ kind: "open" })),
    resourceLoaderOptions: [] as unknown[],
    globalGuidance: undefined as string | undefined,
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
function createWindowStub(): BrowserWindowType {
  return {
    webContents: { send: vi.fn() },
    isDestroyed: () => false,
    isFocused: () => true,
    isMinimized: () => false,
  } as unknown as BrowserWindowType;
}

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: mocks.createAgentSession,
  defineTool: <T>(tool: T): T => tool,
  DefaultResourceLoader: class {
    constructor(options: unknown) {
      mocks.resourceLoaderOptions.push(options);
    }
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

vi.mock("../guidance/guidance-service", () => ({
  resolveGlobalGuidancePrompt: vi.fn(() => mocks.globalGuidance),
}));

vi.mock("../process/managed-process-facade", () => ({
  killManagedProcess: mocks.killManagedProcess,
  listManagedProcesses: mocks.listManagedProcesses,
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
  getModelThinkingVariant: vi.fn(() => "off"),
  getModelRegistry: vi.fn(() => ({ authStorage: {} })),
  listScopedModels: vi.fn(() => [{ model: mocks.model, thinkingLevel: "off" }]),
  modelToId: (model: typeof mocks.model) => `${model.provider}/${model.id}`,
  resolveModelThinking: vi.fn((model: typeof mocks.model, variant?: string) => ({
    model,
    thinkingLevel: variant === "high" ? "high" : "off",
    variant: variant ?? "off",
  })),
  setDefaultModel: vi.fn(),
}));

const { getDatabase } = await import("../db/database");
const { PiSdkRuntime } = await import("./pi-sdk-runtime");
const { toolRegistry } = await import("./tools/registry");
const { archiveAgentSession } = await import("./session-lifecycle");
const { recordAgentEvent } = await import("./agent-event-store");
const { writePlan, readPlanById } = await import("../plan/plan-store");
const { setAgentToolContext } = await import("./tools/tool-context");

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
    // Authoritative turn state read by the runtime: whether a turn is streaming
    // (so a steer/follow-up joins it instead of opening a run) and the message
    // log (so the end-of-turn outcome reads the last assistant stopReason).
    isStreaming: false,
    state: { messages: [] },
    // Rollback anchor source: an empty tree reads as the "root" sentinel.
    sessionManager: { getLeafId: vi.fn(() => null) },
    setModel: vi.fn(async () => undefined),
    setThinkingLevel: vi.fn(),
    setActiveToolsByName: vi.fn(),
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

function insertSubagentSession(
  sessionId: string,
  parentSessionId: string,
  workspaceId: string,
): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `insert into agent_sessions (
        id, workspace_id, title, cwd, status, runtime, model, parent_session_id,
        subagent_task, subagent_type, created_at, updated_at
       )
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      workspaceId,
      "child",
      cwd,
      "idle",
      "pi-sdk",
      "mock/model",
      parentSessionId,
      "child task",
      "worker",
      now,
      now,
    );
}

async function initGitRepo(): Promise<void> {
  await execFileAsync("git", ["init"], { cwd, windowsHide: true });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Modus Test"], { cwd });
  await writeFile(join(cwd, "tracked.txt"), "base\n");
  await execFileAsync("git", ["add", "tracked.txt"], { cwd, windowsHide: true });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd, windowsHide: true });
}

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "modus-pi-runtime-test-"));
  cwd = await mkdtemp(join(tmpdir(), "modus-pi-runtime-cwd-"));
  mocks.createAgentSession.mockReset();
  mocks.setPiSubscriber(undefined);
  mocks.sessionManagerCreate.mockClear();
  mocks.sessionManagerOpen.mockClear();
  mocks.resourceLoaderOptions = [];
  mocks.globalGuidance = undefined;
  mocks.killManagedProcess.mockClear();
  mocks.listManagedProcesses.mockClear();
  mocks.setManagedProcesses([]);
  mocks.createAgentSession.mockImplementation(async () => ({
    session: createMockPiSession(),
  }));
});

afterAll(async () => {
  await rm(userData, { recursive: true, force: true }).catch(() => undefined);
  await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
});

describe("PiSdkRuntime", () => {
  it("registers task as the only model-visible subagent tool", () => {
    new PiSdkRuntime();

    expect(toolRegistry.resolveActiveTools("chat")).toContain("task");
    expect(toolRegistry.resolveActiveTools("chat")).not.toContain("list_agents");
    expect(toolRegistry.resolveActiveTools("chat")).not.toContain("send_message");
    expect(toolRegistry.resolveActiveTools("chat")).not.toContain("wait_agent");
    expect(toolRegistry.resolveActiveTools("chat")).not.toContain("close_agent");
  });

  it("returns foreground subagent output from the task tool", async () => {
    const parentSessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(parentSessionId, workspaceId, join(userData, "missing.jsonl"), "Parent chat");
    const agentsDir = join(cwd, ".modus", "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      join(agentsDir, "security-auditor.md"),
      "---\nname: security-auditor\nis_background: false\n---\nSecurity reviewer.",
      "utf8",
    );
    mocks.createAgentSession.mockImplementationOnce(async () => ({
      session: createMockPiSession({
        prompt: vi.fn(async () => {
          mocks.emitPiEvent({ type: "message_start", message: { role: "assistant" } });
          mocks.emitPiEvent({
            type: "message_update",
            message: { role: "assistant" },
            assistantMessageEvent: { type: "text_delta", delta: "audit complete" },
          });
          mocks.emitPiEvent({ type: "message_end", message: { role: "assistant" } });
        }),
      }),
    }));
    new PiSdkRuntime();
    const window = createWindowStub();
    setAgentToolContext({ workspaceId, cwd, sessionId: parentSessionId, window });
    const taskTool = toolRegistry
      .getCustomToolDefinitions("chat")
      .find((definition) => definition.name === "task") as {
      execute(
        toolCallId: string,
        params: { description: string; prompt: string; subagent?: string; background?: boolean },
        signal: AbortSignal,
        onUpdate: undefined,
        ctx: { cwd: string },
      ): Promise<{ content: Array<{ type: "text"; text: string }> }>;
    };

    const result = await taskTool.execute(
      "task-call",
      { description: "Audit auth", prompt: "Audit login.", subagent: "security-auditor" },
      new AbortController().signal,
      undefined,
      { cwd },
    );

    expect(result.content[0]?.text).toContain("audit complete");
  });

  it("falls back unknown subagent task tool calls to generic foreground", async () => {
    const parentSessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(parentSessionId, workspaceId, join(userData, "missing.jsonl"), "Parent chat");
    mocks.createAgentSession.mockImplementationOnce(async () => ({
      session: createMockPiSession({
        prompt: vi.fn(async () => {
          mocks.emitPiEvent({ type: "message_start", message: { role: "assistant" } });
          mocks.emitPiEvent({
            type: "message_update",
            message: { role: "assistant" },
            assistantMessageEvent: { type: "text_delta", delta: "generic task complete" },
          });
          mocks.emitPiEvent({ type: "message_end", message: { role: "assistant" } });
        }),
      }),
    }));
    new PiSdkRuntime();
    const window = createWindowStub();
    setAgentToolContext({ workspaceId, cwd, sessionId: parentSessionId, window });
    const taskTool = toolRegistry
      .getCustomToolDefinitions("chat")
      .find((definition) => definition.name === "task") as {
      execute(
        toolCallId: string,
        params: { description: string; prompt: string; subagent?: string; background?: boolean },
        signal: AbortSignal,
        onUpdate: undefined,
        ctx: { cwd: string },
      ): Promise<{ content: Array<{ type: "text"; text: string }> }>;
    };

    const result = await taskTool.execute(
      "task-call",
      { description: "Check files", prompt: "Check the files.", subagent: "general-purpose" },
      new AbortController().signal,
      undefined,
      { cwd },
    );

    expect(result.content[0]?.text).toContain("generic task complete");
    expect(
      getDatabase()
        .prepare("select subagent_type from agent_sessions where parent_session_id = ?")
        .get(parentSessionId),
    ).toEqual({ subagent_type: "task" });
  });

  it("keeps background unknown-subagent task output free of internal run state", async () => {
    const parentSessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(parentSessionId, workspaceId, join(userData, "missing.jsonl"), "Parent chat");
    mocks.createAgentSession.mockImplementationOnce(async () => ({
      session: createMockPiSession({ prompt: vi.fn(async () => undefined) }),
    }));
    new PiSdkRuntime();
    const window = createWindowStub();
    setAgentToolContext({ workspaceId, cwd, sessionId: parentSessionId, window });
    const taskTool = toolRegistry
      .getCustomToolDefinitions("chat")
      .find((definition) => definition.name === "task") as {
      execute(
        toolCallId: string,
        params: { description: string; prompt: string; subagent?: string; background?: boolean },
        signal: AbortSignal,
        onUpdate: undefined,
        ctx: { cwd: string },
      ): Promise<{ content: Array<{ type: "text"; text: string }> }>;
    };

    const result = await taskTool.execute(
      "task-call",
      {
        description: "Explore code",
        prompt: "Explore in parallel.",
        subagent: "general-purpose",
        background: true,
      },
      new AbortController().signal,
      undefined,
      { cwd },
    );

    expect(result.content[0]?.text).toBe(
      "Started background subagent. No result is available yet.",
    );
    expect(result.content[0]?.text).not.toContain("<subagent_runs>");
    expect(result.content[0]?.text).not.toContain("completed");
    expect(result.content[0]?.text).not.toContain("result:");
    expect(
      getDatabase()
        .prepare("select subagent_type from agent_sessions where parent_session_id = ?")
        .get(parentSessionId),
    ).toEqual({ subagent_type: "task" });
  });

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
    let resolveBacking!: (value: { session: Record<string, unknown> }) => void;
    mocks.createAgentSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBacking = resolve;
        }),
    );

    const session = await runtime.create(window, {
      workspaceId,
      cwd,
      title: "New chat",
      model: "mock/model",
    });

    expect(session.cwd).toBe(cwd);
    await vi.waitFor(() => expect(mocks.createAgentSession).toHaveBeenCalled());
    resolveBacking({ session: createMockPiSession() });
    await runtime.ensure(window, session.id);
    expect(mocks.sessionManagerCreate).toHaveBeenCalledWith(cwd, expect.any(String));
    const row = getDatabase()
      .prepare("select cwd from agent_sessions where id = ?")
      .get(session.id) as { cwd: string };
    expect(row.cwd).toBe(cwd);
  });

  it("injects global guidance before workspace rules", async () => {
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    mocks.globalGuidance = "<global_guidance>global</global_guidance>";
    await writeFile(join(cwd, "AGENTS.md"), "project rules", "utf8");
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
    await runtime.ensure(window, session.id);

    const options = mocks.resourceLoaderOptions.at(-1) as { appendSystemPrompt: string[] };
    const globalIndex = options.appendSystemPrompt.findIndex((part) =>
      part.includes("<global_guidance>global"),
    );
    const rulesIndex = options.appendSystemPrompt.findIndex((part) =>
      part.includes("<project_rules>"),
    );

    expect(globalIndex).toBeGreaterThan(-1);
    expect(rulesIndex).toBeGreaterThan(globalIndex);
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
    let resolveBacking!: (value: { session: Record<string, unknown> }) => void;
    mocks.createAgentSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBacking = resolve;
        }),
    );

    const promptPromise = runtime.prompt(window, {
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

    expect(rows.slice(0, 3).map((row) => row.type)).toEqual([
      "message.started",
      "message.delta",
      "message.completed",
    ]);
    expect(JSON.parse(rows[1]?.payload_json ?? "{}")).toEqual({
      type: "message.delta",
      sessionId,
      messageId: "local-user-1",
      delta: "介绍一下你自己",
    });
    await vi.waitFor(() => expect(mocks.createAgentSession).toHaveBeenCalled());
    resolveBacking({ session: createMockPiSession() });
    await promptPromise;
    const allRows = getDatabase()
      .prepare(
        "select type from agent_events where session_id = ? order by created_at asc, rowid asc",
      )
      .all(sessionId) as Array<{ type: string }>;
    expect(allRows.map((row) => row.type)).toContain("run.started");
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

  it("publishes busy then idle run-status around a turn", async () => {
    const sessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(sessionId, workspaceId, join(userData, "missing.jsonl"), "New chat");
    const runtime = new PiSdkRuntime();
    const window = createWindowStub();

    await runtime.prompt(window, {
      context: [],
      delivery: "normal",
      message: "hi",
      sessionId,
      userMessageId: "local-user-status",
    });

    const statuses = (
      getDatabase()
        .prepare(
          "select payload_json from agent_events where session_id = ? and type = 'session.status' order by created_at asc, rowid asc",
        )
        .all(sessionId) as Array<{ payload_json: string }>
    ).map((row) => JSON.parse(row.payload_json).status.type);
    // The composer's lock follows this: working while the turn runs, released
    // exactly once it ends.
    expect(statuses).toEqual(["busy", "idle"]);
  });

  it("starts subagents without waiting and disposes their runtime after completion", async () => {
    const parentSessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(parentSessionId, workspaceId, join(userData, "missing.jsonl"), "Parent chat");
    let releasePrompt: (() => void) | undefined;
    const prompt = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releasePrompt = () => {
            mocks.emitPiEvent({ type: "message_start", message: { role: "assistant" } });
            mocks.emitPiEvent({
              type: "message_update",
              message: { role: "assistant" },
              assistantMessageEvent: { type: "text_delta", delta: "done" },
            });
            mocks.emitPiEvent({ type: "message_end", message: { role: "assistant" } });
            resolve();
          };
        }),
    );
    const childPiSession = createMockPiSession({ prompt });
    mocks.createAgentSession.mockImplementationOnce(async () => ({ session: childPiSession }));
    const runtime = new PiSdkRuntime();
    const window = createWindowStub();

    const result = await runtime.spawnSubagent(window, {
      parentSessionId,
      task: "Audit files",
      prompt: "Audit files and report back.",
      subagentType: "reviewer",
    });

    expect(result.status).toBe("running");
    expect(result.session.parentSessionId).toBe(parentSessionId);
    await vi.waitFor(() => expect(prompt).toHaveBeenCalled());
    expect(childPiSession.dispose).not.toHaveBeenCalled();
    mocks.setManagedProcesses([
      {
        id: "terminal-child",
        kind: "terminal",
        origin: "agent",
        sessionId: result.session.id,
        label: "dev server",
        status: "running",
        startedAt: new Date().toISOString(),
      },
    ]);
    releasePrompt?.();
    await vi.waitFor(() => expect(childPiSession.dispose).toHaveBeenCalled());
    expect(mocks.listManagedProcesses).toHaveBeenCalledWith({
      sessionId: result.session.id,
      origin: "agent",
    });
    expect(mocks.killManagedProcess).toHaveBeenCalledWith("terminal-child");
  });

  it("applies configured subagent prompt, readonly tools, and background flag", async () => {
    const parentSessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(parentSessionId, workspaceId, join(userData, "missing.jsonl"), "Parent chat");
    const prompt = vi.fn(async (_message: string) => {
      mocks.emitPiEvent({ type: "message_start", message: { role: "assistant" } });
      mocks.emitPiEvent({
        type: "message_update",
        message: { role: "assistant" },
        assistantMessageEvent: { type: "text_delta", delta: "done" },
      });
      mocks.emitPiEvent({ type: "message_end", message: { role: "assistant" } });
    });
    const childPiSession = createMockPiSession({ prompt });
    mocks.createAgentSession.mockImplementationOnce(async () => ({ session: childPiSession }));
    const runtime = new PiSdkRuntime();
    const window = createWindowStub();

    toolRegistry.registerTool({
      entry: {
        name: "synthetic_mutator",
        profiles: ["chat"],
        permission: { danger: "dangerous", action: "file.write" },
        ui: { iconName: "tool", verb: "Mutated" },
      },
      definition: { name: "synthetic_mutator" } as never,
    });
    try {
      await runtime.spawnSubagent(window, {
        parentSessionId,
        task: "Audit auth",
        prompt: "Check login changes.",
        subagentType: "security-auditor",
        subagent: {
          name: "security-auditor",
          body: "You are a security reviewer.",
          model: "inherit",
          readOnly: true,
          isBackground: false,
        },
      });

      await vi.waitFor(() => expect(prompt).toHaveBeenCalled());
      const message = prompt.mock.calls[0]?.[0] as unknown as string;
      expect(message).toContain('<subagent_definition name="security-auditor">');
      expect(message).toContain("You are a security reviewer.");
      expect(message).toContain("<task>\nCheck login changes.\n</task>");

      const setActiveToolsByName = childPiSession.setActiveToolsByName as ReturnType<typeof vi.fn>;
      const activeTools = setActiveToolsByName.mock.calls[0]?.[0] as string[];
      expect(activeTools).toEqual(expect.arrayContaining(["read", "grep", "find", "ls"]));
      expect(activeTools).not.toEqual(
        expect.arrayContaining(["bash", "edit", "write", "terminal_run", "browser_click", "task"]),
      );
      expect(activeTools).not.toContain("synthetic_mutator");

      const send = window.webContents.send as unknown as ReturnType<typeof vi.fn>;
      expect(send).toHaveBeenCalledWith(
        "agent:event",
        expect.objectContaining({
          type: "subagent.started",
          background: false,
          subagentType: "security-auditor",
        }),
      );
    } finally {
      toolRegistry.unregisterTool("synthetic_mutator");
    }
  });

  it("applies configured subagent tool allow and deny lists", async () => {
    const parentSessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(parentSessionId, workspaceId, join(userData, "missing.jsonl"), "Parent chat");
    const agentsDir = join(cwd, ".modus", "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      join(agentsDir, "limited-agent.md"),
      "---\nname: limited-agent\ntools: [read, grep, web_search]\ndisallowedTools: [grep]\n---\nLimited agent.",
      "utf8",
    );
    const childPiSession = createMockPiSession({
      prompt: vi.fn(async () => {
        mocks.emitPiEvent({ type: "message_start", message: { role: "assistant" } });
        mocks.emitPiEvent({
          type: "message_update",
          message: { role: "assistant" },
          assistantMessageEvent: { type: "text_delta", delta: "done" },
        });
        mocks.emitPiEvent({ type: "message_end", message: { role: "assistant" } });
      }),
    });
    mocks.createAgentSession.mockImplementationOnce(async () => ({ session: childPiSession }));
    const runtime = new PiSdkRuntime();

    await runtime.spawnSubagent(createWindowStub(), {
      parentSessionId,
      task: "Limited work",
      prompt: "Read only selected tools.",
      subagentType: "limited-agent",
      subagent: {
        name: "limited-agent",
        body: "Limited agent.",
        model: "inherit",
        readOnly: false,
        isBackground: true,
      },
    });

    await vi.waitFor(() => expect(childPiSession.setActiveToolsByName).toHaveBeenCalled());
    const activeTools = (childPiSession.setActiveToolsByName as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string[];
    expect(activeTools).toContain("read");
    expect(activeTools).toContain("web_search");
    expect(activeTools).not.toContain("grep");
    expect(activeTools).not.toContain("find");
  });

  it("creates writable worktree-isolated subagents in their own checkout", async () => {
    await initGitRepo();
    const parentSessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(parentSessionId, workspaceId, join(userData, "missing.jsonl"), "Parent chat");
    let childCwd = "";
    const childPiSession = createMockPiSession({
      prompt: vi.fn(async () => undefined),
    });
    mocks.createAgentSession.mockImplementationOnce(async (options: unknown) => {
      childCwd = (options as { cwd: string }).cwd;
      return { session: childPiSession };
    });
    const runtime = new PiSdkRuntime();

    const result = await runtime.spawnSubagent(createWindowStub(), {
      parentSessionId,
      task: "Write child file",
      prompt: "Create child.txt.",
      subagentType: "writer",
      subagent: {
        name: "writer",
        body: "Write code.",
        model: "inherit",
        readOnly: false,
        isBackground: true,
        isolation: "worktree",
      },
    });

    expect(result.session.cwd.replace(/\\/g, "/")).toContain("/.modus/worktrees/writer-");
    expect(childCwd).toBe(result.session.cwd);
    expect(result.session.subagentWorktree?.integrationStatus).toBe("running");
    expect(existsSync(result.session.cwd)).toBe(true);
    expect(existsSync(join(cwd, ".modus", "worktrees"))).toBe(true);
  });

  it("does not inject subagent run status into root prompts", async () => {
    const parentSessionId = `session-${crypto.randomUUID()}`;
    const childSessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(parentSessionId, workspaceId, join(userData, "missing.jsonl"), "Parent chat");
    insertSubagentSession(childSessionId, parentSessionId, workspaceId);
    recordAgentEvent({
      type: "message.started",
      sessionId: childSessionId,
      messageId: "assistant-message",
      role: "assistant",
    });
    recordAgentEvent({
      type: "message.delta",
      sessionId: childSessionId,
      messageId: "assistant-message",
      delta: "final result",
    });
    recordAgentEvent({
      type: "message.completed",
      sessionId: childSessionId,
      messageId: "assistant-message",
    });
    const prompt = vi.fn(async (_message: string) => {
      mocks.emitPiEvent({ type: "message_start", message: { role: "assistant" } });
      mocks.emitPiEvent({
        type: "message_update",
        message: { role: "assistant" },
        assistantMessageEvent: { type: "text_delta", delta: "parent done" },
      });
      mocks.emitPiEvent({ type: "message_end", message: { role: "assistant" } });
    });
    mocks.createAgentSession.mockImplementationOnce(async () => ({
      session: createMockPiSession({ prompt }),
    }));
    const runtime = new PiSdkRuntime();

    await runtime.prompt(createWindowStub(), {
      context: [],
      delivery: "normal",
      message: "continue",
      sessionId: parentSessionId,
      userMessageId: "local-user-subagent-runs",
    });

    const message = prompt.mock.calls[0]?.[0] as string;
    expect(message).not.toContain("<subagent_runs>");
    expect(message).not.toContain(childSessionId);
    expect(message).not.toContain("last_result");
    expect(message).not.toContain("final result");
  });

  it("aborts active subagents when the parent session is aborted", async () => {
    const parentSessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(parentSessionId, workspaceId, join(userData, "missing.jsonl"), "Parent chat");
    const childAbort = vi.fn(async () => undefined);
    const childPrompt = vi.fn(() => new Promise<void>(() => undefined));
    const childPiSession = createMockPiSession({ abort: childAbort, prompt: childPrompt });
    mocks.createAgentSession.mockImplementationOnce(async () => ({ session: childPiSession }));
    const runtime = new PiSdkRuntime();
    const window = createWindowStub();

    const result = await runtime.spawnSubagent(window, {
      parentSessionId,
      task: "Run checks",
      prompt: "Run checks.",
      subagentType: "worker",
    });
    await vi.waitFor(() => expect(childPrompt).toHaveBeenCalled());
    mocks.setManagedProcesses([
      {
        id: "app-child",
        kind: "app",
        origin: "agent",
        sessionId: result.session.id,
        label: "Preview",
        status: "running",
        startedAt: new Date().toISOString(),
      },
    ]);

    await runtime.abort(parentSessionId);

    expect(childAbort).toHaveBeenCalledOnce();
    expect(childPiSession.dispose).toHaveBeenCalled();
    expect(mocks.killManagedProcess).toHaveBeenCalledWith("app-child");
    expect(
      getDatabase()
        .prepare("select status from agent_sessions where id = ?")
        .get(result.session.id),
    ).toEqual({ status: "cancelled" });
  });

  it("does not count completed subagents against the active subagent limit", async () => {
    const parentSessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(parentSessionId, workspaceId, join(userData, "missing.jsonl"), "Parent chat");
    for (let index = 0; index < 6; index += 1) {
      insertSubagentSession(`child-${crypto.randomUUID()}`, parentSessionId, workspaceId);
    }
    const runtime = new PiSdkRuntime();

    await expect(
      runtime.spawnSubagent(createWindowStub(), {
        parentSessionId,
        task: "Fresh child",
        prompt: "Do work.",
        subagentType: "worker",
      }),
    ).resolves.toMatchObject({ status: "running" });
  });

  it("returns the final assistant output from waitSubagent", async () => {
    const parentSessionId = `session-${crypto.randomUUID()}`;
    const childSessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(parentSessionId, workspaceId, join(userData, "missing.jsonl"), "Parent chat");
    insertSubagentSession(childSessionId, parentSessionId, workspaceId);
    recordAgentEvent({
      type: "message.started",
      sessionId: childSessionId,
      messageId: "assistant-message",
      role: "assistant",
    });
    recordAgentEvent({
      type: "message.delta",
      sessionId: childSessionId,
      messageId: "assistant-message",
      delta: "final result",
    });
    recordAgentEvent({
      type: "message.completed",
      sessionId: childSessionId,
      messageId: "assistant-message",
    });
    const runtime = new PiSdkRuntime();

    await expect(
      runtime.waitSubagent(parentSessionId, { target: childSessionId }),
    ).resolves.toEqual({
      timedOut: false,
      agents: [expect.objectContaining({ id: childSessionId, output: "final result" })],
    });
  });

  it("archives child sessions before deleting the parent session", async () => {
    const parentSessionId = `session-${crypto.randomUUID()}`;
    const childSessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(parentSessionId, workspaceId, join(userData, "missing.jsonl"), "Parent chat");
    insertSubagentSession(childSessionId, parentSessionId, workspaceId);
    mocks.setManagedProcesses([
      {
        id: "terminal-archive-child",
        kind: "terminal",
        origin: "agent",
        sessionId: childSessionId,
        label: "dev server",
        status: "running",
        startedAt: new Date().toISOString(),
      },
    ]);

    await archiveAgentSession(parentSessionId);

    expect(mocks.killManagedProcess).toHaveBeenCalledWith("terminal-archive-child");
    expect(
      getDatabase()
        .prepare("select count(*) as count from agent_sessions where id in (?, ?)")
        .get(parentSessionId, childSessionId),
    ).toEqual({ count: 0 });
  });

  it("queues a steer message into the live turn without opening a phantom run", async () => {
    const sessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(sessionId, workspaceId, join(userData, "missing.jsonl"), "New chat");
    const prompt = vi.fn(async () => undefined);
    // A turn is already streaming: a steer message must JOIN it (pi queues it
    // and resolves immediately), never get its own run lifecycle — that phantom
    // run.started→run.failed is exactly what used to unlock the composer mid-turn.
    mocks.createAgentSession.mockImplementationOnce(async () => ({
      session: createMockPiSession({ isStreaming: true, prompt }),
    }));
    const runtime = new PiSdkRuntime();
    const window = createWindowStub();

    await runtime.prompt(window, {
      context: [],
      delivery: "steer",
      message: "actually use bun",
      sessionId,
      userMessageId: "local-user-steer",
    });

    const runCount = getDatabase()
      .prepare("select count(*) as count from agent_runs where session_id = ?")
      .get(sessionId);
    expect(runCount).toEqual({ count: 0 });

    const types = (
      getDatabase()
        .prepare(
          "select type from agent_events where session_id = ? order by created_at asc, rowid asc",
        )
        .all(sessionId) as Array<{ type: string }>
    ).map((row) => row.type);
    expect(types).toContain("message.started");
    expect(types).not.toContain("run.started");
    expect(types).not.toContain("run.failed");
    expect(types).not.toContain("session.status");
    expect(prompt).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ streamingBehavior: "steer" }),
    );
  });

  it("fails the run from the last assistant error when the turn ends in error", async () => {
    const sessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(sessionId, workspaceId, join(userData, "missing.jsonl"), "New chat");
    // The turn streams some text, then ends with the last assistant message
    // carrying stopReason "error" — i.e. auto-retries were exhausted. The
    // authoritative outcome is read from that message, surfaced once as a fatal
    // run.failed (never doubled, never a red retry line).
    mocks.createAgentSession.mockImplementationOnce(async () => ({
      session: createMockPiSession({
        state: {
          messages: [
            { role: "assistant", stopReason: "error", errorMessage: "Provider is overloaded" },
          ],
        },
        prompt: vi.fn(async () => {
          mocks.emitPiEvent({ type: "message_start", message: { role: "assistant" } });
          mocks.emitPiEvent({
            type: "message_update",
            message: { role: "assistant" },
            assistantMessageEvent: { type: "text_delta", delta: "partial" },
          });
          mocks.emitPiEvent({ type: "message_end", message: { role: "assistant" } });
        }),
      }),
    }));
    const runtime = new PiSdkRuntime();
    const window = createWindowStub();

    await runtime.prompt(window, {
      context: [],
      delivery: "normal",
      message: "go",
      sessionId,
      userMessageId: "local-user-fatal",
    });

    const run = getDatabase()
      .prepare(
        "select status, error from agent_runs where session_id = ? order by started_at desc limit 1",
      )
      .get(sessionId) as { status: string; error: string };
    const types = (
      getDatabase()
        .prepare(
          "select type from agent_events where session_id = ? order by created_at asc, rowid asc",
        )
        .all(sessionId) as Array<{ type: string }>
    ).map((row) => row.type);

    expect(run.status).toBe("failed");
    expect(run.error).toContain("Provider is overloaded");
    expect(types).toContain("run.failed");
    expect(types).not.toContain("run.completed");
  });

  it("drives a plan's build status from the build turn lifecycle and tags the message", async () => {
    const sessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(sessionId, workspaceId, join(userData, "missing.jsonl"), "New chat");
    const plansRoot = join(userData, "plans");
    const plan = writePlan(plansRoot, {
      workspaceId,
      slug: "feat",
      title: "Feat",
      overview: "Build the thing.",
      content: "# Feat\n",
      todos: [{ content: "Step one" }, { content: "Step two" }],
      sessionId,
    });
    expect(plan.buildStatus).toBe("not_built");

    // The build turn produces output and completes cleanly.
    mocks.createAgentSession.mockImplementationOnce(async () => ({
      session: createMockPiSession({
        prompt: vi.fn(async () => {
          mocks.emitPiEvent({ type: "message_start", message: { role: "assistant" } });
          mocks.emitPiEvent({
            type: "message_update",
            message: { role: "assistant" },
            assistantMessageEvent: { type: "text_delta", delta: "building" },
          });
          mocks.emitPiEvent({ type: "message_end", message: { role: "assistant" } });
        }),
      }),
    }));
    const runtime = new PiSdkRuntime();
    const window = createWindowStub();

    await runtime.prompt(window, {
      context: [],
      delivery: "normal",
      message: `Build the approved plan "Feat".`,
      sessionId,
      userMessageId: "local-user-build",
      planId: plan.id,
    });

    // Completed build turn → plan is built.
    expect(readPlanById(plansRoot, plan.id)?.buildStatus).toBe("built");

    const rows = getDatabase()
      .prepare(
        "select type, payload_json from agent_events where session_id = ? order by created_at asc, rowid asc",
      )
      .all(sessionId) as Array<{ type: string; payload_json: string }>;
    // The build user message is tagged so the timeline renders a Build card.
    const userMessage = rows.find((row) => row.type === "message.started");
    expect(JSON.parse(userMessage?.payload_json ?? "{}").planBuild).toEqual({
      planId: plan.id,
      title: "Feat",
      todoCount: 2,
    });
    // Status transitions are broadcast so the Plan panel + Review card react.
    expect(rows.filter((row) => row.type === "plan.updated").length).toBeGreaterThanOrEqual(2);
  });

  it("reverts a plan to not_built when the build turn fails", async () => {
    const sessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(sessionId, workspaceId, join(userData, "missing.jsonl"), "New chat");
    const plansRoot = join(userData, "plans");
    const plan = writePlan(plansRoot, {
      workspaceId,
      slug: "feat",
      title: "Feat",
      overview: "o",
      content: "# Feat\n",
      todos: [{ content: "Step one" }],
      sessionId,
    });

    // The build turn ends in error (last assistant stopReason = error).
    mocks.createAgentSession.mockImplementationOnce(async () => ({
      session: createMockPiSession({
        state: { messages: [{ role: "assistant", stopReason: "error", errorMessage: "boom" }] },
        prompt: vi.fn(async () => {
          mocks.emitPiEvent({ type: "message_start", message: { role: "assistant" } });
          mocks.emitPiEvent({
            type: "message_update",
            message: { role: "assistant" },
            assistantMessageEvent: { type: "text_delta", delta: "partial" },
          });
          mocks.emitPiEvent({ type: "message_end", message: { role: "assistant" } });
        }),
      }),
    }));
    const runtime = new PiSdkRuntime();
    const window = createWindowStub();

    await runtime.prompt(window, {
      context: [],
      delivery: "normal",
      message: "build",
      sessionId,
      userMessageId: "local-user-build-fail",
      planId: plan.id,
    });

    // A failed build turn re-opens the plan for building.
    expect(readPlanById(plansRoot, plan.id)?.buildStatus).toBe("not_built");
  });

  it("keeps an aborted in-flight run cancelled instead of failed", async () => {
    const sessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(sessionId, workspaceId, join(userData, "missing.jsonl"), "New chat");
    let rejectPrompt: ((error: Error) => void) | undefined;
    const abort = vi.fn(async () => {
      rejectPrompt?.(new Error("Aborted"));
    });
    const prompt = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPrompt = reject;
        }),
    );
    mocks.createAgentSession.mockImplementationOnce(async () => ({
      session: createMockPiSession({
        abort,
        prompt,
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
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
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
