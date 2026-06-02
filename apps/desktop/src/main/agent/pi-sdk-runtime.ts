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
import type { AgentSessionInfo, ModelInfo } from "../../shared/contracts";
import { formatResolvedContext, resolveContext } from "../context/context-service";
import { IPC_CHANNELS } from "../ipc/channels";
import { recordAgentEvent } from "./agent-event-store";
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
    const recordInput: CreateAgentRuntimeInput & { runtime: "pi-sdk"; model?: string } = {
      ...input,
      runtime: "pi-sdk",
    };
    if (modelId !== undefined) {
      recordInput.model = modelId;
    }
    const info = createAgentSessionRecord(recordInput);

    const agentDir = join(app.getPath("userData"), "pi-agent");
    const sessionDir = join(app.getPath("userData"), "pi-sessions");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(sessionDir, { recursive: true });

    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: true } });
    const loader = new DefaultResourceLoader({
      cwd: input.cwd,
      agentDir,
      extensionFactories: [createModusPermissionExtension(info.id, emit)],
      settingsManager,
    });
    await loader.reload();

    const sessionOptions: Parameters<typeof createAgentSession>[0] = {
      cwd: input.cwd,
      agentDir,
      authStorage: getModelRegistry().authStorage,
      modelRegistry: getModelRegistry(),
      resourceLoader: loader,
      sessionManager: SessionManager.create(input.cwd, sessionDir),
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

    updateAgentSessionStatus(input.sessionId, "running");
    try {
      await runtimeSession.session.prompt(message, { source: "rpc" });
    } catch (error) {
      updateAgentSessionStatus(input.sessionId, "error");
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

    await runtimeSession.session.abort();
    updateAgentSessionStatus(sessionId, "idle");
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
