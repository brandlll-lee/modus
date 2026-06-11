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
import type {
  AgentEvent,
  AgentRunInfo,
  AgentSessionInfo,
  ContextUsageInfo,
  ModelInfo,
} from "../../shared/contracts";
import { formatResolvedContext, resolveContext } from "../context/context-service";
import { getChangeStatsSince } from "../git/git-service";
import { IPC_CHANNELS } from "../ipc/channels";
import { maybeNotifyAgentEvent } from "../notifications/agent-notifications";
import { resolveAlwaysRulesPrompt } from "../rules/rules-service";
import { resolveSkillsPrompt } from "../skills/skills-service";
import { summarizeTerminals } from "../terminal/terminal-service";
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
import { createCheckpoint } from "./checkpoint-service";
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
import { PI_ROOT_LEAF } from "./rollback-service";
import type {
  AgentRuntime,
  CreateAgentRuntimeInput,
  EmitAgentEvent,
  PromptAgentInput,
} from "./runtime";
import { deriveSessionTitle, shouldReplaceSessionTitle } from "./session-title";
import { describeAgentShellForPrompt, resolveAgentShell } from "./shell-resolver";
import { toolRegistry } from "./tools/registry";
import { registerTerminalTools } from "./tools/terminal-tools";
import { registerTodoTools } from "./tools/todo-tools";
import { setAgentToolContext } from "./tools/tool-context";
import { registerWebTools } from "./tools/web-tools";

/**
 * Appended to the agent's system prompt so responses render well in Modus's
 * Markdown UI. PI's default prompt gives no formatting guidance, so models tend
 * to emit one dense paragraph (single newlines collapse to spaces in Markdown).
 * This mirrors the structured-output guidance Codex/ChatGPT use.
 */
const RESPONSE_FORMAT_GUIDANCE = `<response_formatting>
Format substantive answers as clean GitHub-flavored Markdown so they render well in the UI:
- Separate paragraphs with a blank line. Do not write one long wall of text.
- Use \`##\`/\`###\` headings to label sections of longer answers.
- Use \`-\` bullet lists for 3+ related points; keep each bullet to one line.
- Wrap file paths, commands, code identifiers, and values in backticks.
- Use fenced code blocks with a language tag for code.
- Prefer short paragraphs and lists over a single dense block.
Skip heavy formatting for one-line answers, greetings, or simple confirmations.
</response_formatting>`;

type SdkRuntimeSession = {
  info: AgentSessionInfo;
  session: AgentSession;
  unsubscribe: () => void;
  emit: EmitAgentEvent;
  emitVolatile: EmitAgentEvent;
};

type RunOutputTracker = {
  runId: string;
  hasVisibleOutput: boolean;
};

export class PiSdkRuntime implements AgentRuntime {
  private sessions = new Map<string, SdkRuntimeSession>();
  private resumePromises = new Map<string, Promise<SdkRuntimeSession | undefined>>();
  private runOutputTrackers = new Map<string, RunOutputTracker>();
  private cancellingRuns = new Set<string>();

  constructor() {
    // Make the agent terminal tools (run/read/list/write/kill), the built-in
    // web tools (search/fetch), and the live to-do tool available to the chat
    // profile before any session is assembled.
    registerTerminalTools();
    registerWebTools();
    registerTodoTools();
  }

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

  private emitContextUsage(runtimeSession: SdkRuntimeSession): void {
    const event = createContextUsageEvent(runtimeSession.info.id, runtimeSession.session);
    if (event) {
      runtimeSession.emitVolatile(event);
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

  private async createSessionResources(
    cwd: string,
    sessionId: string,
    emit: EmitAgentEvent,
    agentDir: string,
  ): Promise<{ settingsManager: SettingsManager; loader: DefaultResourceLoader }> {
    // Inject a cross-platform-resolved POSIX shell so the bash tool works out of
    // the box (notably on Windows, where PI's default picks the broken WSL stub),
    // and tell the model which shell it's actually driving.
    const shell = resolveAgentShell();
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: true },
      ...(shell.shellPath ? { shellPath: shell.shellPath } : {}),
    });
    // Project rules (AGENTS.md / .cursor/rules alwaysApply) ride the system
    // prompt so they apply to every turn without re-paying per-message tokens.
    const rulesPrompt = resolveAlwaysRulesPrompt(cwd);
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      extensionFactories: [createModusPermissionExtension(sessionId, emit)],
      settingsManager,
      appendSystemPrompt: [
        describeAgentShellForPrompt(shell),
        RESPONSE_FORMAT_GUIDANCE,
        ...(rulesPrompt ? [rulesPrompt] : []),
      ],
    });
    await loader.reload();
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
    loader: DefaultResourceLoader;
    settingsManager: SettingsManager;
    sessionManager: SessionManager;
    model: NonNullable<Parameters<typeof createAgentSession>[0]>["model"];
    thinkingLevel: NonNullable<Parameters<typeof createAgentSession>[0]>["thinkingLevel"];
  }): Promise<SdkRuntimeSession> {
    const sessionOptions: Parameters<typeof createAgentSession>[0] = {
      cwd: params.info.cwd,
      agentDir: params.agentDir,
      authStorage: getModelRegistry().authStorage,
      modelRegistry: getModelRegistry(),
      resourceLoader: params.loader,
      sessionManager: params.sessionManager,
      settingsManager: params.settingsManager,
      scopedModels: listScopedModels(),
      tools: toolRegistry.resolveActiveTools("chat"),
      customTools: toolRegistry.getCustomToolDefinitions("chat"),
    };
    if (params.model !== undefined) {
      sessionOptions.model = params.model;
      if (params.thinkingLevel !== undefined) {
        sessionOptions.thinkingLevel = params.thinkingLevel;
      }
    }

    const { session } = await createAgentSession(sessionOptions);
    const normalizePiEvent = createPiEventNormalizer(params.info.id);
    const publishContextUsage = () => {
      const event = createContextUsageEvent(params.info.id, session);
      if (event) {
        params.emitVolatile(event);
      }
    };
    const unsubscribe = session.subscribe((event) => {
      for (const normalized of normalizePiEvent(event)) {
        this.noteAssistantOutput(normalized);
        params.emit(normalized);
      }
      if (shouldPublishContextUsage(event)) {
        publishContextUsage();
      }
    });

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
    const runtimeSession: SdkRuntimeSession = {
      info: updated,
      session,
      unsubscribe,
      emit: params.emit,
      emitVolatile: params.emitVolatile,
    };
    this.sessions.set(params.info.id, runtimeSession);
    publishContextUsage();
    return runtimeSession;
  }

  async create(window: BrowserWindow, input: CreateAgentRuntimeInput): Promise<AgentSessionInfo> {
    const emit: EmitAgentEvent = (event) => {
      recordAgentEvent(event);
      window.webContents.send(IPC_CHANNELS.agentEvent, event);
      maybeNotifyAgentEvent(window, event);
    };
    const emitVolatile: EmitAgentEvent = (event) => {
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
    const recordInput: Parameters<typeof createAgentSessionRecord>[0] = {
      ...input,
      cwd: input.cwd,
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

    const { settingsManager, loader } = await this.createSessionResources(
      input.cwd,
      info.id,
      emit,
      agentDir,
    );

    const runtimeSession = await this.assembleSession({
      info,
      emit,
      emitVolatile,
      agentDir,
      loader,
      settingsManager,
      sessionManager: SessionManager.create(input.cwd, sessionDir),
      model: selectedModel,
      thinkingLevel:
        selectedModel !== undefined
          ? toPiThinkingLevel(selectedInfo?.thinkingLevel ?? "off")
          : undefined,
    });
    return runtimeSession.info;
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
      maybeNotifyAgentEvent(window, event);
    };
    const emitVolatile: EmitAgentEvent = (event) => {
      window.webContents.send(IPC_CHANNELS.agentEvent, event);
    };
    const agentDir = join(app.getPath("userData"), "pi-agent");
    const sessionDir = join(app.getPath("userData"), "pi-sessions");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(sessionDir, { recursive: true });

    const { settingsManager, loader } = await this.createSessionResources(
      info.cwd,
      info.id,
      emit,
      agentDir,
    );

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
    return this.assembleSession({
      info,
      emit,
      emitVolatile,
      agentDir,
      loader,
      settingsManager,
      sessionManager,
      model: selectedModel,
      thinkingLevel:
        selectedModel !== undefined
          ? toPiThinkingLevel(selectedInfo?.thinkingLevel ?? "off")
          : undefined,
    });
  }

  async prompt(window: BrowserWindow, input: PromptAgentInput): Promise<void> {
    const runtimeSession = await this.getOrResume(window, input.sessionId);
    if (!runtimeSession) {
      throw new Error(`Agent session not running: ${input.sessionId}`);
    }

    // Publish this session's tool context so the (process-wide) custom tools
    // (terminal, to-dos) resolve the right workspace/session/window/emitter
    // from their cwd.
    setAgentToolContext({
      workspaceId: runtimeSession.info.workspaceId,
      cwd: runtimeSession.info.cwd,
      sessionId: runtimeSession.info.id,
      window,
      emit: runtimeSession.emit,
    });

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
    // Rollback anchor: the session-tree leaf right before this prompt. Only
    // captured for normal delivery — steer/follow-up messages are appended at
    // an unpredictable point of the live stream, so they get no anchor (and no
    // edit affordance in the timeline).
    if (delivery === "normal") {
      runInput.piLeafBefore = runtimeSession.session.sessionManager.getLeafId() ?? PI_ROOT_LEAF;
    }
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
      ...(input.attachments && input.attachments.length > 0
        ? { attachments: input.attachments }
        : {}),
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
    try {
      const resolved = await resolveContext(runtimeSession.info.cwd, input.context);
      const contextText = formatResolvedContext(resolved);
      // Passive terminal awareness (like Cursor's terminal status): tell the
      // model what's running so it can decide to read/restart instead of
      // blindly re-launching.
      const digest = summarizeTerminals({
        sessionId: runtimeSession.info.id,
        workspaceId: runtimeSession.info.workspaceId,
      });
      const awareness = digest ? `<active_terminals>\n${digest}\n</active_terminals>` : "";
      // Manually invoked skills (`/name`) are injected as instruction blocks.
      const skillsText = resolveSkillsPrompt(runtimeSession.info.cwd, input.skills ?? []);
      const message = [skillsText, contextText, awareness, input.message]
        .filter(Boolean)
        .join("\n\n");
      const images = (input.attachments ?? []).map((attachment) => ({
        type: "image" as const,
        data: attachment.data,
        mimeType: attachment.mimeType,
      }));
      await runtimeSession.session.prompt(message, {
        source: "rpc",
        ...(images.length > 0 ? { images } : {}),
        ...(delivery === "normal"
          ? {}
          : { streamingBehavior: delivery === "follow-up" ? "followUp" : "steer" }),
      });
      this.emitContextUsage(runtimeSession);
      const currentRun = getAgentRun(run.id);
      if (currentRun?.status === "running") {
        if (outputTracker.hasVisibleOutput) {
          updateAgentRunStatus(run.id, "completed");
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
          runtimeSession.emit({
            type: "run.completed",
            sessionId: input.sessionId,
            runId: run.id,
            ...(changes && changes.fileCount > 0 ? { changes } : {}),
          });
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
      // A missing run row means a rollback removed this run while it was being
      // aborted — swallow the rejection instead of resurrecting ghost
      // run.failed / runtime.error events into the rolled-back timeline.
      const currentRun = getAgentRun(run.id);
      if (this.cancellingRuns.has(run.id) || !currentRun || currentRun.status === "cancelled") {
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
    if (activeRun) {
      this.cancellingRuns.add(activeRun.id);
    }

    try {
      await runtimeSession.session.abort();
    } finally {
      if (activeRun) {
        this.cancellingRuns.delete(activeRun.id);
        if (getAgentRun(activeRun.id)?.status !== "cancelled") {
          updateAgentRunStatus(activeRun.id, "cancelled");
          runtimeSession.emit({ type: "run.cancelled", sessionId, runId: activeRun.id });
        }
      }
      updateAgentSessionStatus(sessionId, "idle");
    }
  }

  async listRuns(sessionId: string): Promise<AgentRunInfo[]> {
    return listAgentRuns(sessionId);
  }

  async dispose(sessionId: string): Promise<void> {
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
    this.emitContextUsage(runtimeSession);
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
    this.emitContextUsage(runtimeSession);
    return next;
  }
}

function createContextUsageEvent(sessionId: string, session: AgentSession): AgentEvent | undefined {
  const usage = session.getContextUsage();
  if (!usage) {
    return undefined;
  }
  return {
    type: "context.updated",
    sessionId,
    usage: toContextUsageInfo(usage),
  };
}

function toContextUsageInfo(
  usage: NonNullable<ReturnType<AgentSession["getContextUsage"]>>,
): ContextUsageInfo {
  return {
    tokens: usage.tokens,
    contextWindow: usage.contextWindow,
    percent: usage.percent,
  };
}

function shouldPublishContextUsage(event: { type?: unknown }): boolean {
  return (
    event.type === "agent_end" ||
    event.type === "message_end" ||
    event.type === "tool_execution_end" ||
    event.type === "compaction_end"
  );
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
