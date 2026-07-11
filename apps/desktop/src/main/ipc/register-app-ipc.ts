import { isAbsolute, resolve, sep } from "node:path";
import {
  app,
  BrowserWindow,
  type BrowserWindow as BrowserWindowType,
  type IpcMainInvokeEvent,
  ipcMain,
  shell,
} from "electron";
import { listAgentEvents, recordAgentEvent } from "../agent/agent-event-store";
import { listAgentRuns } from "../agent/agent-run-store";
import {
  getAgentSession,
  listAgentSessions,
  listArchivedAgentSessions,
  setAgentSessionPinned,
  updateAgentSessionWorktree,
} from "../agent/agent-store";
import {
  getSessionBaseCheckpoint,
  listCheckpoints,
  restoreCheckpoint,
} from "../agent/checkpoint-service";
import {
  configureProvider,
  deleteCustomProvider,
  getCustomProviderConfig,
  getModelSettings,
  getProviderDetail,
  listModels,
  setDefaultModel,
  testCustomProvider,
  updateModelConfig,
  upsertCustomProvider,
} from "../agent/model-service";
import { listAgentReviews, startAgentReview } from "../agent/review-service";
import { rollbackToUserMessage } from "../agent/rollback-service";
import { getAgentRuntime } from "../agent/runtime-registry";
import { deleteAgentSessionTree, setAgentSessionArchivedTree } from "../agent/session-lifecycle";
import {
  createSubagent,
  deleteSubagent,
  ensureSubagentsDir,
  getSubagent,
  listSubagents,
  updateSubagent,
} from "../agent/subagents-config";
import { deleteBrowserRecent, listBrowserRecents } from "../browser/browser-recents-store";
import {
  closeBrowserTab,
  createBrowserTab,
  findInBrowserPage,
  hideBrowserTab,
  listBrowserTabs,
  navigateBrowser,
  navigateBrowserBack,
  navigateBrowserForward,
  openBrowserExternal,
  reloadBrowser,
  selectBrowserTab,
  setBrowserBounds,
  setBrowserDesignMode,
  showBrowserTab,
  stopFindInBrowserPage,
  toggleBrowserDevtools,
} from "../browser/browser-service";
import { resolveContext, searchContext } from "../context/context-service";
import { addDocSource, listDocSources, searchDocs } from "../docs/docs-service";
import { listDirectory, readWorkspaceFile } from "../files/files-service";
import {
  abortSubagentWorktreeApply,
  applySubagentWorktree,
  checkoutBranch,
  cleanupSubagentWorktree,
  commitOrPush,
  discardFile,
  getChangeStatsSince,
  getStatusSummary,
  getWorkingChangeStats,
  initRepository,
  isGitRepository,
  listBranches,
  listChanges,
  listCommitChanges,
  listCommitLog,
  readDiff,
  readFileVersions,
} from "../git/git-service";
import { emitGitEvent, unwatchRepo, watchRepo } from "../git/git-watcher";
import {
  ensurePersonalizationFile,
  getPersonalization,
  savePersonalization,
} from "../guidance/guidance-service";
import {
  denyPendingQuestionRequests,
  resolveQuestionRequest,
} from "../interaction/question-broker";
import {
  deleteMcpServer,
  ensureMcpConfigFile,
  getMcpServerEntry,
  listMcpServers,
  setMcpServerEnabled,
  syncWorkspaceMcp,
  upsertMcpServer,
} from "../mcp/mcp-service";
import {
  denyPendingPermissionRequests,
  resolvePermissionRequest,
} from "../permissions/permission-broker";
import {
  getApprovalMode,
  listPermissionDecisions,
  recordPermissionDecision,
  setApprovalMode,
} from "../permissions/permission-store";
import { onManagedProcessChange } from "../process/managed-process-bus";
import { killManagedProcess, listManagedProcesses } from "../process/managed-process-facade";
import { listRuleFiles } from "../rules/rules-service";
import { createSkill, ensureSkillsDir, getSkill, listSkills } from "../skills/skills-service";
import type { StartupTimeline } from "../startup/startup-timeline";
import {
  createTerminal,
  killTerminal,
  listTerminals,
  removeTerminal,
  resizeTerminal,
  writeTerminal,
} from "../terminal/terminal-service";
import {
  archiveProjectChats,
  deleteProjectChats,
  getRecentWorkspaces,
  openWorkspace,
  removeProject,
  renameProject,
  revealProject,
  setProjectPinned,
} from "../workspace/workspace-service";
import { upsertWorkspace } from "../workspace/workspace-store";
import { IPC_CHANNELS } from "./channels";
import {
  agentCreateSchema,
  agentCycleModelSchema,
  agentListSchema,
  agentPromptSchema,
  agentRollbackSchema,
  agentSetModelSchema,
  approvalModeSchema,
  browserBoundsSchema,
  browserCreateTabSchema,
  browserDesignModeSchema,
  browserFindSchema,
  browserFindStopSchema,
  browserNavigateSchema,
  browserRecentSchema,
  browserTabSchema,
  browserWorkspaceSchema,
  checkpointRestoreSchema,
  configureProviderSchema,
  contextResolveSchema,
  contextSearchSchema,
  cwdSchema,
  diffCommitChangesSchema,
  diffCommitOrPushSchema,
  diffFileVersionsSchema,
  diffPathSchema,
  diffReadSchema,
  diffStatsSinceSchema,
  docsAddSchema,
  docsSearchSchema,
  fileOpenSchema,
  filesListSchema,
  filesReadSchema,
  gitCheckoutSchema,
  gitLogSchema,
  mcpServerNameSchema,
  mcpSetEnabledSchema,
  mcpUpsertSchema,
  parseIpcInput,
  permissionDecideSchema,
  personalizationSaveSchema,
  processKillSchema,
  processListSchema,
  questionRespondSchema,
  reviewStartSchema,
  sessionIdSchema,
  sessionPinSchema,
  skillsCreateSchema,
  skillsGetSchema,
  startupMetricSchema,
  subagentsCreateSchema,
  subagentsDeleteSchema,
  subagentsGetSchema,
  subagentsOpenDirSchema,
  subagentsUpdateSchema,
  terminalCreateSchema,
  terminalResizeSchema,
  terminalWriteSchema,
  testCustomProviderSchema,
  updateModelConfigSchema,
  upsertCustomProviderSchema,
  workspaceIdSchema,
  workspacePinSchema,
  workspaceRenameSchema,
} from "./schemas";

const TRUSTED_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const senderUrl = event.senderFrame?.url;

  if (!senderUrl) {
    return false;
  }

  try {
    const url = new URL(senderUrl);

    if (url.protocol === "file:") {
      return true;
    }

    if (url.protocol === "http:" && TRUSTED_DEV_HOSTS.has(url.hostname)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedSender(event)) {
    throw new Error("Blocked IPC call from untrusted renderer frame.");
  }
}

function getSenderWindow(event: IpcMainInvokeEvent): BrowserWindowType {
  const window = BrowserWindow.fromWebContents(event.sender);

  if (!window) {
    throw new Error("Unable to resolve sender window.");
  }

  return window;
}

export function registerAppIpc({
  startupTimeline,
}: {
  startupTimeline?: StartupTimeline;
} = {}): void {
  ipcMain.handle(IPC_CHANNELS.appVersion, (event) => {
    assertTrustedSender(event);
    return app.getVersion();
  });

  ipcMain.handle(IPC_CHANNELS.securityState, (event) => {
    assertTrustedSender(event);

    return {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      senderValidation: true,
    };
  });

  ipcMain.handle(IPC_CHANNELS.appStartupMetric, (event, input) => {
    assertTrustedSender(event);
    const metric = parseIpcInput(startupMetricSchema, input, IPC_CHANNELS.appStartupMetric);
    startupTimeline?.mark(metric.milestone, metric.rendererElapsedMs);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceOpen, async (event) => {
    assertTrustedSender(event);
    return await openWorkspace();
  });

  ipcMain.handle(IPC_CHANNELS.workspaceList, (event) => {
    assertTrustedSender(event);
    return getRecentWorkspaces();
  });

  ipcMain.handle(IPC_CHANNELS.workspacePin, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(workspacePinSchema, input, IPC_CHANNELS.workspacePin);
    return setProjectPinned(parsed.id, parsed.pinned);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceRename, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(workspaceRenameSchema, input, IPC_CHANNELS.workspaceRename);
    return renameProject(parsed.id, parsed.displayName);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceArchiveChats, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(workspaceIdSchema, input, IPC_CHANNELS.workspaceArchiveChats);
    return await archiveProjectChats(parsed.id);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceDeleteChats, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(workspaceIdSchema, input, IPC_CHANNELS.workspaceDeleteChats);
    return await deleteProjectChats(parsed.id);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceRemove, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(workspaceIdSchema, input, IPC_CHANNELS.workspaceRemove);
    return await removeProject(parsed.id);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceReveal, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(workspaceIdSchema, input, IPC_CHANNELS.workspaceReveal);
    await revealProject(parsed.id);
  });

  // Open a file the agent touched in the OS default app. The path is sandboxed
  // to the session cwd so a compromised renderer can't coax the main process
  // into launching arbitrary files outside the workspace.
  ipcMain.handle(IPC_CHANNELS.fileOpen, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(fileOpenSchema, input, IPC_CHANNELS.fileOpen);
    const root = resolve(parsed.cwd);
    const target = isAbsolute(parsed.path) ? resolve(parsed.path) : resolve(root, parsed.path);
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error("Refusing to open a path outside the workspace.");
    }
    const failure = await shell.openPath(target);
    if (failure) {
      throw new Error(failure);
    }
  });

  ipcMain.handle(IPC_CHANNELS.agentCreate, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(agentCreateSchema, input, IPC_CHANNELS.agentCreate);
    return await getAgentRuntime().create(getSenderWindow(event), {
      workspaceId: parsed.workspaceId,
      cwd: parsed.cwd,
      title: parsed.title,
      ...(parsed.model !== undefined ? { model: parsed.model } : {}),
    });
  });

  ipcMain.handle(IPC_CHANNELS.agentList, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(agentListSchema, input, IPC_CHANNELS.agentList);
    return listAgentSessions(
      parsed?.includeSessionId ? { includeSessionId: parsed.includeSessionId } : {},
    );
  });

  ipcMain.handle(IPC_CHANNELS.agentListArchived, (event, workspaceId: string) => {
    assertTrustedSender(event);
    const id = parseIpcInput(sessionIdSchema, workspaceId, IPC_CHANNELS.agentListArchived);
    return listArchivedAgentSessions(id);
  });

  ipcMain.handle(IPC_CHANNELS.agentListEvents, (event, sessionId: string) => {
    assertTrustedSender(event);
    return listAgentEvents(parseIpcInput(sessionIdSchema, sessionId, IPC_CHANNELS.agentListEvents));
  });

  ipcMain.handle(IPC_CHANNELS.agentListRuns, (event, sessionId: string) => {
    assertTrustedSender(event);
    return listAgentRuns(parseIpcInput(sessionIdSchema, sessionId, IPC_CHANNELS.agentListRuns));
  });

  ipcMain.handle(IPC_CHANNELS.agentEnsure, async (event, sessionId: string) => {
    assertTrustedSender(event);
    return await getAgentRuntime().ensure(
      getSenderWindow(event),
      parseIpcInput(sessionIdSchema, sessionId, IPC_CHANNELS.agentEnsure),
    );
  });

  ipcMain.handle(IPC_CHANNELS.agentPrompt, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(agentPromptSchema, input, IPC_CHANNELS.agentPrompt);
    await getAgentRuntime().prompt(getSenderWindow(event), {
      sessionId: parsed.sessionId,
      message: parsed.message,
      context: parsed.context ?? [],
      ...(parsed.delivery !== undefined ? { delivery: parsed.delivery } : {}),
      ...(parsed.userMessageId !== undefined ? { userMessageId: parsed.userMessageId } : {}),
      ...(parsed.attachments !== undefined ? { attachments: parsed.attachments } : {}),
      ...(parsed.skills !== undefined ? { skills: parsed.skills } : {}),
      ...(parsed.mode !== undefined ? { mode: parsed.mode } : {}),
      ...(parsed.model !== undefined ? { model: parsed.model } : {}),
      ...(parsed.thinkingLevel !== undefined ? { thinkingLevel: parsed.thinkingLevel } : {}),
      ...(parsed.thinkingVariant !== undefined ? { thinkingVariant: parsed.thinkingVariant } : {}),
      ...(parsed.planId !== undefined ? { planId: parsed.planId } : {}),
    });
  });

  ipcMain.handle(IPC_CHANNELS.agentAbort, async (event, sessionId: string) => {
    assertTrustedSender(event);
    await getAgentRuntime().abort(
      parseIpcInput(sessionIdSchema, sessionId, IPC_CHANNELS.agentAbort),
    );
  });

  // Cursor-style "edit & resend": rewind conversation + workspace files to
  // just before a user message. The renderer refetches events afterwards and
  // re-prompts with the edited text, so no event is emitted here.
  ipcMain.handle(IPC_CHANNELS.agentRollback, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(agentRollbackSchema, input, IPC_CHANNELS.agentRollback);
    return await rollbackToUserMessage(getAgentRuntime(), parsed);
  });

  ipcMain.handle(IPC_CHANNELS.agentPin, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(sessionPinSchema, input, IPC_CHANNELS.agentPin);
    return setAgentSessionPinned(parsed.id, parsed.pinned);
  });

  ipcMain.handle(IPC_CHANNELS.agentArchive, async (event, sessionId: string) => {
    assertTrustedSender(event);
    const id = parseIpcInput(sessionIdSchema, sessionId, IPC_CHANNELS.agentArchive);
    await setAgentSessionArchivedTree(id, true);
  });

  ipcMain.handle(IPC_CHANNELS.agentRestore, async (event, sessionId: string) => {
    assertTrustedSender(event);
    const id = parseIpcInput(sessionIdSchema, sessionId, IPC_CHANNELS.agentRestore);
    await setAgentSessionArchivedTree(id, false);
  });

  ipcMain.handle(IPC_CHANNELS.agentDelete, async (event, sessionId: string) => {
    assertTrustedSender(event);
    const id = parseIpcInput(sessionIdSchema, sessionId, IPC_CHANNELS.agentDelete);
    await deleteAgentSessionTree(id);
  });

  ipcMain.handle(IPC_CHANNELS.agentApplySubagentWorktree, async (event, sessionId: string) => {
    assertTrustedSender(event);
    const id = parseIpcInput(sessionIdSchema, sessionId, IPC_CHANNELS.agentApplySubagentWorktree);
    const child = getAgentSession(id);
    if (!child?.parentSessionId || !child.subagentWorktree) {
      throw new Error("Subagent worktree not found.");
    }
    const parent = getAgentSession(child.parentSessionId);
    if (!parent) {
      throw new Error("Parent session not found.");
    }
    const worktree = await applySubagentWorktree(parent.cwd, child.subagentWorktree);
    const updated = updateAgentSessionWorktree(child.id, worktree) ?? child;
    emitGitEvent({ cwd: parent.cwd, kind: "index" });
    return updated;
  });

  ipcMain.handle(IPC_CHANNELS.agentAbortSubagentWorktreeApply, async (event, sessionId: string) => {
    assertTrustedSender(event);
    const id = parseIpcInput(
      sessionIdSchema,
      sessionId,
      IPC_CHANNELS.agentAbortSubagentWorktreeApply,
    );
    const child = getAgentSession(id);
    if (!child?.parentSessionId || !child.subagentWorktree) {
      throw new Error("Subagent worktree not found.");
    }
    if (!["applied", "conflict"].includes(child.subagentWorktree.integrationStatus)) {
      throw new Error("Only applied or conflicted worktree applies can be aborted.");
    }
    const parent = getAgentSession(child.parentSessionId);
    if (!parent) {
      throw new Error("Parent session not found.");
    }
    const worktree = await abortSubagentWorktreeApply(parent.cwd, child.subagentWorktree);
    const updated = updateAgentSessionWorktree(child.id, worktree) ?? child;
    emitGitEvent({ cwd: parent.cwd, kind: "index" });
    return updated;
  });

  ipcMain.handle(IPC_CHANNELS.agentCleanupSubagentWorktree, async (event, sessionId: string) => {
    assertTrustedSender(event);
    const id = parseIpcInput(sessionIdSchema, sessionId, IPC_CHANNELS.agentCleanupSubagentWorktree);
    const child = getAgentSession(id);
    if (!child?.parentSessionId || !child.subagentWorktree) {
      throw new Error("Subagent worktree not found.");
    }
    if (!["applied", "no_changes"].includes(child.subagentWorktree.integrationStatus)) {
      throw new Error("Only applied or no-change worktrees can be cleaned up.");
    }
    const parent = getAgentSession(child.parentSessionId);
    if (!parent) {
      throw new Error("Parent session not found.");
    }
    const worktree = await cleanupSubagentWorktree(parent.cwd, child.subagentWorktree);
    const updated = updateAgentSessionWorktree(child.id, worktree) ?? child;
    emitGitEvent({ cwd: parent.cwd, kind: "refs" });
    return updated;
  });

  ipcMain.handle(IPC_CHANNELS.agentSetModel, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(agentSetModelSchema, input, IPC_CHANNELS.agentSetModel);
    return await getAgentRuntime().setModel(
      getSenderWindow(event),
      parsed.sessionId,
      parsed.model,
      parsed.thinkingVariant ?? parsed.thinkingLevel,
    );
  });

  ipcMain.handle(IPC_CHANNELS.agentCycleModel, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(agentCycleModelSchema, input, IPC_CHANNELS.agentCycleModel);
    return await getAgentRuntime().cycleModel(
      getSenderWindow(event),
      parsed.sessionId,
      parsed.direction,
    );
  });

  ipcMain.handle(IPC_CHANNELS.terminalCreate, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(terminalCreateSchema, input, IPC_CHANNELS.terminalCreate);
    return createTerminal(getSenderWindow(event), {
      workspaceId: parsed.workspaceId,
      ...(parsed.cwd !== undefined ? { cwd: parsed.cwd } : {}),
      ...(parsed.cols !== undefined ? { cols: parsed.cols } : {}),
      ...(parsed.rows !== undefined ? { rows: parsed.rows } : {}),
    });
  });

  ipcMain.handle(IPC_CHANNELS.terminalWrite, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(terminalWriteSchema, input, IPC_CHANNELS.terminalWrite);
    writeTerminal(parsed.terminalId, parsed.data);
  });

  ipcMain.handle(IPC_CHANNELS.terminalResize, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(terminalResizeSchema, input, IPC_CHANNELS.terminalResize);
    resizeTerminal(parsed.terminalId, parsed.cols, parsed.rows);
  });

  ipcMain.handle(IPC_CHANNELS.terminalKill, (event, terminalId: string) => {
    assertTrustedSender(event);
    killTerminal(parseIpcInput(sessionIdSchema, terminalId, IPC_CHANNELS.terminalKill));
  });

  ipcMain.handle(IPC_CHANNELS.terminalRemove, (event, terminalId: string) => {
    assertTrustedSender(event);
    removeTerminal(parseIpcInput(sessionIdSchema, terminalId, IPC_CHANNELS.terminalRemove));
  });

  ipcMain.handle(IPC_CHANNELS.terminalList, (event) => {
    assertTrustedSender(event);
    return listTerminals();
  });

  ipcMain.handle(IPC_CHANNELS.processList, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(processListSchema, input, IPC_CHANNELS.processList);
    return listManagedProcesses({
      ...(parsed.workspaceId !== undefined ? { workspaceId: parsed.workspaceId } : {}),
      ...(parsed.sessionId !== undefined ? { sessionId: parsed.sessionId } : {}),
      ...(parsed.origin !== undefined ? { origin: parsed.origin } : {}),
    });
  });

  ipcMain.handle(IPC_CHANNELS.processKill, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(processKillSchema, input, IPC_CHANNELS.processKill);
    return killManagedProcess(parsed.id);
  });

  // Observer fan-out: when any registry reports a process created/exited/killed,
  // push a coarse no-payload signal to every window. The renderer re-reads the
  // session-scoped snapshot, so a single signal drives both the composer bar and
  // the terminal panel without per-window bookkeeping here.
  onManagedProcessChange(() => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.processChanged);
      }
    }
  });

  ipcMain.handle(IPC_CHANNELS.browserListTabs, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(browserWorkspaceSchema, input, IPC_CHANNELS.browserListTabs);
    return listBrowserTabs(parsed.workspaceId);
  });

  ipcMain.handle(IPC_CHANNELS.browserCreateTab, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(browserCreateTabSchema, input, IPC_CHANNELS.browserCreateTab);
    return createBrowserTab(getSenderWindow(event), {
      workspaceId: parsed.workspaceId,
      ...(parsed.url !== undefined ? { url: parsed.url } : {}),
      select: true,
    });
  });

  ipcMain.handle(IPC_CHANNELS.browserSelectTab, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(browserTabSchema, input, IPC_CHANNELS.browserSelectTab);
    return selectBrowserTab(getSenderWindow(event), parsed.tabId);
  });

  ipcMain.handle(IPC_CHANNELS.browserCloseTab, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(browserTabSchema, input, IPC_CHANNELS.browserCloseTab);
    closeBrowserTab(parsed.tabId);
  });

  ipcMain.handle(IPC_CHANNELS.browserNavigate, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(browserNavigateSchema, input, IPC_CHANNELS.browserNavigate);
    return await navigateBrowser({
      window: getSenderWindow(event),
      ...(parsed.workspaceId !== undefined ? { workspaceId: parsed.workspaceId } : {}),
      ...(parsed.tabId !== undefined ? { tabId: parsed.tabId } : {}),
      url: parsed.url,
      ...(parsed.newTab !== undefined ? { newTab: parsed.newTab } : {}),
    });
  });

  ipcMain.handle(IPC_CHANNELS.browserBack, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(browserTabSchema, input, IPC_CHANNELS.browserBack);
    return navigateBrowserBack({ tabId: parsed.tabId });
  });

  ipcMain.handle(IPC_CHANNELS.browserForward, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(browserTabSchema, input, IPC_CHANNELS.browserForward);
    return navigateBrowserForward({ tabId: parsed.tabId });
  });

  ipcMain.handle(IPC_CHANNELS.browserReload, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(browserTabSchema, input, IPC_CHANNELS.browserReload);
    return reloadBrowser({ tabId: parsed.tabId });
  });

  // Renderer rectangles arrive in the renderer's CSS pixels. When the chrome
  // UI is zoomed (Ctrl +/- persists per-origin in Electron), CSS px no longer
  // equal window DIPs — un-scaled bounds shifted the WebContentsView (the
  // "black band beside the page" bug), with the offset growing with x/y.
  const scaleBoundsToWindow = (
    event: IpcMainInvokeEvent,
    bounds: { x: number; y: number; width: number; height: number },
  ) => {
    const zoom = event.sender.getZoomFactor();
    if (zoom === 1) {
      return bounds;
    }
    return {
      x: bounds.x * zoom,
      y: bounds.y * zoom,
      width: bounds.width * zoom,
      height: bounds.height * zoom,
    };
  };

  ipcMain.handle(IPC_CHANNELS.browserSetBounds, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(browserBoundsSchema, input, IPC_CHANNELS.browserSetBounds);
    setBrowserBounds(parsed.tabId, scaleBoundsToWindow(event, parsed.bounds));
  });

  ipcMain.handle(IPC_CHANNELS.browserShow, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(browserBoundsSchema, input, IPC_CHANNELS.browserShow);
    showBrowserTab(getSenderWindow(event), parsed.tabId, scaleBoundsToWindow(event, parsed.bounds));
  });

  ipcMain.handle(IPC_CHANNELS.browserHide, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(browserTabSchema, input, IPC_CHANNELS.browserHide);
    hideBrowserTab(parsed.tabId);
  });

  ipcMain.handle(IPC_CHANNELS.browserToggleDevtools, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(browserTabSchema, input, IPC_CHANNELS.browserToggleDevtools);
    return toggleBrowserDevtools(parsed.tabId);
  });

  ipcMain.handle(IPC_CHANNELS.browserOpenExternal, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(browserTabSchema, input, IPC_CHANNELS.browserOpenExternal);
    await openBrowserExternal(parsed.tabId);
  });

  ipcMain.handle(IPC_CHANNELS.browserDesignMode, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(browserDesignModeSchema, input, IPC_CHANNELS.browserDesignMode);
    return await setBrowserDesignMode(
      parsed.tabId,
      parsed.enabled,
      parsed.theme ? parsed.theme : undefined,
    );
  });

  ipcMain.handle(IPC_CHANNELS.browserFind, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(browserFindSchema, input, IPC_CHANNELS.browserFind);
    findInBrowserPage(parsed.tabId, parsed.query, {
      ...(parsed.forward !== undefined ? { forward: parsed.forward } : {}),
      ...(parsed.findNext !== undefined ? { findNext: parsed.findNext } : {}),
      ...(parsed.matchCase !== undefined ? { matchCase: parsed.matchCase } : {}),
    });
  });

  ipcMain.handle(IPC_CHANNELS.browserFindStop, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(browserFindStopSchema, input, IPC_CHANNELS.browserFindStop);
    stopFindInBrowserPage(parsed.tabId, parsed.action ?? "clearSelection");
  });

  ipcMain.handle(IPC_CHANNELS.browserListRecents, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(browserWorkspaceSchema, input, IPC_CHANNELS.browserListRecents);
    return listBrowserRecents(parsed.workspaceId);
  });

  ipcMain.handle(IPC_CHANNELS.browserDeleteRecent, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(browserRecentSchema, input, IPC_CHANNELS.browserDeleteRecent);
    deleteBrowserRecent(parsed.id);
  });

  ipcMain.handle(IPC_CHANNELS.diffList, async (event, cwd: string) => {
    assertTrustedSender(event);
    return await listChanges(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.diffList));
  });

  ipcMain.handle(IPC_CHANNELS.diffRead, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(diffReadSchema, input, IPC_CHANNELS.diffRead);
    return await readDiff(parsed.cwd, parsed.path, parsed.mode);
  });

  ipcMain.handle(IPC_CHANNELS.diffFileVersions, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(diffFileVersionsSchema, input, IPC_CHANNELS.diffFileVersions);
    return await readFileVersions(
      parsed.cwd,
      parsed.path,
      parsed.mode,
      parsed.originalPath,
      parsed.commit,
    );
  });

  ipcMain.handle(IPC_CHANNELS.diffCommitChanges, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(diffCommitChangesSchema, input, IPC_CHANNELS.diffCommitChanges);
    return await listCommitChanges(parsed.cwd, parsed.commit);
  });

  ipcMain.handle(IPC_CHANNELS.diffDiscard, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(diffPathSchema, input, IPC_CHANNELS.diffDiscard);
    await discardFile(parsed.cwd, parsed.path);
  });

  ipcMain.handle(IPC_CHANNELS.diffStatus, async (event, cwd: string) => {
    assertTrustedSender(event);
    return await getStatusSummary(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.diffStatus));
  });

  // Working-tree change summary (file list + ± line counts) for the composer changes strip.
  ipcMain.handle(IPC_CHANNELS.diffStats, async (event, cwd: string) => {
    assertTrustedSender(event);
    return await getWorkingChangeStats(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.diffStats));
  });

  ipcMain.handle(IPC_CHANNELS.diffStatsSince, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(diffStatsSinceSchema, input, IPC_CHANNELS.diffStatsSince);
    return await getChangeStatsSince(parsed.cwd, parsed.base);
  });

  // Session-scoped change summary for the composer strip: changes made since
  // THIS session's baseline (its first checkpoint), not the whole repo's
  // uncommitted state. No baseline yet → empty (the session changed nothing).
  ipcMain.handle(IPC_CHANNELS.diffSessionStats, async (event, sessionId: string) => {
    assertTrustedSender(event);
    const id = parseIpcInput(sessionIdSchema, sessionId, IPC_CHANNELS.diffSessionStats);
    const base = getSessionBaseCheckpoint(id);
    if (!base) {
      return { files: [], added: 0, removed: 0, fileCount: 0, truncated: false };
    }
    return await getChangeStatsSince(base.cwd, base.commitHash);
  });

  ipcMain.handle(IPC_CHANNELS.diffCommitOrPush, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(diffCommitOrPushSchema, input, IPC_CHANNELS.diffCommitOrPush);
    return await commitOrPush(parsed.cwd, {
      ...(parsed.message !== undefined ? { message: parsed.message } : {}),
      commit: parsed.commit,
      push: parsed.push,
    });
  });

  ipcMain.handle(IPC_CHANNELS.filesList, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(filesListSchema, input, IPC_CHANNELS.filesList);
    return listDirectory(parsed.cwd, parsed.dir);
  });

  ipcMain.handle(IPC_CHANNELS.filesRead, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(filesReadSchema, input, IPC_CHANNELS.filesRead);
    return readWorkspaceFile(parsed.cwd, parsed.path);
  });

  ipcMain.handle(IPC_CHANNELS.gitBranches, async (event, cwd: string) => {
    assertTrustedSender(event);
    return await listBranches(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.gitBranches));
  });

  ipcMain.handle(IPC_CHANNELS.gitCheckout, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(gitCheckoutSchema, input, IPC_CHANNELS.gitCheckout);
    return await checkoutBranch(parsed.cwd, parsed.name, parsed.remote ?? false);
  });

  ipcMain.handle(IPC_CHANNELS.gitIsRepository, async (event, cwd: string) => {
    assertTrustedSender(event);
    return await isGitRepository(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.gitIsRepository));
  });

  ipcMain.handle(IPC_CHANNELS.gitInit, async (event, cwd: string) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.gitInit);
    const result = await initRepository(parsed);
    upsertWorkspace(parsed, await isGitRepository(parsed));
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.gitLog, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(gitLogSchema, input, IPC_CHANNELS.gitLog);
    return await listCommitLog(parsed.cwd, parsed.limit);
  });

  ipcMain.handle(IPC_CHANNELS.gitWatch, (event, cwd: string) => {
    assertTrustedSender(event);
    return watchRepo(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.gitWatch));
  });

  ipcMain.handle(IPC_CHANNELS.gitUnwatch, (event, cwd: string) => {
    assertTrustedSender(event);
    unwatchRepo(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.gitUnwatch));
  });

  ipcMain.handle(IPC_CHANNELS.permissionDecide, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(permissionDecideSchema, input, IPC_CHANNELS.permissionDecide);
    if (parsed.requestId) {
      const resolved = resolvePermissionRequest(parsed.requestId, parsed.decision);
      if (resolved) {
        return resolved;
      }
    }
    return recordPermissionDecision(parsed.action, parsed.target, parsed.decision);
  });

  ipcMain.handle(IPC_CHANNELS.permissionList, (event) => {
    assertTrustedSender(event);
    return listPermissionDecisions();
  });

  ipcMain.handle(IPC_CHANNELS.permissionGetMode, (event) => {
    assertTrustedSender(event);
    return getApprovalMode();
  });

  ipcMain.handle(IPC_CHANNELS.permissionSetMode, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(approvalModeSchema, input, IPC_CHANNELS.permissionSetMode);
    return setApprovalMode(parsed.mode);
  });

  ipcMain.handle(IPC_CHANNELS.questionsRespond, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(questionRespondSchema, input, IPC_CHANNELS.questionsRespond);
    return (
      resolveQuestionRequest(
        parsed.requestId,
        parsed.answers.map((answer) => ({
          questionId: answer.questionId,
          selected: answer.selected,
          ...(answer.custom !== undefined ? { custom: answer.custom } : {}),
        })),
        parsed.skipped,
      ) ?? null
    );
  });

  ipcMain.handle(IPC_CHANNELS.contextSearch, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(contextSearchSchema, input, IPC_CHANNELS.contextSearch);
    return await searchContext({
      workspaceId: parsed.workspaceId,
      cwd: parsed.cwd,
      query: parsed.query,
      ...(parsed.kind !== undefined ? { kind: parsed.kind } : {}),
    });
  });

  ipcMain.handle(IPC_CHANNELS.contextResolve, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(contextResolveSchema, input, IPC_CHANNELS.contextResolve);
    return await resolveContext(parsed.cwd, parsed.items);
  });

  ipcMain.handle(IPC_CHANNELS.docsList, (event, workspaceId: string) => {
    assertTrustedSender(event);
    return listDocSources(parseIpcInput(sessionIdSchema, workspaceId, IPC_CHANNELS.docsList));
  });

  ipcMain.handle(IPC_CHANNELS.docsAdd, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(docsAddSchema, input, IPC_CHANNELS.docsAdd);
    return addDocSource({
      workspaceId: parsed.workspaceId,
      title: parsed.title,
      ...(parsed.path !== undefined ? { path: parsed.path } : {}),
      ...(parsed.url !== undefined ? { url: parsed.url } : {}),
    });
  });

  ipcMain.handle(IPC_CHANNELS.docsSearch, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(docsSearchSchema, input, IPC_CHANNELS.docsSearch);
    return searchDocs(parsed.workspaceId, parsed.query);
  });

  ipcMain.handle(IPC_CHANNELS.reviewStart, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(reviewStartSchema, input, IPC_CHANNELS.reviewStart);
    if (parsed.sessionId) {
      const startedEvent = {
        type: "review.started",
        sessionId: parsed.sessionId,
        reviewId: "pending",
      } as const;
      recordAgentEvent(startedEvent);
      getSenderWindow(event).webContents.send(IPC_CHANNELS.agentEvent, startedEvent);
    }
    try {
      const review = await startAgentReview({
        cwd: parsed.cwd,
        ...(parsed.sessionId !== undefined ? { sessionId: parsed.sessionId } : {}),
        ...(parsed.workspaceId !== undefined ? { workspaceId: parsed.workspaceId } : {}),
        ...(parsed.depth !== undefined ? { depth: parsed.depth } : {}),
      });
      if (parsed.sessionId) {
        const completedEvent = {
          type: "review.completed",
          sessionId: parsed.sessionId,
          review,
        } as const;
        recordAgentEvent(completedEvent);
        getSenderWindow(event).webContents.send(IPC_CHANNELS.agentEvent, completedEvent);
      }
      return review;
    } catch (error) {
      if (parsed.sessionId) {
        const failedEvent = {
          type: "review.failed",
          sessionId: parsed.sessionId,
          reviewId: "pending",
          message: error instanceof Error ? error.message : String(error),
        } as const;
        recordAgentEvent(failedEvent);
        getSenderWindow(event).webContents.send(IPC_CHANNELS.agentEvent, failedEvent);
      }
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.reviewList, (event, cwd: string) => {
    assertTrustedSender(event);
    return listAgentReviews(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.reviewList));
  });

  ipcMain.handle(IPC_CHANNELS.checkpointList, (event, sessionId: string) => {
    assertTrustedSender(event);
    return listCheckpoints(parseIpcInput(sessionIdSchema, sessionId, IPC_CHANNELS.checkpointList));
  });

  ipcMain.handle(IPC_CHANNELS.checkpointRestore, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(checkpointRestoreSchema, input, IPC_CHANNELS.checkpointRestore);
    const checkpoint = await restoreCheckpoint(parsed.checkpointId);
    const restoredEvent = {
      type: "checkpoint.restored",
      sessionId: checkpoint.sessionId,
      checkpointId: checkpoint.id,
    } as const;
    recordAgentEvent(restoredEvent);
    getSenderWindow(event).webContents.send(IPC_CHANNELS.agentEvent, restoredEvent);
    return checkpoint;
  });

  ipcMain.handle(IPC_CHANNELS.mcpList, (event) => {
    assertTrustedSender(event);
    return listMcpServers();
  });

  ipcMain.handle(IPC_CHANNELS.mcpSync, async (event, cwd: string) => {
    assertTrustedSender(event);
    return await syncWorkspaceMcp(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.mcpSync));
  });

  ipcMain.handle(IPC_CHANNELS.mcpOpenConfig, async (event, cwd: string) => {
    assertTrustedSender(event);
    const path = ensureMcpConfigFile(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.mcpOpenConfig));
    await shell.openPath(path);
    return path;
  });

  ipcMain.handle(IPC_CHANNELS.mcpUpsert, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(mcpUpsertSchema, input, IPC_CHANNELS.mcpUpsert);
    const { cwd, ...server } = parsed;
    return await upsertMcpServer(cwd, server);
  });

  ipcMain.handle(IPC_CHANNELS.mcpDelete, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(mcpServerNameSchema, input, IPC_CHANNELS.mcpDelete);
    return await deleteMcpServer(parsed.cwd, parsed.name);
  });

  ipcMain.handle(IPC_CHANNELS.mcpSetEnabled, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(mcpSetEnabledSchema, input, IPC_CHANNELS.mcpSetEnabled);
    return await setMcpServerEnabled(parsed.cwd, parsed.name, parsed.enabled);
  });

  ipcMain.handle(IPC_CHANNELS.mcpEntry, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(mcpServerNameSchema, input, IPC_CHANNELS.mcpEntry);
    return getMcpServerEntry(parsed.cwd, parsed.name);
  });

  ipcMain.handle(IPC_CHANNELS.personalizationGet, (event) => {
    assertTrustedSender(event);
    return getPersonalization();
  });

  ipcMain.handle(IPC_CHANNELS.personalizationSave, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(
      personalizationSaveSchema,
      input,
      IPC_CHANNELS.personalizationSave,
    );
    return savePersonalization(parsed.content);
  });

  ipcMain.handle(IPC_CHANNELS.personalizationOpen, async (event) => {
    assertTrustedSender(event);
    const path = ensurePersonalizationFile();
    await shell.openPath(path);
    return path;
  });

  // Detected project rule files (AGENTS.md / CLAUDE.md / .cursorrules /
  // .cursor/rules/*.mdc) with their apply mode, for the Settings panel.
  ipcMain.handle(IPC_CHANNELS.rulesList, (event, cwd: string) => {
    assertTrustedSender(event);
    return listRuleFiles(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.rulesList));
  });

  ipcMain.handle(IPC_CHANNELS.skillsList, (event, cwd: string) => {
    assertTrustedSender(event);
    return listSkills(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.skillsList));
  });

  ipcMain.handle(IPC_CHANNELS.skillsGet, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(skillsGetSchema, input, IPC_CHANNELS.skillsGet);
    return getSkill(parsed.cwd, parsed.path);
  });

  ipcMain.handle(IPC_CHANNELS.skillsCreate, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(skillsCreateSchema, input, IPC_CHANNELS.skillsCreate);
    return createSkill(parsed);
  });

  ipcMain.handle(IPC_CHANNELS.skillsOpenDir, async (event, cwd: string) => {
    assertTrustedSender(event);
    const dir = ensureSkillsDir(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.skillsOpenDir));
    await shell.openPath(dir);
    return dir;
  });

  ipcMain.handle(IPC_CHANNELS.subagentsList, (event, cwd: string) => {
    assertTrustedSender(event);
    return listSubagents(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.subagentsList));
  });

  ipcMain.handle(IPC_CHANNELS.subagentsGet, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(subagentsGetSchema, input, IPC_CHANNELS.subagentsGet);
    return getSubagent(parsed.cwd, parsed.path);
  });

  ipcMain.handle(IPC_CHANNELS.subagentsCreate, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(subagentsCreateSchema, input, IPC_CHANNELS.subagentsCreate);
    const { model, tools, disallowedTools, isolation, ...rest } = parsed;
    return createSubagent({
      ...rest,
      ...(model !== undefined ? { model } : {}),
      ...(tools !== undefined ? { tools } : {}),
      ...(disallowedTools !== undefined ? { disallowedTools } : {}),
      ...(isolation !== undefined ? { isolation } : {}),
    });
  });

  ipcMain.handle(IPC_CHANNELS.subagentsUpdate, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(subagentsUpdateSchema, input, IPC_CHANNELS.subagentsUpdate);
    const { model, tools, disallowedTools, isolation, ...rest } = parsed;
    return updateSubagent({
      ...rest,
      ...(model !== undefined ? { model } : {}),
      ...(tools !== undefined ? { tools } : {}),
      ...(disallowedTools !== undefined ? { disallowedTools } : {}),
      ...(isolation !== undefined ? { isolation } : {}),
    });
  });

  ipcMain.handle(IPC_CHANNELS.subagentsDelete, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(subagentsDeleteSchema, input, IPC_CHANNELS.subagentsDelete);
    return deleteSubagent(parsed.cwd, parsed.path);
  });

  ipcMain.handle(IPC_CHANNELS.subagentsOpenDir, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(subagentsOpenDirSchema, input, IPC_CHANNELS.subagentsOpenDir);
    const dir = ensureSubagentsDir(parsed.cwd, parsed.scope);
    await shell.openPath(dir);
    return dir;
  });

  ipcMain.handle(IPC_CHANNELS.modelList, (event) => {
    assertTrustedSender(event);
    return listModels();
  });

  ipcMain.handle(IPC_CHANNELS.modelSetDefault, (event, model: string) => {
    assertTrustedSender(event);
    setDefaultModel(parseIpcInput(sessionIdSchema, model, IPC_CHANNELS.modelSetDefault));
  });

  ipcMain.handle(IPC_CHANNELS.modelSettings, (event) => {
    assertTrustedSender(event);
    return getModelSettings();
  });

  ipcMain.handle(IPC_CHANNELS.modelProviderDetail, (event, provider: string) => {
    assertTrustedSender(event);
    return getProviderDetail(
      parseIpcInput(sessionIdSchema, provider, IPC_CHANNELS.modelProviderDetail),
    );
  });

  ipcMain.handle(IPC_CHANNELS.modelCustomProviderConfig, (event, provider: string) => {
    assertTrustedSender(event);
    return getCustomProviderConfig(
      parseIpcInput(sessionIdSchema, provider, IPC_CHANNELS.modelCustomProviderConfig),
    );
  });

  ipcMain.handle(IPC_CHANNELS.modelDeleteCustomProvider, (event, provider: string) => {
    assertTrustedSender(event);
    deleteCustomProvider(
      parseIpcInput(sessionIdSchema, provider, IPC_CHANNELS.modelDeleteCustomProvider),
    );
  });

  ipcMain.handle(IPC_CHANNELS.modelConfigureProvider, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(
      configureProviderSchema,
      input,
      IPC_CHANNELS.modelConfigureProvider,
    );
    return await configureProvider(parsed);
  });

  ipcMain.handle(IPC_CHANNELS.modelUpsertCustomProvider, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(
      upsertCustomProviderSchema,
      input,
      IPC_CHANNELS.modelUpsertCustomProvider,
    );
    return await upsertCustomProvider(parsed);
  });

  ipcMain.handle(IPC_CHANNELS.modelTestCustomProvider, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(
      testCustomProviderSchema,
      input,
      IPC_CHANNELS.modelTestCustomProvider,
    );
    return await testCustomProvider(parsed);
  });

  ipcMain.handle(IPC_CHANNELS.modelUpdateConfig, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(updateModelConfigSchema, input, IPC_CHANNELS.modelUpdateConfig);
    return updateModelConfig(parsed);
  });

  // 自绘 titlebar 的窗口控制 IPC —— 走 sender-validated 通道，不暴露原始 ipcRenderer
  ipcMain.handle(IPC_CHANNELS.windowMinimize, (event) => {
    assertTrustedSender(event);
    getSenderWindow(event).minimize();
  });

  ipcMain.handle(IPC_CHANNELS.windowToggleMaximize, (event) => {
    assertTrustedSender(event);
    const window = getSenderWindow(event);
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  });

  ipcMain.handle(IPC_CHANNELS.windowClose, (event) => {
    assertTrustedSender(event);
    denyPendingPermissionRequests("Window closed");
    denyPendingQuestionRequests();
    getSenderWindow(event).close();
  });

  ipcMain.handle(IPC_CHANNELS.windowState, (event) => {
    assertTrustedSender(event);
    const window = getSenderWindow(event);
    return { maximized: window.isMaximized() };
  });
}
