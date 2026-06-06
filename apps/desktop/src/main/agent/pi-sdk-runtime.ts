import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { app, type BrowserWindow } from "electron";
import type { AgentRunInfo, AgentSessionInfo, ModelInfo } from "../../shared/contracts";
import { formatResolvedContext, resolveContext } from "../context/context-service";
import { createWorktree, isGitRepository } from "../git/git-service";
import { IPC_CHANNELS } from "../ipc/channels";
import { recordAgentEvent } from "./agent-event-store";
import {
  createAgentRun,
  getActiveAgentRun,
  getAgentRun,
  listAgentRuns,
  updateAgentRunStatus,
} from "./agent-run-store";
import {
  createAgentSessionRecord,
  getAgentSession,
  updateAgentSessionMetadata,
  updateAgentSessionStatus,
  updateAgentSessionTitle,
} from "./agent-store";
import {
  cycleDefaultModel,
  findModel,
  getDefaultModel,
  getModelInfo,
  getModelRegistry,
  getModelThinkingLevel,
  listScopedModels,
  modelToId,
  setDefaultModel,
  toPiThinkingLevel,
} from "./model-service";
import { createPiEventNormalizer } from "./pi-event-normalizer";
import { createModusPermissionExtension } from "./pi-permission-extension";
import type {
  AgentRuntime,
  CreateAgentRuntimeInput,
  EmitAgentEvent,
  PromptAgentInput,
} from "./runtime";
import { deriveSessionTitle, shouldReplaceSessionTitle } from "./session-title";

type SdkRuntimeSession = {
  info: AgentSessionInfo;
  session: AgentSession;
  unsubscribe: () => void;
  emit: EmitAgentEvent;
};

type RunOutputTracker = {
  runId: string;
  hasVisibleOutput: boolean;
};

export class PiSdkRuntime implements AgentRuntime {
  private sessions = new Map<string, SdkRuntimeSession>();
  private resumePromises = new Map<string, Promise<SdkRuntimeSession | undefined>>();
  private runOutputTrackers = new Map<string, RunOutputTracker>();

  private noteAssistantOutput(event: Parameters<EmitAgentEvent>[0]): void {
    const tracker = this.runOutputTrackers.get(event.sessionId);
    if (!tracker) {
      return;
    }

    if ((event.type === "message.delta" || event.type === "thinking.delta") && event.delta.trim()) {
      tracker.hasVisibleOutput = true;
      return;
    }

    if (
      event.type === "tool.started" ||
      event.type === "tool.output" ||
      event.type === "tool.ended" ||
      event.type === "runtime.error"
    ) {
      tracker.hasVisibleOutput = true;
    }
  }

  private async getOrResume(
    window: BrowserWindow,
    sessionId: string,
  ): Promise<SdkRuntimeSession | undefined> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const pending = this.resumePromises.get(sessionId);
    if (pending) {
      return await pending;
    }

    const next = this.createRuntimeSession(window, sessionId).finally(() => {
      this.resumePromises.delete(sessionId);
    });
    this.resumePromises.set(sessionId, next);
    return await next;
  }

  async ensure(window: BrowserWindow, sessionId: string): Promise<AgentSessionInfo> {
    const runtimeSession = await this.getOrResume(window, sessionId);
    if (!runtimeSession) {
      throw new Error(`Agent session not found: ${sessionId}`);
    }
    return runtimeSession.info;
  }

  async create(window: BrowserWindow, input: CreateAgentRuntimeInput): Promise<AgentSessionInfo> {
    const emit: EmitAgentEvent = (event) => {
      recordAgentEvent(event);
      window.webContents.send(IPC_CHANNELS.agentEvent, event);
    };
    const selectedModel = findModel(input.model) ?? getDefaultModel();
    if (!selectedModel) {
      throw new Error(
        "No model is configured. Open Settings and connect a provider before starting a chat.",
      );
    }
    const modelId = selectedModel ? modelToId(selectedModel) : input.model;
    const selectedInfo = getModelInfo(modelId);
    let effectiveCwd = input.cwd;
    let worktreePath: string | undefined;
    if ((input.worktreeMode ?? "auto") === "auto" && (await isGitRepository(input.cwd))) {
      const worktree = await createWorktree(input.cwd, `session-${Date.now().toString(36)}`);
      effectiveCwd = worktree.path;
      worktreePath = worktree.path;
    }
    const recordInput: Parameters<typeof createAgentSessionRecord>[0] = {
      ...input,
      cwd: effectiveCwd,
      runtime: "pi-sdk",
    };
    if (modelId !== undefined) {
      recordInput.model = modelId;
    }
    if (worktreePath !== undefined) {
      recordInput.worktreePath = worktreePath;
    }
    const info = createAgentSessionRecord(recordInput);

    const agentDir = join(app.getPath("userData"), "pi-agent");
    const sessionDir = join(app.getPath("userData"), "pi-sessions");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(sessionDir, { recursive: true });

    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: true } });
    const loader = new DefaultResourceLoader({
      cwd: effectiveCwd,
      agentDir,
      extensionFactories: [createModusPermissionExtension(info.id, emit)],
      settingsManager,
    });
    await loader.reload();

    const sessionOptions: Parameters<typeof createAgentSession>[0] = {
      cwd: effectiveCwd,
      agentDir,
      authStorage: getModelRegistry().authStorage,
      modelRegistry: getModelRegistry(),
      resourceLoader: loader,
      sessionManager: SessionManager.create(effectiveCwd, sessionDir),
      settingsManager,
      scopedModels: listScopedModels(),
    };
    if (selectedModel !== undefined) {
      sessionOptions.model = selectedModel;
      sessionOptions.thinkingLevel = toPiThinkingLevel(selectedInfo?.thinkingLevel ?? "off");
    }

    const { session } = await createAgentSession(sessionOptions);

    const normalizePiEvent = createPiEventNormalizer(info.id);
    const unsubscribe = session.subscribe((event) => {
      for (const normalized of normalizePiEvent(event)) {
        this.noteAssistantOutput(normalized);
        emit(normalized);
      }
    });

    const metadata: Parameters<typeof updateAgentSessionMetadata>[1] = {
      piSessionId: session.sessionId,
    };
    const nextModelId = session.model ? modelToId(session.model) : modelId;
    if (nextModelId !== undefined) {
      metadata.model = nextModelId;
    }
    if (session.sessionFile !== undefined) {
      metadata.piSessionFile = session.sessionFile;
    }
    updateAgentSessionMetadata(info.id, metadata);
    updateAgentSessionStatus(info.id, "idle");
    const updated = getAgentSession(info.id) ?? info;
    this.sessions.set(info.id, { info: updated, session, unsubscribe, emit });
    return updated;
  }

  private async createRuntimeSession(
    window: BrowserWindow,
    sessionId: string,
  ): Promise<SdkRuntimeSession | undefined> {
    const info = getAgentSession(sessionId);
    if (!info) {
      return undefined;
    }

    const emit: EmitAgentEvent = (event) => {
      recordAgentEvent(event);
      window.webContents.send(IPC_CHANNELS.agentEvent, event);
    };
    const agentDir = join(app.getPath("userData"), "pi-agent");
    const sessionDir = join(app.getPath("userData"), "pi-sessions");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(sessionDir, { recursive: true });

    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: true } });
    const loader = new DefaultResourceLoader({
      cwd: info.cwd,
      agentDir,
      extensionFactories: [createModusPermissionExtension(info.id, emit)],
      settingsManager,
    });
    await loader.reload();

    const selectedModel = findModel(info.model) ?? getDefaultModel();
    if (!selectedModel) {
      throw new Error(
        "No model is configured. Open Settings and connect a provider before resuming this chat.",
      );
    }
    const selectedInfo = getModelInfo(selectedModel ? modelToId(selectedModel) : info.model);
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
    const sessionOptions: Parameters<typeof createAgentSession>[0] = {
      cwd: info.cwd,
      agentDir,
      authStorage: getModelRegistry().authStorage,
      modelRegistry: getModelRegistry(),
      resourceLoader: loader,
      sessionManager,
      settingsManager,
      scopedModels: listScopedModels(),
    };
    if (selectedModel !== undefined) {
      sessionOptions.model = selectedModel;
      sessionOptions.thinkingLevel = toPiThinkingLevel(selectedInfo?.thinkingLevel ?? "off");
    }

    const { session } = await createAgentSession(sessionOptions);
    const normalizePiEvent = createPiEventNormalizer(info.id);
    const unsubscribe = session.subscribe((event) => {
      for (const normalized of normalizePiEvent(event)) {
        this.noteAssistantOutput(normalized);
        emit(normalized);
      }
    });

    const metadata: Parameters<typeof updateAgentSessionMetadata>[1] = {
      piSessionId: session.sessionId,
    };
    const nextModelId = session.model
      ? modelToId(session.model)
      : selectedModel
        ? modelToId(selectedModel)
        : info.model;
    if (nextModelId !== undefined) {
      metadata.model = nextModelId;
    }
    if (session.sessionFile !== undefined) {
      metadata.piSessionFile = session.sessionFile;
    }
    const updated = updateAgentSessionMetadata(info.id, metadata) ?? info;
    updateAgentSessionStatus(info.id, "idle");
    const runtimeSession = { info: updated, session, unsubscribe, emit };
    this.sessions.set(info.id, runtimeSession);
    return runtimeSession;
  }

  async prompt(window: BrowserWindow, input: PromptAgentInput): Promise<void> {
    const runtimeSession = await this.getOrResume(window, input.sessionId);
    if (!runtimeSession) {
      throw new Error(`Agent session not running: ${input.sessionId}`);
    }

    const delivery = input.delivery ?? "normal";
    if (shouldReplaceSessionTitle(runtimeSession.info.title)) {
      const titled = updateAgentSessionTitle(input.sessionId, deriveSessionTitle(input.message));
      if (titled) {
        runtimeSession.info = titled;
      }
    }
    const runInput: Parameters<typeof createAgentRun>[0] = {
      sessionId: input.sessionId,
      prompt: input.message,
    };
    if (input.userMessageId !== undefined) runInput.userMessageId = input.userMessageId;
    if (runtimeSession.info.model !== undefined) runInput.model = runtimeSession.info.model;
    const run = createAgentRun(runInput);
    const outputTracker: RunOutputTracker = { runId: run.id, hasVisibleOutput: false };
    this.runOutputTrackers.set(input.sessionId, outputTracker);

    updateAgentSessionStatus(input.sessionId, "running");
    const userMessageId = input.userMessageId ?? `user:${run.id}`;
    runtimeSession.emit({
      type: "message.started",
      sessionId: input.sessionId,
      messageId: userMessageId,
      role: "user",
    });
    runtimeSession.emit({
      type: "message.delta",
      sessionId: input.sessionId,
      messageId: userMessageId,
      delta: input.message,
    });
    runtimeSession.emit({
      type: "message.completed",
      sessionId: input.sessionId,
      messageId: userMessageId,
    });
    const startedEvent = {
      type: "run.started",
      sessionId: input.sessionId,
      runId: run.id,
      delivery,
    } as const;
    runtimeSession.emit(
      input.userMessageId !== undefined
        ? { ...startedEvent, userMessageId: input.userMessageId }
        : startedEvent,
    );
    try {
      const resolved = await resolveContext(runtimeSession.info.cwd, input.context);
      const contextText = formatResolvedContext(resolved);
      const message = contextText ? `${contextText}\n\n${input.message}` : input.message;
      await runtimeSession.session.prompt(message, {
        source: "rpc",
        ...(delivery === "normal"
          ? {}
          : { streamingBehavior: delivery === "follow-up" ? "followUp" : "steer" }),
      });
      const currentRun = getAgentRun(run.id);
      if (currentRun?.status === "running") {
        if (outputTracker.hasVisibleOutput) {
          updateAgentRunStatus(run.id, "completed");
          runtimeSession.emit({ type: "run.completed", sessionId: input.sessionId, runId: run.id });
        } else {
          const message =
            "The selected model finished without returning any assistant output. Check the custom provider URL, model id, API type, and reasoning compatibility settings.";
          updateAgentRunStatus(run.id, "failed", message);
          updateAgentSessionStatus(input.sessionId, "error");
          runtimeSession.emit({
            type: "run.failed",
            sessionId: input.sessionId,
            runId: run.id,
            message,
          });
          runtimeSession.emit({ type: "runtime.error", sessionId: input.sessionId, message });
        }
      }
    } catch (error) {
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
      this.runOutputTrackers.delete(input.sessionId);
      if (getAgentSession(input.sessionId)?.status !== "error") {
        updateAgentSessionStatus(input.sessionId, "idle");
      }
    }
  }

  async abort(sessionId: string): Promise<void> {
    const runtimeSession = this.sessions.get(sessionId);
    if (!runtimeSession) {
      return;
    }
    const activeRun = getActiveAgentRun(sessionId);

    await runtimeSession.session.abort();
    if (activeRun) {
      updateAgentRunStatus(activeRun.id, "cancelled");
      runtimeSession.emit({ type: "run.cancelled", sessionId, runId: activeRun.id });
    }
    updateAgentSessionStatus(sessionId, "idle");
  }

  async listRuns(sessionId: string): Promise<AgentRunInfo[]> {
    return listAgentRuns(sessionId);
  }

  async dispose(sessionId: string): Promise<void> {
    const runtimeSession = this.sessions.get(sessionId);
    if (!runtimeSession) {
      return;
    }

    runtimeSession.unsubscribe();
    runtimeSession.session.dispose();
    this.sessions.delete(sessionId);
  }

  async setModel(
    window: BrowserWindow,
    sessionId: string,
    modelId: string,
    thinkingLevel?: string,
  ): Promise<AgentSessionInfo> {
    const runtimeSession = await this.getOrResume(window, sessionId);
    const model = findModel(modelId);
    if (!runtimeSession || !model) {
      throw new Error(`Unable to set model: ${modelId}`);
    }

    await runtimeSession.session.setModel(model);
    const resolvedThinking = toPiThinkingLevel(
      thinkingLevel
        ? getModelThinkingLevelFromInput(thinkingLevel)
        : getModelThinkingLevel(modelId),
    );
    runtimeSession.session.setThinkingLevel(resolvedThinking);
    setDefaultModel(modelToId(model));
    const updated = updateAgentSessionMetadata(sessionId, { model: modelToId(model) });
    runtimeSession.info = updated ?? runtimeSession.info;
    return runtimeSession.info;
  }

  async cycleModel(
    window: BrowserWindow | undefined,
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

    const next = cycleDefaultModel(direction);
    const model = findModel(next.id);
    if (!model) {
      throw new Error(`Unable to cycle to model: ${next.id}`);
    }
    await runtimeSession.session.setModel(model);
    runtimeSession.session.setThinkingLevel(toPiThinkingLevel(next.thinkingLevel));
    updateAgentSessionMetadata(sessionId, { model: modelToId(model) });
    return next;
  }
}

function getModelThinkingLevelFromInput(value: string): ReturnType<typeof getModelThinkingLevel> {
  if (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }

  return "off";
}
