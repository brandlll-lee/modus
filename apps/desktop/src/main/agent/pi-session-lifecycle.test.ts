import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  InMemoryCredentialStore,
} from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type AgentSessionEvent,
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

const fixtures: Array<{ session: AgentSession; cwd: string }> = [];
afterEach(async () => {
  for (const { session, cwd } of fixtures.splice(0)) {
    session.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});

async function fixture(tools: string[] = []) {
  const cwd = await mkdtemp(join(tmpdir(), "modus-pi-lifecycle-"));
  const settingsManager = SettingsManager.inMemory({
    retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 },
    compaction: { enabled: false },
  });
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    modelsStorePath: join(cwd, "models-cache.json"),
    refreshOnCreate: false,
  });
  const provider = fauxProvider({
    provider: `fixture-${crypto.randomUUID()}`,
    tokensPerSecond: 1000,
    tokenSize: { min: 4, max: 4 },
  });
  modelRuntime.registerNativeProvider(provider.provider);
  await modelRuntime.refresh({ allowNetwork: false });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: cwd,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir: cwd,
    modelRuntime,
    model: provider.getModel(),
    settingsManager,
    resourceLoader,
    sessionManager: SessionManager.inMemory(cwd),
    tools,
  });
  fixtures.push({ session, cwd });
  const events: AgentSessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  return { session, provider, events };
}

describe("PI session lifecycle", () => {
  it("continues after a native retry recovers", async () => {
    const { session, provider, events } = await fixture();
    provider.setResponses([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "502 upstream overloaded" }),
      fauxAssistantMessage("done"),
    ]);
    await session.prompt("work");
    expect(provider.state.callCount).toBe(2);
    expect(events).toContainEqual({ type: "auto_retry_end", success: true, attempt: 1 });
    expect(session.state.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop" });
    expect(session.isIdle).toBe(true);
  });

  it("continues the model loop after a tool fails", async () => {
    const { session, provider, events } = await fixture(["read"]);
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall("read", { path: "missing.txt" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("The file is unavailable."),
    ]);
    await session.prompt("read file");
    expect(provider.state.callCount).toBe(2);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool_execution_end", isError: true }),
    );
    expect(events.some((event) => event.type === "auto_retry_start")).toBe(false);
    expect(session.state.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop" });
  });

  it("ends streaming with the native aborted outcome", async () => {
    const { session, provider, events } = await fixture();
    provider.setResponses([fauxAssistantMessage("a long answer ".repeat(20))]);
    let stopping: Promise<void> | undefined;
    session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta")
        stopping ??= session.abort();
    });
    await expect(session.prompt("work")).resolves.toBeUndefined();
    await stopping;
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message_end",
        message: expect.objectContaining({ role: "assistant", stopReason: "aborted" }),
      }),
    );
    expect(events.some((event) => event.type === "auto_retry_start")).toBe(false);
    expect(session.isIdle).toBe(true);
  });

  it("retries transient failures using the configured native budget", async () => {
    const { session, provider, events } = await fixture();
    const error = fauxAssistantMessage("", {
      stopReason: "error",
      errorMessage: "502 upstream overloaded",
    });
    provider.setResponses([error, error, error, error]);
    await expect(session.prompt("work")).resolves.toBeUndefined();
    expect(provider.state.callCount).toBe(4);
    expect(events.filter((event) => event.type === "auto_retry_start")).toHaveLength(3);
    expect(events).toContainEqual({
      type: "auto_retry_end",
      success: false,
      attempt: 3,
      finalError: error.errorMessage,
    });
    expect(session.isIdle).toBe(true);
  });

  it("reports quota exhaustion without retrying", async () => {
    const { session, provider, events } = await fixture();
    provider.setResponses([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "403 insufficient quota" }),
    ]);
    await session.prompt("work");
    expect(provider.state.callCount).toBe(1);
    expect(events.some((event) => event.type === "auto_retry_start")).toBe(false);
    expect(session.isIdle).toBe(true);
  });

  it("settles cancellation during backoff normally and returns queued inputs", async () => {
    const { session, provider, events } = await fixture();
    provider.setResponses([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "502 upstream overloaded" }),
    ]);
    let stopping: Promise<void> | undefined;
    let queued: ReturnType<AgentSession["clearQueue"]> | undefined;
    session.subscribe((event) => {
      if (event.type === "auto_retry_start")
        queueMicrotask(async () => {
          await session.steer("adjust task");
          await session.followUp("next task");
          queued = session.clearQueue();
          stopping = session.abort();
        });
    });
    await expect(session.prompt("work")).resolves.toBeUndefined();
    await stopping;
    expect(queued).toEqual({ steering: ["adjust task"], followUp: ["next task"] });
    expect(provider.state.callCount).toBe(1);
    expect(events).toContainEqual({
      type: "auto_retry_end",
      success: false,
      attempt: 1,
      finalError: "Retry cancelled",
    });
    expect(session.state.messages.some((message) => message.role === "assistant")).toBe(false);
    expect(session.isIdle).toBe(true);
  });
});
