import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import {
  type AgentSession,
  createAgentSession,
  type ResourceLoader,
  SessionManager,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { BrowserWindow as BrowserWindowType } from "electron";
import type {
  AgentEvent,
  AgentRunInfo,
  AgentSessionInfo,
  ContextUsageInfo,
  ModelInfo,
} from "../../shared/contracts";
import { deriveSessionTitle, shouldReplaceSessionTitle } from "../../shared/session-title";
import { preparePromptImage } from "../files/prompt-image";
import { denyPendingQuestionRequestsForSession } from "../interaction/question-broker";
import { IPC_CHANNELS } from "../ipc/channels";
import { maybeNotifyAgentEvent } from "../notifications/agent-notifications";
import {
  appendAgentView,
  messagePresentations,
  releaseAgentView,
  seedAgentView,
} from "./agent-history";
import { getPiCliAgentDir } from "./agent-paths";
import { createAgentResourceLoader } from "./agent-resources";
import {
  createAgentRun,
  getActiveAgentRun,
  getAgentRun,
  listAgentRuns,
  releaseAgentRuns,
  updateAgentRunStatus,
} from "./agent-run-store";
import { createAgentSettings } from "./agent-settings";
import {
  bindSessionManager,
  createAgentSessionRecord,
  getAgentSession,
  openSessionFile,
  releaseSessionManager,
  touchAgentSession,
  updateAgentSessionMetadata,
  updateAgentSessionStatus,
  updateAgentSessionTitle,
} from "./agent-store";
import { createDialogUI, createExtensionUI, isExtensionCommandActive } from "./extension-ui";
import {
  cycleDefaultModel,
  findModel,
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
import type {
  AgentRuntime,
  CreateAgentRuntimeInput,
  EmitAgentEvent,
  PromptAgentInput,
} from "./runtime";
import { sessionDirectory } from "./session-directory";
import { registerSessionResources, releaseSessionResources } from "./session-resources";

type SdkRuntimeSession = {
  info: AgentSessionInfo;
  session: AgentSession;
  unsubscribe: () => void;
  emit: EmitAgentEvent;
  emitVolatile: EmitAgentEvent;
};

type RunObservation = {
  startedAt: number;
  assistant?: { stopReason: string; errorMessage?: string };
};

const TOOL_DELTA_THROTTLE_MS = 100;

export class PiSdkRuntime implements AgentRuntime {
  private sessions = new Map<string, SdkRuntimeSession>();
  private resumePromises = new Map<string, Promise<SdkRuntimeSession | undefined>>();
  private disposePromises = new Map<string, Promise<void>>();
  private runObservations = new Map<string, RunObservation>();
  private cancellingRuns = new Set<string>();
  private presentations = new Map<
    string,
    {
      messageId: string;
      text: string;
      paths?: string[];
      skills?: PromptAgentInput["skills"];
      attachments?: { path: string; mimeType: string; name?: string }[];
    }[]
  >();

  private emitToWindow(window: BrowserWindowType): EmitAgentEvent {
    return (event) => {
      appendAgentView(event);
      window.webContents.send(IPC_CHANNELS.agentEvent, event);
      maybeNotifyAgentEvent(window, event);
    };
  }

  private emitVolatileToWindow(window: BrowserWindowType): EmitAgentEvent {
    return (event) => {
      if (event.type === "tool.delta") appendAgentView(event);
      window.webContents.send(IPC_CHANNELS.agentEvent, event);
    };
  }

  private emitContextUsage(runtimeSession: SdkRuntimeSession): void {
    const event = createContextUsageEvent(runtimeSession.info.id, runtimeSession.session);
    if (event) {
      runtimeSession.emitVolatile(event);
    }
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

  async ensure(
    window: BrowserWindowType,
    sessionId: string,
  ): Promise<AgentSessionInfo & { contextUsage?: ContextUsageInfo }> {
    const runtimeSession = await this.getOrResume(window, sessionId);
    if (!runtimeSession) {
      throw new Error(`Agent session not found: ${sessionId}`);
    }
    const usage = createContextUsageEvent(sessionId, runtimeSession.session)?.usage;
    return { ...runtimeSession.info, ...(usage ? { contextUsage: usage } : {}) };
  }

  private async createSessionResources(
    cwd: string,
    sessionId: string,
    emit: EmitAgentEvent,
  ): Promise<{ settingsManager: SettingsManager; loader: ResourceLoader }> {
    const settingsManager = createAgentSettings({
      cwd,
    });
    const loader = await createAgentResourceLoader(
      cwd,
      settingsManager,
      [
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
      ],
      { cwd, mode: "rpc", hasUI: true, ui: createDialogUI(sessionId, emit) },
    );
    return { settingsManager, loader };
  }

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
    };
    if (params.model !== undefined) {
      sessionOptions.model = params.model;
      if (params.thinkingLevel !== undefined) {
        sessionOptions.thinkingLevel = params.thinkingLevel;
      }
    }

    const { session, modelFallbackMessage } = await createAgentSession(sessionOptions);
    if (modelFallbackMessage)
      params.emitVolatile({
        type: "extension.notice",
        sessionId: params.info.id,
        message: modelFallbackMessage,
        level: "warning",
      });
    bindSessionManager(params.info.id, session.sessionManager);
    seedAgentView(params.info.id);
    if (!session.sessionManager.getSessionName() && params.info.title !== "New chat")
      session.setSessionName(params.info.title);
    const normalizePiEvent = createPiEventNormalizer(params.info.id);
    const publishContextUsage = () => {
      const event = createContextUsageEvent(params.info.id, session);
      if (event) {
        params.emitVolatile(event);
      }
    };
    let lastToolDeltaAt = 0;
    let pendingToolDelta: Extract<AgentEvent, { type: "tool.delta" }> | undefined;
    let toolDeltaTimer: ReturnType<typeof setTimeout> | undefined;
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
      if (event.type === "message_end" && event.message.role === "user") {
        const message = event.message;
        queueMicrotask(() => {
          const entry = session.sessionManager
            .getBranch()
            .find((item) => item.type === "message" && item.message === message);
          const presentation = this.presentations.get(params.info.id)?.shift();
          if (entry && presentation)
            session.sessionManager.appendCustomEntry("modus.message", {
              entryId: entry.id,
              ...presentation,
            });
        });
      }
      const observation = this.runObservations.get(params.info.id);
      if (observation && event.type === "message_end" && event.message.role === "assistant") {
        observation.assistant = {
          stopReason: event.message.stopReason,
          ...(event.message.errorMessage ? { errorMessage: event.message.errorMessage } : {}),
        };
      }
      for (const normalized of normalizePiEvent(event)) {
        if (normalized.type === "tool.started") {
          const label = session.getToolDefinition(normalized.toolName)?.label;
          if (label) normalized.label = label;
        }
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
      unsubscribe,
      emit: params.emit,
      emitVolatile: params.emitVolatile,
    };
    this.sessions.set(params.info.id, runtimeSession);
    try {
      await session.bindExtensions({
        uiContext: createExtensionUI(session, params.info.id, (event) => {
          if (event.type === "extension.notice") params.emitVolatile(event);
          else params.emit(event);
        }),
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
    const selectedModel = input.model ? findModel(input.model) : undefined;
    if (input.model && !selectedModel) {
      throw new Error(
        `Model is not available: ${input.model ?? "default"}. Check the native provider configuration.`,
      );
    }
    const modelId = selectedModel ? modelToId(selectedModel) : input.model;
    const sessionManager = SessionManager.create(
      input.cwd,
      sessionDirectory(input.cwd),
      input.id ? { id: input.id } : undefined,
    );
    const recordInput: Parameters<typeof createAgentSessionRecord>[0] = {
      id: sessionManager.getSessionId(),
      piSessionId: sessionManager.getSessionId(),
      piSessionFile: sessionManager.getSessionFile()!,
      workspaceId: input.workspaceId,
      cwd: input.cwd,
      title: input.title,
      runtime: "pi-sdk",
    };
    if (modelId !== undefined) {
      recordInput.model = modelId;
    }
    const info = createAgentSessionRecord(recordInput);
    bindSessionManager(info.id, sessionManager);
    const selectedThinking = selectedModel ? resolveModelThinking(selectedModel) : undefined;

    const agentDir = getPiCliAgentDir();
    mkdirSync(agentDir, { recursive: true });

    const warmup = (async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
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
        sessionManager,
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
    const agentDir = getPiCliAgentDir();
    const sessionDir = sessionDirectory(info.cwd);
    mkdirSync(agentDir, { recursive: true });

    const { settingsManager, loader } = await this.createSessionResources(info.cwd, info.id, emit);

    const requestedModel = modelOverride;
    const selectedModel = requestedModel ? findModel(requestedModel) : undefined;
    if (requestedModel && !selectedModel) {
      throw new Error(
        `Model is not available: ${requestedModel ?? "default"}. Check the native provider configuration.`,
      );
    }
    const selectedThinking = selectedModel ? resolveModelThinking(selectedModel) : undefined;
    const sessionFile = info.piSessionFile;
    const sessionManager = sessionFile
      ? openSessionFile(sessionFile)
      : SessionManager.create(info.cwd, sessionDir);
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
    if (input.attachments?.length) {
      input = {
        ...input,
        attachments: await Promise.all(
          input.attachments.map(async (image) => ({
            ...image,
            path: await preparePromptImage(image),
          })),
        ),
      };
    }
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
      this.emitUserMessage(emit, input, earlyUserMessageId);
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

    runtimeSession.info = {
      ...runtimeSession.info,
      updatedAt: touchAgentSession(input.sessionId),
    };

    try {
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

    if (delivery !== "normal" && runtimeSession.session.isStreaming) {
      await this.enqueueTurnMessage(runtimeSession, input, delivery);
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
    const run = createAgentRun(runInput);
    const observation: RunObservation = {
      startedAt: Date.now(),
    };
    this.runObservations.set(input.sessionId, observation);

    updateAgentSessionStatus(input.sessionId, "running");
    const userMessageId = earlyUserMessageId ?? input.userMessageId ?? `user:${run.id}`;
    if (earlyUserMessageId === undefined)
      this.emitUserMessage(runtimeSession.emit, input, userMessageId);
    const startedEvent = {
      type: "run.started",
      sessionId: input.sessionId,
      runId: run.id,
      userMessageId,
      delivery,
    } as const;
    runtimeSession.emit(startedEvent);
    if (earlyUserMessageId === undefined) {
      runtimeSession.emit({
        type: "session.status",
        sessionId: input.sessionId,
        status: { type: "busy" },
      });
    }
    try {
      const message = await this.composeTurnMessage(runtimeSession, input);
      if (this.cancellingRuns.has(run.id)) throw new Error("Prompt cancelled");
      console.info(
        `[modus-timing] composeTurnMessage done +${Date.now() - observation.startedAt}ms`,
      );
      await runtimeSession.session.prompt(message, {
        source: "rpc",
        ...(delivery !== "normal"
          ? { streamingBehavior: delivery === "follow-up" ? "followUp" : "steer" }
          : {}),
      });
      this.emitContextUsage(runtimeSession);
      const currentRun = getAgentRun(run.id);
      if (currentRun?.status === "running") {
        const cancelled =
          this.cancellingRuns.has(run.id) || observation.assistant?.stopReason === "aborted";
        if (cancelled) {
          updateAgentRunStatus(run.id, "cancelled");
          runtimeSession.emit({ type: "run.cancelled", sessionId: input.sessionId, runId: run.id });
        } else if (observation.assistant?.stopReason === "error") {
          const turnError =
            observation.assistant.errorMessage ||
            "The model returned an error without additional details.";
          updateAgentRunStatus(run.id, "failed", turnError);
          updateAgentSessionStatus(input.sessionId, "error");
          runtimeSession.emit({
            type: "run.failed",
            sessionId: input.sessionId,
            runId: run.id,
            message: turnError,
          });
        } else {
          updateAgentRunStatus(run.id, "completed");
          runtimeSession.emit({
            type: "run.completed",
            sessionId: input.sessionId,
            runId: run.id,
          });
        }
      }
    } catch (error) {
      const currentRun = getAgentRun(run.id);
      if (!currentRun || currentRun.status === "cancelled") {
        return;
      }
      if (this.cancellingRuns.has(run.id)) {
        updateAgentRunStatus(run.id, "cancelled");
        runtimeSession.emit({ type: "run.cancelled", sessionId: input.sessionId, runId: run.id });
        return;
      }
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
      throw error;
    } finally {
      this.presentations.delete(input.sessionId);
      this.runObservations.delete(input.sessionId);
      this.cancellingRuns.delete(run.id);
      console.info(`[modus-timing] turn end (idle emit) +${Date.now() - observation.startedAt}ms`);
      const session = getAgentSession(input.sessionId);
      if (session?.status !== "error") {
        updateAgentSessionStatus(input.sessionId, "idle");
      }
      runtimeSession.emit({
        type: "session.status",
        sessionId: input.sessionId,
        status: { type: "idle" },
      });
    }
  }

  async navigate(window: BrowserWindowType, sessionId: string, messageId: string): Promise<void> {
    const runtime = await this.getOrResume(window, sessionId);
    if (!runtime) throw new Error(`Agent session not found: ${sessionId}`);
    const presentation = [...messagePresentations(runtime.session.sessionManager)].find(
      ([, item]) => item.messageId === messageId,
    );
    const targetId = presentation?.[0] ?? messageId;
    const result = await runtime.session.navigateTree(targetId);
    if (result.cancelled) throw new Error("Session navigation was cancelled.");
    releaseAgentView(sessionId);
    seedAgentView(sessionId);
    this.emitContextUsage(runtime);
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

  private emitUserMessage(
    emit: EmitAgentEvent,
    input: PromptAgentInput,
    userMessageId: string,
  ): void {
    const pending = this.presentations.get(input.sessionId) ?? [];
    pending.push({
      messageId: userMessageId,
      text: input.message,
      ...(input.paths?.length ? { paths: input.paths } : {}),
      ...(input.skills?.length ? { skills: input.skills } : {}),
      ...(input.attachments?.length
        ? {
            attachments: input.attachments
              .filter((image) => image.path)
              .map((image) => ({
                path: image.path!,
                mimeType: image.mimeType,
                ...(image.name ? { name: image.name } : {}),
              })),
          }
        : {}),
    });
    this.presentations.set(input.sessionId, pending);
    emit({
      type: "message.started",
      sessionId: input.sessionId,
      messageId: userMessageId,
      role: "user",
      ...(input.attachments && input.attachments.length > 0
        ? { attachments: input.attachments }
        : {}),
      ...(input.skills && input.skills.length > 0 ? { skills: input.skills } : {}),
      ...(input.paths?.length
        ? { contextItems: input.paths.map((path) => ({ type: "file" as const, path })) }
        : {}),
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
    const message = [
      ...(input.paths ?? []),
      ...(input.skills?.slice(1).map((skill) => skill.path) ?? []),
      input.message,
      ...(input.attachments ?? []).map((image) => image.path),
    ]
      .filter(Boolean)
      .join("\n\n");
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

  private async enqueueTurnMessage(
    runtimeSession: SdkRuntimeSession,
    input: PromptAgentInput,
    delivery: NonNullable<PromptAgentInput["delivery"]>,
  ): Promise<void> {
    const userMessageId = input.userMessageId ?? `local-user:${randomUUID()}`;
    this.emitUserMessage(runtimeSession.emit, input, userMessageId);
    try {
      const message = await this.composeTurnMessage(runtimeSession, input);
      await runtimeSession.session.prompt(message, {
        source: "rpc",
        streamingBehavior: delivery === "follow-up" ? "followUp" : "steer",
      });
      this.emitContextUsage(runtimeSession);
    } catch (error) {
      runtimeSession.emit({
        type: "runtime.error",
        sessionId: input.sessionId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async abort(sessionId: string): Promise<string[]> {
    const session = this.sessions.get(sessionId)?.session;
    const queued = session?.clearQueue();
    await this.abortSessionOnly(sessionId);
    return queued ? [...queued.steering, ...queued.followUp] : [];
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

    denyPendingQuestionRequestsForSession(sessionId);
    await runtimeSession.session.abort();
  }

  async listRuns(sessionId: string): Promise<AgentRunInfo[]> {
    return listAgentRuns(sessionId);
  }

  async dispose(sessionId: string): Promise<void> {
    await this.disposeSessionOnly(sessionId);
  }

  async releaseRuntime(sessionId: string): Promise<void> {
    await this.disposeSessionOnly(sessionId, true);
  }

  private disposeSessionOnly(sessionId: string, idleOnly = false): Promise<void> {
    const pending = this.disposePromises.get(sessionId);
    if (pending) return pending;
    const operation = this.closeRuntimeSession(sessionId, idleOnly).finally(() =>
      this.disposePromises.delete(sessionId),
    );
    this.disposePromises.set(sessionId, operation);
    return operation;
  }

  private async closeRuntimeSession(sessionId: string, idleOnly: boolean): Promise<void> {
    const pending = this.resumePromises.get(sessionId);
    if (pending) {
      await pending.catch(() => undefined);
    }

    const runtimeSession = this.sessions.get(sessionId);
    if (!runtimeSession) {
      return;
    }

    if (
      idleOnly &&
      (runtimeSession.session.isStreaming ||
        getActiveAgentRun(sessionId) ||
        isExtensionCommandActive(runtimeSession.session))
    )
      return;

    this.sessions.delete(sessionId);
    releaseSessionResources(sessionId);
    denyPendingQuestionRequestsForSession(sessionId);
    try {
      if (runtimeSession.session.isStreaming) await runtimeSession.session.abort();
      await runtimeSession.session.extensionRunner?.emit({
        type: "session_shutdown",
        reason: "quit",
      });
    } finally {
      runtimeSession.unsubscribe();
      runtimeSession.session.dispose();
      releaseSessionManager(sessionId);
      releaseAgentView(sessionId);
      releaseAgentRuns(sessionId);
    }
  }

  private async applyModelSelection(
    runtimeSession: SdkRuntimeSession,
    modelId: string,
    thinkingVariant?: string,
  ): Promise<ReturnType<typeof findModel>> {
    const model = findModel(modelId);
    if (!model) throw new Error(`Model is not available: ${modelId}`);
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

function createContextUsageEvent(
  sessionId: string,
  session: AgentSession,
): Extract<AgentEvent, { type: "context.updated" }> | undefined {
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
