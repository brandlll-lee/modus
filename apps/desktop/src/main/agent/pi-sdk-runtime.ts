import { mkdirSync } from "node:fs";
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
} from "./agent-store";
import {
  cycleDefaultModel,
  findModel,
  getDefaultModel,
  getModelRegistry,
  modelToId,
  modelToInfo,
} from "./model-service";
import { normalizePiEvent } from "./pi-event-normalizer";
import { createModusPermissionExtension } from "./pi-permission-extension";
import type {
  AgentRuntime,
  CreateAgentRuntimeInput,
  EmitAgentEvent,
  PromptAgentInput,
} from "./runtime";

type SdkRuntimeSession = {
  info: AgentSessionInfo;
  session: AgentSession;
  unsubscribe: () => void;
  emit: EmitAgentEvent;
};

export class PiSdkRuntime implements AgentRuntime {
  private sessions = new Map<string, SdkRuntimeSession>();

  async create(window: BrowserWindow, input: CreateAgentRuntimeInput): Promise<AgentSessionInfo> {
    const emit: EmitAgentEvent = (event) => {
      recordAgentEvent(event);
      window.webContents.send(IPC_CHANNELS.agentEvent, event);
    };
    const selectedModel = findModel(input.model) ?? getDefaultModel();
    const modelId = selectedModel ? modelToId(selectedModel) : input.model;
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
    };
    if (selectedModel !== undefined) {
      sessionOptions.model = selectedModel;
    }

    const { session } = await createAgentSession(sessionOptions);

    const unsubscribe = session.subscribe((event) => {
      for (const normalized of normalizePiEvent(info.id, event)) {
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

  async prompt(input: PromptAgentInput): Promise<void> {
    const runtimeSession = this.sessions.get(input.sessionId);
    if (!runtimeSession) {
      throw new Error(`Agent session not running: ${input.sessionId}`);
    }

    const resolved = await resolveContext(runtimeSession.info.cwd, input.context);
    const contextText = formatResolvedContext(resolved);
    const message = contextText ? `${contextText}\n\n${input.message}` : input.message;
    const delivery = input.delivery ?? "normal";
    const runInput: Parameters<typeof createAgentRun>[0] = {
      sessionId: input.sessionId,
      prompt: input.message,
    };
    if (input.userMessageId !== undefined) runInput.userMessageId = input.userMessageId;
    if (runtimeSession.info.model !== undefined) runInput.model = runtimeSession.info.model;
    const run = createAgentRun(runInput);

    updateAgentSessionStatus(input.sessionId, "running");
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
      await runtimeSession.session.prompt(message, {
        source: "rpc",
        ...(delivery === "normal"
          ? {}
          : { streamingBehavior: delivery === "follow-up" ? "followUp" : "steer" }),
      });
      const currentRun = getAgentRun(run.id);
      if (currentRun?.status === "running") {
        updateAgentRunStatus(run.id, "completed");
        runtimeSession.emit({ type: "run.completed", sessionId: input.sessionId, runId: run.id });
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

  async setModel(sessionId: string, modelId: string): Promise<AgentSessionInfo> {
    const runtimeSession = this.sessions.get(sessionId);
    const model = findModel(modelId);
    if (!runtimeSession || !model) {
      throw new Error(`Unable to set model: ${modelId}`);
    }

    await runtimeSession.session.setModel(model);
    const updated = updateAgentSessionMetadata(sessionId, { model: modelToId(model) });
    runtimeSession.info = updated ?? runtimeSession.info;
    return runtimeSession.info;
  }

  async cycleModel(
    sessionId: string | undefined,
    direction: "forward" | "backward" = "forward",
  ): Promise<ModelInfo> {
    if (!sessionId) {
      return cycleDefaultModel(direction);
    }

    const runtimeSession = this.sessions.get(sessionId);
    if (!runtimeSession) {
      return cycleDefaultModel(direction);
    }

    const result = await runtimeSession.session.cycleModel(direction);
    const model = result?.model ?? runtimeSession.session.model;
    if (!model) {
      return cycleDefaultModel(direction);
    }
    updateAgentSessionMetadata(sessionId, { model: modelToId(model) });
    return modelToInfo(model, true);
  }
}
