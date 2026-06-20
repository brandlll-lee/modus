import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { app, type BrowserWindow as BrowserWindowType } from "electron";
import type {
  AgentEvent,
  AgentRunInfo,
  AgentSessionInfo,
  ContextItem,
  ContextUsageInfo,
  MessageContextChip,
  ModelInfo,
  PlanBuildStatus,
} from "../../shared/contracts";
import { releaseAgentBrowserControl } from "../browser/browser-service";
import { formatResolvedContext, resolveContext } from "../context/context-service";
import { getChangeStatsSince } from "../git/git-service";
import { IPC_CHANNELS } from "../ipc/channels";
import { maybeNotifyAgentEvent } from "../notifications/agent-notifications";
import { readPlanById, setPlanBuildStatusById } from "../plan/plan-store";
import { summarizeApps } from "../process/app-process-service";
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
  getModelRegistry,
  getModelThinkingVariant,
  listScopedModels,
  modelToId,
  resolveModelThinking,
  setDefaultModel,
} from "./model-service";
import { createPiEventNormalizer } from "./pi-event-normalizer";
import { createModusPermissionExtension } from "./pi-permission-extension";
import { planModePreamble, profileForMode } from "./plan-prompt";
import { PI_ROOT_LEAF } from "./rollback-service";
import type {
  AgentRuntime,
  CreateAgentRuntimeInput,
  EmitAgentEvent,
  PromptAgentInput,
} from "./runtime";
import { deriveSessionTitle, shouldReplaceSessionTitle } from "./session-title";
import { describeAgentShellForPrompt, resolveAgentShell } from "./shell-resolver";
import { registerAppTools } from "./tools/app-tools";
import { registerBrowserTools } from "./tools/browser-tools";
import { plansRoot, registerPlanTools } from "./tools/plan-tools";
import { registerQuestionTools } from "./tools/question-tools";
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
- Draw directory or file trees inside a fenced code block using box-drawing connectors (\`├──\`, \`└──\`, \`│\`), one entry per line, with any trailing \`#\` comments aligned — never depict a tree with bare indentation alone.
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
  startedAt: number;
};

/**
 * Minimum gap between live `tool.delta` emissions per session. Caps the IPC/
 * render rate while a large tool argument streams; the durable `tool.started`
 * still carries the final args, so throttling never loses the end state.
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
    registerBrowserTools();
    registerAppTools();
    registerTodoTools();
    registerPlanTools();
    registerQuestionTools();
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

  private async getOrResume(
    window: BrowserWindowType,
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
      // `tools` is also the allowlist that gates which tools enter the session's
      // registry (see createAgentSession in the pi SDK). It must be the UNION of
      // every profile we may switch to per-turn, or setActiveToolsByName can't
      // activate a tool that was filtered out — which is exactly why plan_write
      // was invisible in plan mode. Per-turn narrowing happens in prompt().
      tools: [
        ...new Set([
          ...toolRegistry.resolveActiveTools("chat"),
          ...toolRegistry.resolveActiveTools("plan"),
        ]),
      ],
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

    const { session } = await createAgentSession(sessionOptions);
    const normalizePiEvent = createPiEventNormalizer(params.info.id);
    const publishContextUsage = () => {
      const event = createContextUsageEvent(params.info.id, session);
      if (event) {
        params.emitVolatile(event);
      }
    };
    // Per-session throttle for live tool-call streaming. `tool.delta` carries
    // the (growing) partial args, so we cap its rate to keep IPC light; the
    // durable `tool.started` at execution time always delivers the final args.
    let lastToolDeltaAt = 0;
    const unsubscribe = session.subscribe((event) => {
      for (const normalized of normalizePiEvent(event)) {
        this.noteAssistantOutput(normalized);
        if (normalized.type === "tool.delta") {
          const now = Date.now();
          if (now - lastToolDeltaAt < TOOL_DELTA_THROTTLE_MS) {
            continue;
          }
          lastToolDeltaAt = now;
          params.emitVolatile(normalized);
        } else {
          params.emit(normalized);
        }
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

  async create(
    window: BrowserWindowType,
    input: CreateAgentRuntimeInput,
  ): Promise<AgentSessionInfo> {
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
    const recordInput: Parameters<typeof createAgentSessionRecord>[0] = {
      ...input,
      cwd: input.cwd,
      runtime: "pi-sdk",
    };
    if (modelId !== undefined) {
      recordInput.model = modelId;
    }
    const info = createAgentSessionRecord(recordInput);
    const selectedThinking = selectedModel ? resolveModelThinking(selectedModel) : undefined;

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
      model: selectedThinking?.model ?? selectedModel,
      thinkingLevel: selectedThinking?.thinkingLevel,
    });
    return runtimeSession.info;
  }

  private async createRuntimeSession(
    window: BrowserWindowType,
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
      model: selectedThinking?.model ?? selectedModel,
      thinkingLevel: selectedThinking?.thinkingLevel,
    });
  }

  async prompt(window: BrowserWindowType, input: PromptAgentInput): Promise<void> {
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

    // Per-turn mode: switch the active tool set (plan = read-only research +
    // plan_write; build = full chat tools). setActiveToolsByName also rebuilds
    // the system prompt for the new set, and takes effect on this turn.
    runtimeSession.session.setActiveToolsByName(
      toolRegistry.resolveActiveTools(profileForMode(input.mode)),
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

    const delivery = input.delivery ?? "normal";

    // Authoritative turn boundary: if a turn is already streaming, this message
    // JOINS it — pi queues it (steer/followUp) and resolves prompt() the moment
    // it is enqueued. A queued message is NOT a new run; wrapping it in a run
    // lifecycle would emit a phantom run.started→run.completed/failed that
    // settles the composer while the real turn is still streaming. We trust
    // pi's own `isStreaming`, never a guess from the delivery label.
    if (delivery !== "normal" && runtimeSession.session.isStreaming) {
      await this.enqueueTurnMessage(runtimeSession, input, delivery);
      return;
    }

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
    const userMessageId = input.userMessageId ?? `user:${run.id}`;
    // A "Build this plan" turn carries planId: tag the user message so the
    // timeline renders a compact Build card, and bind the plan's build status to
    // this run's authoritative lifecycle (building now → built/not_built later).
    const buildPlan = input.planId ? readPlanById(plansRoot(), input.planId) : undefined;
    this.emitUserMessage(
      runtimeSession,
      input,
      userMessageId,
      buildPlan
        ? { planId: buildPlan.id, title: buildPlan.title, todoCount: buildPlan.todos.length }
        : undefined,
    );
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
    // The turn is now streaming: publish the authoritative `busy` status that
    // the composer's lock + border follow. `idle` is published in `finally`,
    // and `retry` arrives (from the normalizer) if the runtime auto-retries.
    runtimeSession.emit({
      type: "session.status",
      sessionId: input.sessionId,
      status: { type: "busy" },
    });
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
    try {
      const message = await this.composeTurnMessage(runtimeSession, input);
      console.info(
        `[modus-timing] composeTurnMessage done +${Date.now() - outputTracker.startedAt}ms`,
      );
      const images = buildTurnImages(input);
      await runtimeSession.session.prompt(message, {
        source: "rpc",
        ...(images.length > 0 ? { images } : {}),
        ...(delivery === "normal"
          ? {}
          : { streamingBehavior: delivery === "follow-up" ? "followUp" : "steer" }),
      });
      console.info(`[modus-timing] prompt() resolved +${Date.now() - outputTracker.startedAt}ms`);
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
          console.info(
            `[modus-timing] getChangeStatsSince +${Date.now() - outputTracker.startedAt}ms`,
          );
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

  /**
   * Emit the user's message into the timeline (started → full text → completed),
   * carrying any attachments and context chips. Shared by a fresh turn and a
   * queued steer/follow-up so the sent message always shows the same way.
   */
  private emitUserMessage(
    runtimeSession: SdkRuntimeSession,
    input: PromptAgentInput,
    userMessageId: string,
    planBuild?: { planId: string; title: string; todoCount: number },
  ): void {
    const contextChips = buildContextChips(input.context ?? []);
    runtimeSession.emit({
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
  }

  /**
   * Build the full prompt text for a turn: plan-mode preamble, manually invoked
   * skills, resolved context, passive terminal/app awareness, then the user's
   * message. Shared by fresh and queued turns so a steered message carries the
   * same context envelope as a normal one.
   */
  private async composeTurnMessage(
    runtimeSession: SdkRuntimeSession,
    input: PromptAgentInput,
  ): Promise<string> {
    const resolved = await resolveContext(runtimeSession.info.cwd, input.context);
    const contextText = formatResolvedContext(resolved);
    // Passive terminal awareness (like Cursor's terminal status): tell the model
    // what's running so it can decide to read/restart instead of blindly
    // re-launching. Covers both PTY terminals and launched GUI apps.
    const terminalDigest = summarizeTerminals({
      sessionId: runtimeSession.info.id,
      workspaceId: runtimeSession.info.workspaceId,
    });
    const appDigest = summarizeApps({ sessionId: runtimeSession.info.id });
    const digest = [terminalDigest, appDigest].filter(Boolean).join("\n");
    const awareness = digest ? `<active_terminals>\n${digest}\n</active_terminals>` : "";
    const skillsText = resolveSkillsPrompt(runtimeSession.info.cwd, input.skills ?? []);
    return [planModePreamble(input.mode), skillsText, contextText, awareness, input.message]
      .filter(Boolean)
      .join("\n\n");
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
  ): Promise<void> {
    const userMessageId = input.userMessageId ?? `local-user:${randomUUID()}`;
    this.emitUserMessage(runtimeSession, input, userMessageId);
    try {
      const message = await this.composeTurnMessage(runtimeSession, input);
      const images = buildTurnImages(input);
      await runtimeSession.session.prompt(message, {
        source: "rpc",
        ...(images.length > 0 ? { images } : {}),
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
    const runtimeSession = await this.getOrResume(window, sessionId);
    if (!runtimeSession) {
      throw new Error(`Unable to set model: ${modelId}`);
    }
    const model = await this.applyModelSelection(runtimeSession, modelId, thinkingVariant);
    if (!model) {
      throw new Error(`Unable to set model: ${modelId}`);
    }
    setDefaultModel(modelToId(model));
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

    const next = cycleDefaultModel(direction);
    const model = findModel(next.id);
    if (!model) {
      throw new Error(`Unable to cycle to model: ${next.id}`);
    }
    const resolved = resolveModelThinking(model, next.thinkingVariant);
    await runtimeSession.session.setModel(resolved.model);
    runtimeSession.session.setThinkingLevel(resolved.thinkingLevel);
    updateAgentSessionMetadata(sessionId, { model: modelToId(model) });
    this.emitContextUsage(runtimeSession);
    return next;
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

/**
 * Compact, display-only chips for the sent user message bubble (Cursor parity:
 * the context you attached stays visible after sending). Derived from the run's
 * context items — the full items are still resolved server-side for the model.
 */
function buildContextChips(items: ContextItem[]): MessageContextChip[] {
  return items.map(contextChipFor);
}

function contextChipFor(item: ContextItem): MessageContextChip {
  switch (item.type) {
    case "file":
      return { kind: "file", label: chipBasename(item.path) };
    case "folder":
      return { kind: "folder", label: `${chipBasename(item.path)}/` };
    case "doc":
      return { kind: "doc", label: item.title };
    case "terminal":
      return { kind: "terminal", label: `terminal:${item.terminalId.slice(0, 6)}` };
    case "browser":
      return { kind: "browser", label: "browser" };
    case "git-diff":
      return { kind: "git-diff", label: item.mode === "branch" ? "Branch" : "working diff" };
    case "past-chat":
      return { kind: "past-chat", label: item.title };
    case "project-summary":
      return { kind: "project-summary", label: "project summary" };
    case "recent-changes":
      return { kind: "recent-changes", label: "recent changes" };
    case "rules":
      return { kind: "rules", label: "project rules" };
    case "search":
      return { kind: "search", label: `search:${item.query}` };
    case "design-element": {
      const el = item.element;
      const text = el.text
        ? ` "${el.text.length > 24 ? `${el.text.slice(0, 23)}…` : el.text}"`
        : "";
      const detail = el.source ? `${el.source.file}:${el.source.line}` : el.domPath;
      return { kind: "design-element", label: `${el.label}${text}`, detail };
    }
  }
}

function chipBasename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
