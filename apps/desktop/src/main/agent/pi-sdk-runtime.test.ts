import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
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

vi.mock("./project-trust", () => ({ resolveProjectTrust: vi.fn(async () => true) }));
vi.mock("./agent-paths", () => ({
  getPiCliAgentDir: () => join(userData, "cli"),
}));
vi.mock("@earendil-works/pi-coding-agent", async (original) => ({
  ...(await original<typeof import("@earendil-works/pi-coding-agent")>()),
  createAgentSession: mocks.createAgentSession,
  defineTool: <T>(tool: T): T => tool,
  DefaultResourceLoader: class {
    constructor(options: unknown) {
      mocks.resourceLoaderOptions.push(options);
    }
    async reload(): Promise<void> {}
    extendResources(): void {}
    getSkills(): { skills: unknown[]; diagnostics: unknown[] } {
      return { skills: [], diagnostics: [] };
    }
  },
  SessionManager: {
    create: mocks.sessionManagerCreate,
    open: mocks.sessionManagerOpen,
  },
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
  getModelRuntime: vi.fn(async () => ({})),
  getModelRegistry: vi.fn(() => ({ authStorage: {} })),
  listModels: vi.fn(() => [{ id: "mock/model" }]),
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
const { listAgentEvents } = await import("./agent-event-store");
const { toolRegistry } = await import("./tools/registry");
const { writePlan, readPlanById } = await import("../plan/plan-store");

function createMockPiSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    abort: vi.fn(async () => undefined),
    clearQueue: vi.fn(() => ({ steering: [], followUp: [] })),
    bindExtensions: vi.fn(async () => undefined),
    settingsManager: { getTheme: () => undefined },
    extensionRunner: { getUIContext: () => ({}), emit: vi.fn(async () => undefined) },
    getAllTools: () =>
      [
        ...new Set([
          ...toolRegistry.resolveActiveTools("chat"),
          ...toolRegistry.resolveActiveTools("plan"),
        ]),
      ].map((name) => ({
        name,
        exposure: "direct",
        sourceInfo: { source: "builtin", path: `builtin:${name}` },
      })),
    getToolDefinition: (name: string) =>
      [
        ...toolRegistry.getCustomToolDefinitions("chat"),
        ...toolRegistry.getCustomToolDefinitions("plan"),
      ].find((definition) => definition.name === name),
    getActiveToolNames: () => toolRegistry.resolveActiveTools("chat"),
    cycleModel: vi.fn(async () => ({ model: mocks.model })),
    dispose: vi.fn(),
    getSessionStats: vi.fn(() => ({
      contextUsage: { contextWindow: 1000, percent: 24, tokens: 240 },
      tokens: { input: 1200, output: 300, cacheRead: 800, cacheWrite: 40 },
      cost: 0.071604,
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
  it("returns the persisted titled session while native initialization is pending", async () => {
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        "insert into workspaces (id, root_path, display_name, is_git_repository, last_opened_at, created_at) values (?, ?, ?, ?, ?, ?)",
      )
      .run(workspaceId, cwd, "project", 0, now, now);
    const nativeSession = createMockPiSession();
    let finishInitialization!: (result: { session: typeof nativeSession }) => void;
    mocks.createAgentSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishInitialization = resolve;
        }),
    );
    const runtime = new PiSdkRuntime();
    const window = createWindowStub();
    const record = await runtime.create(window, { workspaceId, cwd, title: "First message title" });
    expect(record.title).toBe("First message title");
    expect(mocks.createAgentSession).not.toHaveBeenCalled();
    expect(
      getDatabase().prepare("select title from agent_sessions where id = ?").get(record.id),
    ).toMatchObject({ title: record.title });
    const restored = runtime.ensure(window, record.id);
    await vi.waitFor(() => expect(finishInitialization).toBeTypeOf("function"));
    finishInitialization({ session: nativeSession });
    expect((await restored).id).toBe(record.id);
    expect(mocks.createAgentSession).toHaveBeenCalledTimes(1);
    await runtime.releaseRuntime(record.id);
  });

  it("compacts an idle session without creating a prompt run", async () => {
    const sessionId = `session-${crypto.randomUUID()}`;
    insertSession(sessionId, `workspace-${crypto.randomUUID()}`, join(userData, "missing.jsonl"));
    const compact = vi.fn(async () => {
      mocks.emitPiEvent({ type: "compaction_start", reason: "manual" });
      mocks.emitPiEvent({
        type: "compaction_end",
        reason: "manual",
        aborted: false,
        willRetry: false,
      });
    });
    mocks.createAgentSession.mockImplementationOnce(async () => ({
      session: createMockPiSession({ compact, isIdle: true }),
    }));
    const runtime = new PiSdkRuntime();
    await runtime.compact(createWindowStub(), sessionId);

    expect(await runtime.listRuns(sessionId)).toEqual([]);
    const rows = getDatabase()
      .prepare("select type from agent_events where session_id = ? order by rowid")
      .all(sessionId) as Array<{ type: string }>;
    expect(rows.map(({ type }) => type)).toEqual([
      "session.status",
      "compaction.started",
      "compaction.ended",
      "session.status",
    ]);
  });

  it("never lets manual compaction abort a busy session", async () => {
    const sessionId = `session-${crypto.randomUUID()}`;
    insertSession(sessionId, `workspace-${crypto.randomUUID()}`, join(userData, "missing.jsonl"));
    const compact = vi.fn();
    mocks.createAgentSession.mockImplementationOnce(async () => ({
      session: createMockPiSession({ compact, isIdle: false }),
    }));

    await expect(new PiSdkRuntime().compact(createWindowStub(), sessionId)).rejects.toThrow(
      "while Modus is idle",
    );
    expect(compact).not.toHaveBeenCalled();
  });

  it("lets PI continue threshold compaction within one prompt", async () => {
    const sessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(sessionId, workspaceId, join(userData, "missing.jsonl"), "New chat");
    let promptCalls = 0;
    const session = createMockPiSession({
      prompt: vi.fn(async () => {
        promptCalls += 1;
        if (promptCalls === 1) {
          mocks.emitPiEvent({ type: "message_start", message: { role: "assistant" } });
          mocks.emitPiEvent({
            type: "message_update",
            message: { role: "assistant" },
            assistantMessageEvent: { type: "text_delta", delta: "working" },
          });
          mocks.emitPiEvent({ type: "message_end", message: { role: "assistant" } });
          mocks.emitPiEvent({
            type: "compaction_start",
            reason: "threshold",
          });
          mocks.emitPiEvent({
            type: "compaction_end",
            reason: "threshold",
            result: {
              summary: "## Next Steps\n1. Finish",
              firstKeptEntryId: "e1",
              tokensBefore: 9,
            },
            aborted: false,
            willRetry: false,
          });
        }
        mocks.emitPiEvent({ type: "message_start", message: { role: "assistant" } });
        mocks.emitPiEvent({
          type: "message_update",
          message: { role: "assistant" },
          assistantMessageEvent: { type: "text_delta", delta: "continued" },
        });
        mocks.emitPiEvent({ type: "message_end", message: { role: "assistant" } });
      }),
    });
    mocks.createAgentSession.mockImplementationOnce(async () => ({ session }));
    const runtime = new PiSdkRuntime();

    await runtime.prompt(createWindowStub(), {
      context: [],
      delivery: "normal",
      message: "long task",
      sessionId,
      userMessageId: "local-user-compact-continue",
    });

    expect(promptCalls).toBe(1);
    const types = (
      getDatabase()
        .prepare(
          "select type from agent_events where session_id = ? order by created_at asc, rowid asc",
        )
        .all(sessionId) as Array<{ type: string }>
    ).map((row) => row.type);
    expect(types).toContain("compaction.started");
    expect(types).toContain("compaction.ended");
    expect(types).toContain("run.completed");
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

  it("leaves workspace instructions to the native resource loader", async () => {
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
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

    const options = mocks.resourceLoaderOptions.at(-1) as { appendSystemPrompt?: string[] };
    expect(options.appendSystemPrompt).toBeUndefined();
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

  it("does not bump updated_at when ensure resumes a session without a new turn", async () => {
    const sessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(sessionId, workspaceId, join(userData, "missing.jsonl"));
    getDatabase()
      .prepare("update agent_sessions set updated_at = ? where id = ?")
      .run("2026-01-01T00:00:00.000Z", sessionId);

    const runtime = new PiSdkRuntime();
    await runtime.ensure(createWindowStub(), sessionId);

    const row = getDatabase()
      .prepare("select updated_at from agent_sessions where id = ?")
      .get(sessionId) as { updated_at: string };
    expect(row.updated_at).toBe("2026-01-01T00:00:00.000Z");
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
    const backing = createMockPiSession();
    resolveBacking({ session: backing });
    await promptPromise;
    expect(backing.prompt).toHaveBeenCalledWith("介绍一下你自己", { source: "rpc" });
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
    expect(window.webContents.send).toHaveBeenCalledWith("agent:event", {
      type: "session.updated",
      sessionId,
      title: "介绍一下你自己",
    });
  });

  it.each([
    "normal",
    "steer",
    "follow-up",
  ] as const)("passes image paths to PI for a %s message while keeping GUI previews", async (delivery) => {
    const sessionId = `session-${crypto.randomUUID()}`;
    insertSession(sessionId, `workspace-${crypto.randomUUID()}`, join(userData, "missing.jsonl"));
    const prompt = vi.fn(async (_text: string, _options: Record<string, unknown>) => undefined);
    const backing = createMockPiSession({ isStreaming: delivery !== "normal", prompt });
    mocks.createAgentSession.mockResolvedValueOnce({ session: backing });
    const runtime = new PiSdkRuntime();
    const uploaded = join(cwd, "original image.png");
    await writeFile(uploaded, "original image bytes");
    const bytes = Buffer.from("clipboard bytes");
    await runtime.prompt(createWindowStub(), {
      sessionId,
      delivery,
      context: [],
      message: "",
      attachments: [
        {
          type: "image",
          data: bytes.toString("base64"),
          mimeType: "image/png",
          name: "pasted.png",
        },
        {
          type: "image",
          data: "preview",
          mimeType: "image/png",
          path: uploaded,
          name: "original image.png",
        },
      ],
    });
    expect(prompt).toHaveBeenCalledOnce();
    const [text, options] = prompt.mock.calls[0] as [string, Record<string, unknown>];
    const paths = text.split("\n\n");
    const pasted = paths[0] as string;
    try {
      expect(paths).toEqual([expect.any(String), uploaded]);
      expect(await readFile(pasted)).toEqual(bytes);
      expect(await readFile(uploaded, "utf8")).toBe("original image bytes");
      expect(options).toEqual({
        source: "rpc",
        ...(delivery === "normal"
          ? {}
          : { streamingBehavior: delivery === "steer" ? "steer" : "followUp" }),
      });
      const start = listAgentEvents(sessionId).find(
        ({ event }) => event.type === "message.started",
      );
      expect(start?.event).toMatchObject({
        attachments: [{ path: pasted, data: bytes.toString("base64") }, { path: uploaded }],
      });
    } finally {
      await unlink(pasted);
      await runtime.releaseRuntime(sessionId);
    }
  });

  it("publishes SDK context and cumulative usage when a session is restored", async () => {
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
        totals: { input: 1200, output: 300, cacheRead: 800, cacheWrite: 40, cost: 0.071604 },
      },
    });
    const rows = getDatabase()
      .prepare("select type from agent_events where session_id = ?")
      .all(sessionId) as Array<{ type: string }>;
    expect(rows.map((row) => row.type)).not.toContain("context.updated");
    const calls = mocks.createAgentSession.mock.calls.length;
    const snapshot = await runtime.ensure(window, sessionId);
    expect(snapshot.contextUsage).toMatchObject({
      tokens: 240,
      totals: { input: 1200, cost: 0.071604 },
    });
    expect(mocks.createAgentSession.mock.calls).toHaveLength(calls);
    await runtime.releaseRuntime(sessionId);
    const reopened = await runtime.ensure(window, sessionId);
    expect(reopened.contextUsage).toEqual(snapshot.contextUsage);
    expect(mocks.createAgentSession.mock.calls).toHaveLength(calls + 1);
  });

  it("keeps cumulative usage while PI measures context again after compaction", async () => {
    const sessionId = `session-${crypto.randomUUID()}`;
    insertSession(sessionId, `workspace-${crypto.randomUUID()}`, join(userData, "missing.jsonl"));
    const stats = {
      contextUsage: {
        tokens: null as number | null,
        percent: null as number | null,
        contextWindow: 1000,
      },
      tokens: { input: 3000, output: 1000, cacheRead: 2000, cacheWrite: 500 },
      cost: 0.125,
    };
    const backing = createMockPiSession({ getSessionStats: () => stats });
    mocks.createAgentSession.mockImplementationOnce(async () => ({ session: backing }));
    const runtime = new PiSdkRuntime();
    const window = createWindowStub();
    await runtime.ensure(window, sessionId);
    expect(window.webContents.send).toHaveBeenCalledWith("agent:event", {
      type: "context.updated",
      sessionId,
      usage: { ...stats.contextUsage, totals: { ...stats.tokens, cost: stats.cost } },
    });
    stats.contextUsage = { tokens: 180, percent: 9, contextWindow: 2000 };
    stats.tokens.output = 1100;
    mocks.emitPiEvent({
      type: "message_end",
      message: { role: "assistant", content: [], stopReason: "stop" },
    });
    expect(window.webContents.send).toHaveBeenCalledWith("agent:event", {
      type: "context.updated",
      sessionId,
      usage: { ...stats.contextUsage, totals: { ...stats.tokens, cost: stats.cost } },
    });
    await runtime.dispose(sessionId);
  });

  it("completes a prompt handled by PI without an assistant response", async () => {
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

    expect(run.status).toBe("completed");
    expect(run.error).toBeNull();
    expect(events.map((event) => event.type)).toContain("run.completed");
    expect(events.map((event) => event.type)).not.toContain("run.failed");
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

  it("retains the native terminal error even when model projection omits it", async () => {
    const sessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(sessionId, workspaceId, join(userData, "missing.jsonl"), "New chat");
    // The turn streams some text, then ends with the last assistant message
    // carrying stopReason "error" — i.e. auto-retries were exhausted. The
    // authoritative outcome is read from that message, surfaced once as a fatal
    // run.failed (never doubled, never a red retry line).
    mocks.createAgentSession.mockImplementationOnce(async () => ({
      session: createMockPiSession({
        state: { messages: [] },
        prompt: vi.fn(async () => {
          mocks.emitPiEvent({ type: "message_start", message: { role: "assistant" } });
          mocks.emitPiEvent({
            type: "message_update",
            message: { role: "assistant" },
            assistantMessageEvent: { type: "text_delta", delta: "partial" },
          });
          mocks.emitPiEvent({
            type: "message_end",
            message: {
              role: "assistant",
              stopReason: "error",
              errorMessage: "Provider is overloaded",
            },
          });
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
      sessionId,
      title: "Feat",
      overview: "Build the thing.",
      content: "# Feat\n",
      todos: [{ content: "Step one" }, { content: "Step two" }],
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
      sessionId,
      title: "Feat",
      overview: "o",
      content: "# Feat\n",
      todos: [{ content: "Step one" }],
    });

    // The build turn ends in error (last assistant stopReason = error).
    mocks.createAgentSession.mockImplementationOnce(async () => ({
      session: createMockPiSession({
        prompt: vi.fn(async () => {
          mocks.emitPiEvent({ type: "message_start", message: { role: "assistant" } });
          mocks.emitPiEvent({
            type: "message_update",
            message: { role: "assistant" },
            assistantMessageEvent: { type: "text_delta", delta: "partial" },
          });
          mocks.emitPiEvent({
            type: "message_end",
            message: { role: "assistant", stopReason: "error", errorMessage: "boom" },
          });
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

  it.each([
    "resolved",
    "rejected",
  ] as const)("keeps an aborted run cancelled when PI prompt is %s", async (settlement) => {
    await initGitRepo();
    const sessionId = `session-${crypto.randomUUID()}`;
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    insertSession(sessionId, workspaceId, join(userData, "missing.jsonl"), "New chat");
    let finishPrompt: (() => void) | undefined;
    const clearQueue = vi.fn(() => ({ steering: ["adjust task"], followUp: ["next task"] }));
    const abort = vi.fn(async () => {
      mocks.emitPiEvent({
        type: "auto_retry_end",
        success: false,
        attempt: 1,
        finalError: "Retry cancelled",
      });
      finishPrompt?.();
    });
    const prompt = vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          mocks.emitPiEvent({
            type: "message_end",
            message: { role: "assistant", stopReason: "error", errorMessage: "Transient failure" },
          });
          finishPrompt = settlement === "resolved" ? resolve : () => reject(new Error("Aborted"));
        }),
    );
    mocks.createAgentSession.mockImplementationOnce(async () => ({
      session: createMockPiSession({
        abort,
        clearQueue,
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
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce(), { timeout: 10_000 });
    expect(await runtime.abort(sessionId)).toEqual(["adjust task", "next task"]);
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
    expect(clearQueue.mock.invocationCallOrder[0]).toBeLessThan(
      abort.mock.invocationCallOrder[0] ?? 0,
    );
    expect(run).toEqual({ status: "cancelled", error: null });
    expect(events.map((event) => event.type)).toContain("run.cancelled");
    expect(events.map((event) => event.type)).not.toContain("run.failed");
    expect(events.map((event) => event.type)).not.toContain("runtime.error");
    expect(
      getDatabase()
        .prepare(
          "select count(*) as count from agent_checkpoints where run_id = (select id from agent_runs where session_id = ?) and kind = 'turn-end'",
        )
        .get(sessionId),
    ).toEqual({ count: 1 });
  });
});
