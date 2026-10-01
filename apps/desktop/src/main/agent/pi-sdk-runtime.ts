import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  type AgentSession,
  createAgentSession,
  createCodemodeExtension,
  createToolSearchExtension,
  type ResourceLoader,
  SessionManager,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { app, type BrowserWindow as BrowserWindowType } from "electron";
import { buildContextChips } from "../../shared/context-chips";
import type {
  AgentEvent,
  AgentRunInfo,
  AgentSessionInfo,
  ModelInfo,
  PlanBuildStatus,
} from "../../shared/contracts";
import type { ToolProfileName } from "../../shared/tools";
import { releaseAgentBrowserControl } from "../browser/browser-service";
import { formatResolvedContext, resolveContext } from "../context/context-service";
import { getChangeStatsSince } from "../git/git-service";
import { denyPendingQuestionRequestsForSession } from "../interaction/question-broker";
import { IPC_CHANNELS } from "../ipc/channels";
import { createModusMcpExtension } from "../mcp/mcp-service";
import { maybeNotifyAgentEvent } from "../notifications/agent-notifications";
import { denyPendingPermissionRequestsForSession } from "../permissions/permission-broker";
import { readPlanById, setPlanBuildStatusById } from "../plan/plan-store";
import { killManagedProcess, listManagedProcesses } from "../process/managed-process-facade";
import { recordAgentEvent } from "./agent-event-store";
import { modusAgentDir } from "./agent-paths";
import { createAgentResourceLoader } from "./agent-resources";
import {
  createAgentRun,
  getActiveAgentRun,
  getAgentRun,
  listAgentRuns,
  updateAgentRunStatus,
} from "./agent-run-store";
import { createAgentSettings } from "./agent-settings";
import {
  createAgentSessionRecord,
  getAgentSession,
  touchAgentSession,
  updateAgentSessionMetadata,
  updateAgentSessionStatus,
  updateAgentSessionTitle,
} from "./agent-store";
import { createCheckpoint } from "./checkpoint-service";
import { createExtensionUI } from "./extension-ui";
import {
  cycleDefaultModel,
  findModel,
  getDefaultModel,
  getModelInfo,
  getModelRuntime,
  getModelThinkingVariant,
  listScopedModels,
  modelToId,
  resolveModelThinking,
  setDefaultModel,
  setModelThinking,
} from "./model-service";
import { createPiEventNormalizer } from "./pi-event-normalizer";
import { createModusPermissionExtension } from "./pi-permission-extension";
import { planModePreamble, profileForMode } from "./plan-prompt";
import { resolveProjectTrust } from "./project-trust";
import { PI_ROOT_LEAF } from "./rollback-service";
import type {
  AgentRuntime,
  CreateAgentRuntimeInput,
  EmitAgentEvent,
  PromptAgentInput,
} from "./runtime";
import { isRuntimeTool, withRuntimeToolPolicy } from "./runtime-tools";
import { registerSessionResources, releaseSessionResources } from "./session-resources";
import { deriveSessionTitle, shouldReplaceSessionTitle } from "./session-title";
import { registerAppTools } from "./tools/app-tools";
import { registerBrowserTools } from "./tools/browser-tools";
import { registerFastCodebaseTools } from "./tools/fast-codebase-tools";
import { plansRoot, registerPlanTools } from "./tools/plan-tools";
import { registerQuestionTools } from "./tools/question-tools";
import { toolRegistry } from "./tools/registry";
import { registerTerminalTools } from "./tools/terminal-tools";
import { registerTodoTools } from "./tools/todo-tools";
import {
  type AgentToolContext,
  runWithAgentToolContext,
  setAgentToolContext,
} from "./tools/tool-context";
import { registerWebTools } from "./tools/web-tools";

type SdkRuntimeSession = {
  info: AgentSessionInfo;
  session: AgentSession;
  profile: ToolProfileName;
  unsubscribe: () => void;
  emit: EmitAgentEvent;
  emitVolatile: EmitAgentEvent;
};

type RunOutputTracker = {
  runId: string;
  hasVisibleOutput: boolean;
  startedAt: number;
};

/**
 * Minimum gap between live `tool.delta` emissions per session. Caps the IPC/
 * render rate while a large tool argument streams. Intermediate deltas coalesce
 * to the latest args-so-far (never dropped); the durable `tool.started` still
 * carries the final args.
 */
const TOOL_DELTA_THROTTLE_MS = 100;

/** Dedupe tool definitions by name (chat + plan custom-tool sets overlap). */
function dedupeToolsByName<T extends { name: string }>(tools: T[]): T[] {
  const byName = new Map<string, T>();
  for (const tool of tools) {
    byName.set(tool.name, tool);
  }
  return [...byName.values()];
}

function toolAllowedForSession(
  profile: ToolProfileName,
  session: AgentSession,
  name: string,
): boolean {
  const definition = session.getToolDefinition(name);
  const source = session.getAllTools().find((tool) => tool.name === name)?.sourceInfo;
  if (!source || !toolRegistry.allowsProfile(name, profile, definition, source)) return false;
  return true;
}

function activeToolNamesForSession(profile: ToolProfileName, session: AgentSession): string[] {
  const active = new Set(session.getActiveToolNames());
  return session
    .getAllTools()
    .filter(
      (tool) =>
        tool.exposure !== "hidden" &&
        (tool.exposure === "direct" ||
          tool.exposure === "model-only" ||
          active.has(tool.name) ||
          isRuntimeTool(session.getToolDefinition(tool.name))) &&
        toolAllowedForSession(profile, session, tool.name),
    )
    .map((tool) => tool.name);
}

export class PiSdkRuntime implements AgentRuntime {
  private sessions = new Map<string, SdkRuntimeSession>();
  private resumePromises = new Map<string, Promise<SdkRuntimeSession | undefined>>();
  private disposePromises = new Map<string, Promise<void>>();
  private runOutputTrackers = new Map<string, RunOutputTracker>();
  private cancellingRuns = new Set<string>();

  constructor() {
    // Make the agent terminal tools (run/read/list/write/kill), the built-in
    // web tools (search/fetch), and the live to-do tool available to the chat
    // profile before any session is assembled.
    registerTerminalTools();
    registerWebTools();
    registerBrowserTools();
    registerAppTools();
    registerFastCodebaseTools();
    registerTodoTools();
    registerPlanTools();
    registerQuestionTools();
  }

  private emitToWindow(window: BrowserWindowType): EmitAgentEvent {
    return (event) => {
      recordAgentEvent(event);
      window.webContents.send(IPC_CHANNELS.agentEvent, event);
      maybeNotifyAgentEvent(window, event);
    };
  }

  private emitVolatileToWindow(window: BrowserWindowType): EmitAgentEvent {
    return (event) => {
      window.webContents.send(IPC_CHANNELS.agentEvent, event);
    };
  }

  private noteAssistantOutput(event: Parameters<EmitAgentEvent>[0]): void {
    const tracker = this.runOutputTrackers.get(event.sessionId);
    if (!tracker) {
      return;
    }

    if ((event.type === "message.delta" || event.type === "thinking.delta") && event.delta.trim()) {
      if (!tracker.hasVisibleOutput) {
        console.info(`[modus-timing] first visible output +${Date.now() - tracker.startedAt}ms`);
      }
      tracker.hasVisibleOutput = true;
      return;
    }

    if (
      event.type === "tool.started" ||
      event.type === "tool.output" ||
      event.type === "tool.ended"
    ) {
      tracker.hasVisibleOutput = true;
    }
  }

  private emitContextUsage(runtimeSession: SdkRuntimeSession): void {
    const event = createContextUsageEvent(runtimeSession.info.id, runtimeSession.session);
    if (event) {
      runtimeSession.emitVolatile(event);
    }
  }

  private toolContextFor(
    runtimeSession: SdkRuntimeSession,
    window: BrowserWindowType,
    profile: ToolProfileName,
  ): AgentToolContext {
    return {
      workspaceId: runtimeSession.info.workspaceId,
      cwd: runtimeSession.info.cwd,
      sessionId: runtimeSession.info.id,
      profile,
      window,
      emit: runtimeSession.emit,
    };
  }

  private async getOrResume(
    window: BrowserWindowType,
    sessionId: string,
    modelOverride?: string,
  ): Promise<SdkRuntimeSession | undefined> {
    await this.disposePromises.get(sessionId);
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const pending = this.resumePromises.get(sessionId);
    if (pending) {
      return await pending;
    }

    const next = this.createRuntimeSession(window, sessionId, modelOverride).finally(() => {
      this.resumePromises.delete(sessionId);
    });
    this.resumePromises.set(sessionId, next);
    return await next;
  }

  async ensure(window: BrowserWindowType, sessionId: string): Promise<AgentSessionInfo> {
    const runtimeSession = await this.getOrResume(window, sessionId);
    if (!runtimeSession) {
      throw new Error(`Agent session not found: ${sessionId}`);
    }
    return runtimeSession.info;
  }

  private async createSessionResources(
    cwd: string,
    sessionId: string,
    emit: EmitAgentEvent,
  ): Promise<{ settingsManager: SettingsManager; loader: ResourceLoader }> {
    const projectTrusted = await resolveProjectTrust(cwd);
    const settingsManager = createAgentSettings({
      cwd,
      projectTrusted,
      overrides: {
        packages: [],
        extensions: [],
        skills: [],
        prompts: [],
        themes: [],
      },
    });
    const loader = await createAgentResourceLoader(cwd, settingsManager, [
      {
        name: "session-model",
        factory: (pi) => {
          pi.on("model_select", ({ model }) => {
            const info = updateAgentSessionMetadata(sessionId, { model: modelToId(model) });
            const runtime = this.sessions.get(sessionId);
            if (info && runtime) runtime.info = info;
            if (info) emit({ type: "session.updated", sessionId, title: info.title });
          });
          pi.on("thinking_level_select", () => {
            const info = getAgentSession(sessionId);
            if (info) emit({ type: "session.updated", sessionId, title: info.title });
          });
        },
      },
      { name: "codemode", factory: withRuntimeToolPolicy(createCodemodeExtension()) },
      { name: "tool_search", factory: withRuntimeToolPolicy(createToolSearchExtension()) },
      { name: "mcp", factory: createModusMcpExtension() },
      createModusPermissionExtension(sessionId, emit, cwd, {
        definition: (name) => this.sessions.get(sessionId)?.session.getToolDefinition(name),
        source: (name) =>
          this.sessions
            .get(sessionId)
            ?.session.getAllTools()
            .find((tool) => tool.name === name)?.sourceInfo,
        allows: (name) => {
          const runtime = this.sessions.get(sessionId);
          return runtime ? toolAllowedForSession(runtime.profile, runtime.session, name) : false;
        },
      }),
    ]);
    return { settingsManager, loader };
  }

  /**
   * Shared session assembly for both new and resumed sessions: builds session
   * options (with the chat tool profile + any registered custom tools), wires
   * event normalization, persists metadata, and caches the runtime session.
   */
  private async assembleSession(params: {
    info: AgentSessionInfo;
    emit: EmitAgentEvent;
    emitVolatile: EmitAgentEvent;
    agentDir: string;
    loader: ResourceLoader;
    settingsManager: SettingsManager;
    sessionManager: SessionManager;
    model: NonNullable<Parameters<typeof createAgentSession>[0]>["model"];
    thinkingLevel: NonNullable<Parameters<typeof createAgentSession>[0]>["thinkingLevel"];
  }): Promise<SdkRuntimeSession> {
    const sessionOptions: Parameters<typeof createAgentSession>[0] = {
      cwd: params.info.cwd,
      agentDir: params.agentDir,
      modelRuntime: await getModelRuntime(),
      resourceLoader: params.loader,
      sessionManager: params.sessionManager,
      settingsManager: params.settingsManager,
      scopedModels: await listScopedModels(params.settingsManager),
      // Register chat + plan custom tools so a turn can switch its active set by
      // mode (plan_write becomes available without recreating the session).
      customTools: dedupeToolsByName([
        ...toolRegistry.getCustomToolDefinitions("chat"),
        ...toolRegistry.getCustomToolDefinitions("plan"),
      ]),
    };
    if (params.model !== undefined) {
      sessionOptions.model = params.model;
      if (params.thinkingLevel !== undefined) {
        sessionOptions.thinkingLevel = params.thinkingLevel;
      }
    }

    const { session, modelFallbackMessage } = await createAgentSession(sessionOptions);
    if (modelFallbackMessage) {
      session.dispose();
      throw new Error(modelFallbackMessage);
    }
    const normalizePiEvent = createPiEventNormalizer(params.info.id);
    const publishContextUsage = () => {
      const event = createContextUsageEvent(params.info.id, session);
      if (event) {
        params.emitVolatile(event);
      }
    };
    // Per-session coalesce for live tool-call streaming. Keep the latest
    // args-so-far and emit at most once per TOOL_DELTA_THROTTLE_MS — never drop
    // the newest frame. `tool.started` still delivers final args durably.
    let lastToolDeltaAt = 0;
    let pendingToolDelta: Extract<AgentEvent, { type: "tool.delta" }> | undefined;
    let toolDeltaTimer: ReturnType<typeof setTimeout> | undefined;
    const hiddenToolCallIds = new Set<string>();
    let runtimeSession: SdkRuntimeSession | undefined;
    const flushPendingToolDelta = (): void => {
      toolDeltaTimer = undefined;
      if (!pendingToolDelta) return;
      const event = pendingToolDelta;
      pendingToolDelta = undefined;
      lastToolDeltaAt = Date.now();
      params.emitVolatile(event);
    };
    const sessionUnsubscribe = session.subscribe((event) => {
      for (const normalized of normalizePiEvent(event)) {
        if (normalized.type === "tool.started") {
          const label = session.getToolDefinition(normalized.toolName)?.label;
          if (label) normalized.label = label;
        }
        if (normalized.type === "tool.delta" || normalized.type === "tool.started") {
          const hiddenProfiles = toolRegistry.getEntry(normalized.toolName)?.ui
            .hiddenFromTimelineInProfiles;
          if (hiddenProfiles?.includes(runtimeSession?.profile ?? "chat")) {
            hiddenToolCallIds.add(normalized.toolCallId);
            continue;
          }
        }
        if (
          (normalized.type === "tool.output" || normalized.type === "tool.ended") &&
          hiddenToolCallIds.has(normalized.toolCallId)
        ) {
          if (normalized.type === "tool.ended") hiddenToolCallIds.delete(normalized.toolCallId);
          continue;
        }
        this.noteAssistantOutput(normalized);
        if (normalized.type === "tool.delta") {
          pendingToolDelta = normalized;
          const wait = TOOL_DELTA_THROTTLE_MS - (Date.now() - lastToolDeltaAt);
          if (wait <= 0) {
            if (toolDeltaTimer !== undefined) {
              clearTimeout(toolDeltaTimer);
              toolDeltaTimer = undefined;
            }
            flushPendingToolDelta();
          } else if (toolDeltaTimer === undefined) {
            toolDeltaTimer = setTimeout(flushPendingToolDelta, wait);
          }
        } else {
          if (pendingToolDelta || toolDeltaTimer !== undefined) {
            if (toolDeltaTimer !== undefined) clearTimeout(toolDeltaTimer);
            flushPendingToolDelta();
          }
          params.emit(normalized);
        }
      }
      if (shouldPublishContextUsage(event)) {
        publishContextUsage();
      }
    });
    const unsubscribe = (): void => {
      if (toolDeltaTimer !== undefined) {
        clearTimeout(toolDeltaTimer);
        toolDeltaTimer = undefined;
      }
      if (pendingToolDelta) {
        params.emitVolatile(pendingToolDelta);
        pendingToolDelta = undefined;
      }
      sessionUnsubscribe();
    };

    const metadata: Parameters<typeof updateAgentSessionMetadata>[1] = {
      piSessionId: session.sessionId,
    };
    const nextModelId = session.model
      ? modelToId(session.model)
      : params.model
        ? modelToId(params.model)
        : params.info.model;
    if (nextModelId !== undefined) {
      metadata.model = nextModelId;
    }
    if (session.sessionFile !== undefined) {
      metadata.piSessionFile = session.sessionFile;
    }
    const updated = updateAgentSessionMetadata(params.info.id, metadata) ?? params.info;
    updateAgentSessionStatus(params.info.id, "idle");
    runtimeSession = {
      info: updated,
      session,
      profile: "chat",
      unsubscribe,
      emit: params.emit,
      emitVolatile: params.emitVolatile,
    };
    this.sessions.set(params.info.id, runtimeSession);
    try {
      await session.bindExtensions({
        uiContext: createExtensionUI(session, params.info.id, params.emit),
        mode: "rpc",
      });
      registerSessionResources({
        id: params.info.id,
        cwd: params.info.cwd,
        session,
        loader: params.loader,
      });
    } catch (error) {
      this.sessions.delete(params.info.id);
      await session.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" });
      unsubscribe();
      session.dispose();
      throw error;
    }
    publishContextUsage();
    return runtimeSession;
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.resumePromises.values()]);
    const results = await Promise.allSettled(
      [...this.sessions.keys()].map((id) => this.dispose(id)),
    );
    await Promise.allSettled([...this.disposePromises.values()]);
    const errors = results.filter((result) => result.status === "rejected");
    if (errors.length)
      throw new AggregateError(
        errors.map((result) => result.reason),
        "Failed to close agent sessions.",
      );
  }

  async create(
    window: BrowserWindowType,
    input: CreateAgentRuntimeInput,
  ): Promise<AgentSessionInfo> {
    const emit = this.emitToWindow(window);
    const emitVolatile = this.emitVolatileToWindow(window);
    const selectedModel = input.model ? findModel(input.model) : getDefaultModel();
    if (!selectedModel) {
      throw new Error(
        `Model is not available: ${input.model ?? "default"}. Check the native provider configuration.`,
      );
    }
    const modelId = selectedModel ? modelToId(selectedModel) : input.model;
    const recordInput: Parameters<typeof createAgentSessionRecord>[0] = {
      workspaceId: input.workspaceId,
      cwd: input.cwd,
      title: input.title,
      runtime: "pi-sdk",
      ...(input.id !== undefined ? { id: input.id } : {}),
    };
    if (modelId !== undefined) {
      recordInput.model = modelId;
    }
    const info = createAgentSessionRecord(recordInput);
    const selectedThinking = selectedModel ? resolveModelThinking(selectedModel) : undefined;

    const agentDir = modusAgentDir();
    const sessionDir = join(app.getPath("userData"), "pi-sessions");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(sessionDir, { recursive: true });

    const warmup = (async () => {
      const { settingsManager, loader } = await this.createSessionResources(
        input.cwd,
        info.id,
        emit,
      );
      return await this.assembleSession({
        info,
        emit,
        emitVolatile,
        agentDir,
        loader,
        settingsManager,
        sessionManager: SessionManager.create(input.cwd, sessionDir),
        model: selectedThinking?.model ?? selectedModel,
        thinkingLevel: selectedThinking?.thinkingLevel,
      });
    })().finally(() => {
      this.resumePromises.delete(info.id);
    });
    this.resumePromises.set(info.id, warmup);
    void warmup.catch(() => {
      updateAgentSessionStatus(info.id, "error");
    });
    return info;
  }

  private async createRuntimeSession(
    window: BrowserWindowType,
    sessionId: string,
    modelOverride?: string,
  ): Promise<SdkRuntimeSession | undefined> {
    const info = getAgentSession(sessionId);
    if (!info) {
      return undefined;
    }

    const emit = this.emitToWindow(window);
    const emitVolatile = this.emitVolatileToWindow(window);
    const agentDir = modusAgentDir();
    const sessionDir = join(app.getPath("userData"), "pi-sessions");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(sessionDir, { recursive: true });

    const { settingsManager, loader } = await this.createSessionResources(info.cwd, info.id, emit);

    const requestedModel = modelOverride ?? info.model;
    const selectedModel = requestedModel ? findModel(requestedModel) : getDefaultModel();
    if (!selectedModel && !info.piSessionFile) {
      throw new Error(
        `Model is not available: ${requestedModel ?? "default"}. Check the native provider configuration.`,
      );
    }
    const selectedThinking = selectedModel ? resolveModelThinking(selectedModel) : undefined;
    const sessionFile =
      info.piSessionFile && existsSync(info.piSessionFile) ? info.piSessionFile : undefined;
    let sessionManager: SessionManager;
    try {
      sessionManager = sessionFile
        ? SessionManager.open(sessionFile, sessionDir, info.cwd)
        : SessionManager.create(info.cwd, sessionDir);
    } catch {
      sessionManager = SessionManager.create(info.cwd, sessionDir);
    }
    return this.assembleSession({
      info,
      emit,
      emitVolatile,
      agentDir,
      loader,
      settingsManager,
      sessionManager,
      model: sessionFile && !modelOverride ? undefined : (selectedThinking?.model ?? selectedModel),
      thinkingLevel: sessionFile && !modelOverride ? undefined : selectedThinking?.thinkingLevel,
    });
  }

  async prompt(window: BrowserWindowType, input: PromptAgentInput): Promise<void> {
    const delivery = input.delivery ?? "normal";
    const emit = this.emitToWindow(window);
    let earlyUserMessageId: string | undefined;
    const failEarlyPrompt = (error: unknown): Error => {
      const message = error instanceof Error ? error.message : String(error);
      if (earlyUserMessageId !== undefined) {
        updateAgentSessionStatus(input.sessionId, "error");
        emit({ type: "runtime.error", sessionId: input.sessionId, message });
        emit({ type: "session.status", sessionId: input.sessionId, status: { type: "idle" } });
      }
      return error instanceof Error ? error : new Error(message);
    };
    if (delivery === "normal") {
      earlyUserMessageId = input.userMessageId ?? `local-user:${randomUUID()}`;
      const buildPlan = input.planId ? readPlanById(plansRoot(), input.planId) : undefined;
      this.emitUserMessage(
        emit,
        input,
        earlyUserMessageId,
        buildPlan
          ? { planId: buildPlan.id, title: buildPlan.title, todoCount: buildPlan.todos.length }
          : undefined,
      );
      updateAgentSessionStatus(input.sessionId, "running");
      emit({ type: "session.status", sessionId: input.sessionId, status: { type: "busy" } });
    }

    let runtimeSession: SdkRuntimeSession | undefined;
    try {
      runtimeSession = await this.getOrResume(window, input.sessionId);
    } catch (error) {
      throw failEarlyPrompt(error);
    }
    if (!runtimeSession) {
      throw failEarlyPrompt(`Agent session not running: ${input.sessionId}`);
    }

    // Activity sort key: bump only on real user turns — never on open/ensure/status.
    runtimeSession.info = {
      ...runtimeSession.info,
      updatedAt: touchAgentSession(input.sessionId),
    };

    const profile = profileForMode(input.mode);
    runtimeSession.profile = profile;
    const toolContext = this.toolContextFor(runtimeSession, window, profile);
    setAgentToolContext(toolContext);

    try {
      // Per-turn mode: switch the active tool set (plan = read-only research +
      // plan artifacts; build = full chat tools). setActiveToolsByName also rebuilds
      // the system prompt for the new set, and takes effect on this turn.
      runtimeSession.session.setActiveToolsByName(
        activeToolNamesForSession(profile, runtimeSession.session),
      );

      // Per-turn model + thinking: the composer's current selection travels with
      // the prompt and is applied authoritatively here, so the turn never runs
      // with stale model/thinking (mid-session switch, edit-and-resend, resume).
      if (input.model !== undefined) {
        await this.applyModelSelection(
          runtimeSession,
          input.model,
          input.thinkingVariant ?? input.thinkingLevel,
        );
      }
    } catch (error) {
      throw failEarlyPrompt(error);
    }

    // Authoritative turn boundary: if a turn is already streaming, this message
    // JOINS it — pi queues it (steer/followUp) and resolves prompt() the moment
    // it is enqueued. A queued message is NOT a new run; wrapping it in a run
    // lifecycle would emit a phantom run.started→run.completed/failed that
    // settles the composer while the real turn is still streaming. We trust
    // pi's own `isStreaming`, never a guess from the delivery label.
    if (delivery !== "normal" && runtimeSession.session.isStreaming) {
      await this.enqueueTurnMessage(runtimeSession, input, delivery, toolContext);
      return;
    }

    if (shouldReplaceSessionTitle(runtimeSession.info.title)) {
      const title = deriveSessionTitle(input.message);
      const updated = updateAgentSessionTitle(input.sessionId, title);
      if (updated) {
        runtimeSession.info = updated;
        runtimeSession.emitVolatile({ type: "session.updated", sessionId: input.sessionId, title });
      }
    }
    const runInput: Parameters<typeof createAgentRun>[0] = {
      sessionId: input.sessionId,
      prompt: input.message,
    };
    if (earlyUserMessageId !== undefined) runInput.userMessageId = earlyUserMessageId;
    else if (input.userMessageId !== undefined) runInput.userMessageId = input.userMessageId;
    if (runtimeSession.info.model !== undefined) runInput.model = runtimeSession.info.model;
    // Rollback anchor: the session-tree leaf right before this prompt. Reaching
    // here means a fresh turn (normal delivery, or a steer/follow-up that found
    // no live turn to join), so the anchor is always meaningful.
    runInput.piLeafBefore = runtimeSession.session.sessionManager.getLeafId() ?? PI_ROOT_LEAF;
    const run = createAgentRun(runInput);
    const outputTracker: RunOutputTracker = {
      runId: run.id,
      hasVisibleOutput: false,
      startedAt: Date.now(),
    };
    this.runOutputTrackers.set(input.sessionId, outputTracker);

    updateAgentSessionStatus(input.sessionId, "running");
    const userMessageId = earlyUserMessageId ?? input.userMessageId ?? `user:${run.id}`;
    // A "Build this plan" turn carries planId: tag the user message so the
    // timeline renders a compact Build card, and bind the plan's build status to
    // this run's authoritative lifecycle (building now → built/not_built later).
    const buildPlan = input.planId ? readPlanById(plansRoot(), input.planId) : undefined;
    if (earlyUserMessageId === undefined) {
      this.emitUserMessage(
        runtimeSession.emit,
        input,
        userMessageId,
        buildPlan
          ? { planId: buildPlan.id, title: buildPlan.title, todoCount: buildPlan.todos.length }
          : undefined,
      );
    }
    const startedEvent = {
      type: "run.started",
      sessionId: input.sessionId,
      runId: run.id,
      userMessageId,
      delivery,
    } as const;
    runtimeSession.emit(startedEvent);
    // The turn is now streaming: publish the authoritative `busy` status that
    // the composer's lock + border follow. `idle` is published in `finally`,
    // and `retry` arrives (from the normalizer) if the runtime auto-retries.
    if (earlyUserMessageId === undefined) {
      runtimeSession.emit({
        type: "session.status",
        sessionId: input.sessionId,
        status: { type: "busy" },
      });
    }
    if (input.planId) {
      this.transitionPlanBuild(runtimeSession, input.planId, "building");
    }
    // Snapshot the working tree before the agent touches anything, so this
    // message gets a one-click restore point in the timeline. Never blocks
    // the run: failures (non-git cwd, git missing) degrade to "no checkpoint".
    let runCheckpoint: Awaited<ReturnType<typeof createCheckpoint>>;
    try {
      runCheckpoint = await createCheckpoint({
        sessionId: input.sessionId,
        cwd: runtimeSession.info.cwd,
        runId: run.id,
        userMessageId,
      });
      console.info(`[modus-timing] createCheckpoint +${Date.now() - outputTracker.startedAt}ms`);
      if (runCheckpoint) {
        runtimeSession.emit({
          type: "checkpoint.created",
          sessionId: input.sessionId,
          checkpoint: runCheckpoint,
        });
      }
    } catch (error) {
      console.warn("[modus] checkpoint failed:", error);
    }
    let turnEndAttempted = false;
    const captureTurnEnd = async (): Promise<void> => {
      if (!runCheckpoint || turnEndAttempted || !getAgentRun(run.id)) return;
      turnEndAttempted = true;
      await createCheckpoint({
        sessionId: input.sessionId,
        cwd: runtimeSession.info.cwd,
        runId: run.id,
        userMessageId,
        kind: "turn-end",
      }).catch((error) => {
        console.warn("[modus] turn-end checkpoint failed:", error);
        return undefined;
      });
    };
    try {
      const message = await this.composeTurnMessage(runtimeSession, input);
      console.info(
        `[modus-timing] composeTurnMessage done +${Date.now() - outputTracker.startedAt}ms`,
      );
      const images = buildTurnImages(input);
      await runWithAgentToolContext(toolContext, () =>
        runtimeSession.session.prompt(message, {
          source: "rpc",
          ...(images.length > 0 ? { images } : {}),
          ...(delivery !== "normal"
            ? { streamingBehavior: delivery === "follow-up" ? "followUp" : "steer" }
            : {}),
        }),
      );
      this.emitContextUsage(runtimeSession);
      const currentRun = getAgentRun(run.id);
      if (currentRun?.status === "running") {
        // Authoritative end-of-turn outcome, read from pi's own record: if the
        // last assistant message ended with `stopReason: "error"`, the turn
        // failed after exhausting any auto-retries. This is the SINGLE place a
        // model error becomes a fatal `run.failed` (red), so transient retries
        // never paint red and the final error is never doubled.
        const turnError = lastAssistantTurnError(runtimeSession.session);
        if (turnError) {
          await captureTurnEnd();
          updateAgentRunStatus(run.id, "failed", turnError);
          updateAgentSessionStatus(input.sessionId, "error");
          runtimeSession.emit({
            type: "run.failed",
            sessionId: input.sessionId,
            runId: run.id,
            message: turnError,
          });
          if (input.planId) {
            this.transitionPlanBuild(runtimeSession, input.planId, "not_built");
          }
        } else if (outputTracker.hasVisibleOutput) {
          // Per-turn change summary (Codex-style "N files changed" card):
          // diff the checkout against the pre-run snapshot. Never blocks or
          // fails the run; sessions without a checkpoint just omit it.
          let changes: Awaited<ReturnType<typeof getChangeStatsSince>> | undefined;
          if (runCheckpoint) {
            changes = await getChangeStatsSince(
              runtimeSession.info.cwd,
              runCheckpoint.commitHash,
            ).catch(() => undefined);
          }
          console.info(
            `[modus-timing] getChangeStatsSince +${Date.now() - outputTracker.startedAt}ms`,
          );
          await captureTurnEnd();
          updateAgentRunStatus(run.id, "completed");
          runtimeSession.emit({
            type: "run.completed",
            sessionId: input.sessionId,
            runId: run.id,
            ...(changes && changes.fileCount > 0 ? { changes } : {}),
          });
          // The build turn completed cleanly → the plan is built.
          if (input.planId) {
            this.transitionPlanBuild(runtimeSession, input.planId, "built");
          }
        } else {
          const message =
            "The selected model finished without returning any assistant output. Check the custom provider URL, model id, API type, and reasoning compatibility settings.";
          await captureTurnEnd();
          updateAgentRunStatus(run.id, "failed", message);
          updateAgentSessionStatus(input.sessionId, "error");
          runtimeSession.emit({
            type: "run.failed",
            sessionId: input.sessionId,
            runId: run.id,
            message,
          });
          runtimeSession.emit({ type: "runtime.error", sessionId: input.sessionId, message });
          if (input.planId) {
            this.transitionPlanBuild(runtimeSession, input.planId, "not_built");
          }
        }
      }
    } catch (error) {
      // The build turn ended without completing (manual stop, disconnect, or a
      // real failure) → the plan reverts to not_built so it can be built again.
      if (input.planId) {
        this.transitionPlanBuild(runtimeSession, input.planId, "not_built");
      }
      // A missing run row means a rollback removed this run while it was being
      // aborted — swallow the rejection instead of resurrecting ghost
      // run.failed / runtime.error events into the rolled-back timeline.
      const currentRun = getAgentRun(run.id);
      if (!currentRun || currentRun.status === "cancelled") {
        return;
      }
      if (this.cancellingRuns.has(run.id)) {
        await captureTurnEnd();
        updateAgentRunStatus(run.id, "cancelled");
        runtimeSession.emit({ type: "run.cancelled", sessionId: input.sessionId, runId: run.id });
        return;
      }
      await captureTurnEnd();
      updateAgentRunStatus(
        run.id,
        "failed",
        error instanceof Error ? error.message : String(error),
      );
      updateAgentSessionStatus(input.sessionId, "error");
      runtimeSession.emit({
        type: "run.failed",
        sessionId: input.sessionId,
        runId: run.id,
        message: error instanceof Error ? error.message : String(error),
      });
      runtimeSession.emit({
        type: "runtime.error",
        sessionId: input.sessionId,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      await captureTurnEnd();
      this.runOutputTrackers.delete(input.sessionId);
      console.info(
        `[modus-timing] turn end (idle emit) +${Date.now() - outputTracker.startedAt}ms`,
      );
      const session = getAgentSession(input.sessionId);
      if (session?.status !== "error") {
        updateAgentSessionStatus(input.sessionId, "idle");
      }
      // The turn is over (completed/failed/cancelled all funnel through here):
      // publish the authoritative `idle` status so the composer unlocks, and
      // dim the in-app browser's "AI in control" glow + cursor.
      runtimeSession.emit({
        type: "session.status",
        sessionId: input.sessionId,
        status: { type: "idle" },
      });
      if (session?.workspaceId) {
        releaseAgentBrowserControl(session.workspaceId);
      }
    }
  }

  async compact(window: BrowserWindowType, sessionId: string): Promise<void> {
    const runtimeSession = await this.getOrResume(window, sessionId);
    if (!runtimeSession) {
      throw new Error(`Agent session not found: ${sessionId}`);
    }
    if (!runtimeSession.session.isIdle) {
      throw new Error("Context can only be compacted while Modus is idle.");
    }

    updateAgentSessionStatus(sessionId, "running");
    runtimeSession.emit({ type: "session.status", sessionId, status: { type: "busy" } });
    try {
      await runtimeSession.session.compact();
    } finally {
      updateAgentSessionStatus(sessionId, "idle");
      runtimeSession.emit({ type: "session.status", sessionId, status: { type: "idle" } });
    }
  }

  /**
   * Emit the user's message into the timeline (started → full text → completed),
   * carrying any attachments and context chips. Shared by a fresh turn and a
   * queued steer/follow-up so the sent message always shows the same way.
   */
  private emitUserMessage(
    emit: EmitAgentEvent,
    input: PromptAgentInput,
    userMessageId: string,
    planBuild?: { planId: string; title: string; todoCount: number },
  ): void {
    const contextChips = buildContextChips(input.context ?? []);
    emit({
      type: "message.started",
      sessionId: input.sessionId,
      messageId: userMessageId,
      role: "user",
      ...(input.attachments && input.attachments.length > 0
        ? { attachments: input.attachments }
        : {}),
      ...(contextChips.length > 0 ? { contextChips } : {}),
      ...(input.context && input.context.length > 0 ? { contextItems: input.context } : {}),
      ...(input.skills && input.skills.length > 0 ? { skills: input.skills } : {}),
      ...(planBuild ? { planBuild } : {}),
    });
    emit({
      type: "message.delta",
      sessionId: input.sessionId,
      messageId: userMessageId,
      delta: input.message,
    });
    emit({
      type: "message.completed",
      sessionId: input.sessionId,
      messageId: userMessageId,
    });
  }

  private async composeTurnMessage(
    runtimeSession: SdkRuntimeSession,
    input: PromptAgentInput,
  ): Promise<string> {
    const resolved = await resolveContext(runtimeSession.info.cwd, input.context);
    const contextText = formatResolvedContext(resolved);
    const message = [planModePreamble(input.mode), contextText, input.message]
      .filter(Boolean)
      .join("\n\n");
    if ((input.skills?.length ?? 0) > 1) throw new Error("Choose one skill for this prompt.");
    const selected = input.skills?.[0];
    if (!selected) return message;
    const skill = runtimeSession.session.resourceLoader
      .getSkills()
      .skills.find((item) => item.filePath === selected.path);
    if (!skill)
      throw new Error(
        "The selected skill is not available in this session. Refresh the skill menu.",
      );
    return `/skill:${skill.name} ${message}`;
  }

  /**
   * Queue a steer/follow-up message into the turn that is already streaming.
   * pi resolves `prompt()` as soon as the message is enqueued, so there is no
   * run to open or settle — the owning turn keeps its single run lifecycle and
   * its `busy` status. If queueing fails (e.g. the turn ended in the gap), the
   * error surfaces as a plain `runtime.error`, never a phantom run.failed.
   */
  private async enqueueTurnMessage(
    runtimeSession: SdkRuntimeSession,
    input: PromptAgentInput,
    delivery: NonNullable<PromptAgentInput["delivery"]>,
    toolContext: AgentToolContext,
  ): Promise<void> {
    const userMessageId = input.userMessageId ?? `local-user:${randomUUID()}`;
    this.emitUserMessage(runtimeSession.emit, input, userMessageId);
    try {
      const message = await this.composeTurnMessage(runtimeSession, input);
      const images = buildTurnImages(input);
      await runWithAgentToolContext(toolContext, () =>
        runtimeSession.session.prompt(message, {
          source: "rpc",
          ...(images.length > 0 ? { images } : {}),
          streamingBehavior: delivery === "follow-up" ? "followUp" : "steer",
        }),
      );
      this.emitContextUsage(runtimeSession);
    } catch (error) {
      runtimeSession.emit({
        type: "runtime.error",
        sessionId: input.sessionId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Drive a plan's build status from the build turn's authoritative run
   * lifecycle and notify the UI. The composer's Review card and the Plan panel
   * read this status — building/built hide the card, not_built re-opens it.
   */
  private transitionPlanBuild(
    runtimeSession: SdkRuntimeSession,
    planId: string,
    status: PlanBuildStatus,
  ): void {
    const plan = setPlanBuildStatusById(plansRoot(), planId, status);
    if (plan) {
      runtimeSession.emit({ type: "plan.updated", sessionId: runtimeSession.info.id, plan });
    }
  }

  async abort(sessionId: string): Promise<void> {
    await this.abortSessionOnly(sessionId);
  }

  private async abortSessionOnly(sessionId: string): Promise<void> {
    const runtimeSession = this.sessions.get(sessionId);
    if (!runtimeSession) {
      return;
    }
    const activeRun = getActiveAgentRun(sessionId);
    if (activeRun) {
      this.cancellingRuns.add(activeRun.id);
    }

    try {
      await runtimeSession.session.abort();
    } finally {
      if (activeRun) {
        this.cancellingRuns.delete(activeRun.id);
      }
      updateAgentSessionStatus(sessionId, "idle");
    }
  }

  async listRuns(sessionId: string): Promise<AgentRunInfo[]> {
    return listAgentRuns(sessionId);
  }

  async dispose(sessionId: string): Promise<void> {
    await this.cleanupSessionProcesses(sessionId);
    await this.disposeSessionOnly(sessionId);
  }

  async releaseRuntime(sessionId: string): Promise<void> {
    // A pane owns the SDK cache, never the session's managed processes.
    await this.disposeSessionOnly(sessionId);
  }

  private disposeSessionOnly(sessionId: string): Promise<void> {
    const pending = this.disposePromises.get(sessionId);
    if (pending) return pending;
    const operation = this.closeRuntimeSession(sessionId).finally(() =>
      this.disposePromises.delete(sessionId),
    );
    this.disposePromises.set(sessionId, operation);
    return operation;
  }

  private async closeRuntimeSession(sessionId: string): Promise<void> {
    // Settle any in-flight resume first: it would otherwise re-cache a live
    // session right after this dispose (and a rollback would then truncate the
    // session file while a stale in-memory tree keeps answering prompts).
    const pending = this.resumePromises.get(sessionId);
    if (pending) {
      await pending.catch(() => undefined);
    }

    const runtimeSession = this.sessions.get(sessionId);
    if (!runtimeSession) {
      return;
    }

    this.sessions.delete(sessionId);
    releaseSessionResources(sessionId);
    denyPendingQuestionRequestsForSession(sessionId);
    denyPendingPermissionRequestsForSession(sessionId, "Session closed");
    try {
      if (runtimeSession.session.isStreaming) await runtimeSession.session.abort();
      await runtimeSession.session.extensionRunner?.emit({
        type: "session_shutdown",
        reason: "quit",
      });
    } finally {
      runtimeSession.unsubscribe();
      runtimeSession.session.dispose();
    }
  }

  private async cleanupSessionProcesses(sessionId: string): Promise<void> {
    await Promise.all(
      listManagedProcesses({ sessionId, origin: "agent" }).map((process) =>
        killManagedProcess(process.id).catch(() => false),
      ),
    );
  }

  /**
   * Apply a model + thinking selection to a live session and persist it to the
   * record. The single place model/thinking are bound to a session — reused by
   * `setModel` (explicit user switch) and by `prompt` (per-turn authoritative
   * application), so there is exactly one code path and no drift between them.
   */
  private async applyModelSelection(
    runtimeSession: SdkRuntimeSession,
    modelId: string,
    thinkingVariant?: string,
  ): Promise<ReturnType<typeof findModel>> {
    const model = findModel(modelId);
    if (!model) {
      return undefined;
    }
    const resolved = resolveModelThinking(
      model,
      thinkingVariant ?? getModelThinkingVariant(modelId),
    );
    await runtimeSession.session.setModel(resolved.model);
    runtimeSession.session.setThinkingLevel(resolved.thinkingLevel);
    const updated = updateAgentSessionMetadata(runtimeSession.info.id, {
      model: modelToId(model),
    });
    if (updated) {
      runtimeSession.info = updated;
    }
    return model;
  }

  async setModel(
    window: BrowserWindowType,
    sessionId: string,
    modelId: string,
    thinkingVariant?: string,
  ): Promise<AgentSessionInfo> {
    const runtimeSession = await this.getOrResume(window, sessionId, modelId);
    if (!runtimeSession) {
      throw new Error(`Unable to set model: ${modelId}`);
    }
    const model = await this.applyModelSelection(runtimeSession, modelId, thinkingVariant);
    if (!model) {
      throw new Error(`Unable to set model: ${modelId}`);
    }
    if (thinkingVariant) await setModelThinking({ model: modelToId(model), thinkingVariant });
    await setDefaultModel(modelToId(model));
    this.emitContextUsage(runtimeSession);
    return runtimeSession.info;
  }

  async cycleModel(
    window: BrowserWindowType | undefined,
    sessionId: string | undefined,
    direction: "forward" | "backward" = "forward",
  ): Promise<ModelInfo> {
    if (!sessionId || !window) {
      return cycleDefaultModel(direction);
    }

    const runtimeSession = await this.getOrResume(window, sessionId);
    if (!runtimeSession) {
      return cycleDefaultModel(direction);
    }

    const selected = await runtimeSession.session.cycleModel(direction);
    if (!selected)
      throw new Error("No other model is available in this session's native model scope.");
    const id = modelToId(selected.model);
    const updated = updateAgentSessionMetadata(sessionId, { model: id });
    if (updated) runtimeSession.info = updated;
    await setDefaultModel(id);
    this.emitContextUsage(runtimeSession);
    const info = getModelInfo(id);
    if (!info) throw new Error(`Model is no longer available: ${id}`);
    return { ...info, thinkingLevel: selected.thinkingLevel };
  }
}

/**
 * Map the prompt's image attachments to pi's image content shape. Shared by
 * fresh and queued turns.
 */
function buildTurnImages(
  input: PromptAgentInput,
): Array<{ type: "image"; data: string; mimeType: string }> {
  return (input.attachments ?? []).map((attachment) => ({
    type: "image" as const,
    data: attachment.data,
    mimeType: attachment.mimeType,
  }));
}

/**
 * The authoritative end-of-turn error, read from pi's own message log: the last
 * assistant message's `stopReason`. Returns its error text when the turn ended
 * in an unrecovered error (after auto-retries are exhausted or for a
 * non-retryable error), and `undefined` when the latest assistant message ended
 * cleanly. This is pi's recorded fact, not a guess — so it is the single source
 * for surfacing a fatal turn failure.
 */
function lastAssistantTurnError(session: AgentSession): string | undefined {
  const messages = session.state.messages as ReadonlyArray<{
    role?: unknown;
    stopReason?: unknown;
    errorMessage?: unknown;
  }>;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") {
      continue;
    }
    if (message.stopReason !== "error") {
      return undefined;
    }
    return typeof message.errorMessage === "string" && message.errorMessage.trim()
      ? message.errorMessage
      : "The model returned an error without additional details.";
  }
  return undefined;
}

function createContextUsageEvent(sessionId: string, session: AgentSession): AgentEvent | undefined {
  const stats = session.getSessionStats();
  const usage = stats.contextUsage;
  if (!usage) {
    return undefined;
  }
  return {
    type: "context.updated",
    sessionId,
    usage: {
      ...usage,
      totals: {
        input: stats.tokens.input,
        output: stats.tokens.output,
        cacheRead: stats.tokens.cacheRead,
        cacheWrite: stats.tokens.cacheWrite,
        cost: stats.cost,
      },
    },
  };
}

function shouldPublishContextUsage(event: { type?: unknown }): boolean {
  return (
    event.type === "agent_settled" ||
    event.type === "message_end" ||
    event.type === "tool_execution_end" ||
    event.type === "compaction_end"
  );
}
