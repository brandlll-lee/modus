import { writeFile } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import {
  app,
  BrowserWindow,
  type BrowserWindow as BrowserWindowType,
  clipboard,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  nativeImage,
  shell,
} from "electron";
import type { DiffReview } from "../../shared/contracts";
import { listAgentEvents } from "../agent/agent-history";
import { listAgentRuns } from "../agent/agent-run-store";
import {
  discoverAgentSessions,
  listAgentSessions,
  setAgentSessionPinned,
} from "../agent/agent-store";
import { previewEdits } from "../agent/file-preview";
import {
  getModelSettings,
  getProviderDetail,
  listModels,
  revealProviderConfig,
  setDefaultModel,
  setModelThinking,
} from "../agent/model-service";
import { getAgentRuntime } from "../agent/runtime-registry";
import { removeAgentSession } from "../agent/session-lifecycle";
import { onSessionResourcesChanged, sessionResources } from "../agent/session-resources";
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
  showBrowserTab,
  stopFindInBrowserPage,
  toggleBrowserDevtools,
} from "../browser/browser-service";
import { listDirectory, readWorkspaceFile, writeWorkspaceFile } from "../files/files-service";
import { emitFilesEvent, unwatchWorkspace, watchWorkspace } from "../files/files-watcher";
import { readImagePreview, readWorkspacePreview } from "../files/preview-kind";
import { preparePromptImage } from "../files/prompt-image";
import {
  checkoutBranch,
  commitOrPush,
  discardUnstagedFile,
  getStatusSummary,
  getWorkingChangeStats,
  initRepository,
  isGitRepository,
  listBranches,
  listCommitLog,
  readDiff,
  readFilePatch,
  reviewChanges,
  stageFile,
  unstageFile,
} from "../git/git-service";
import { emitGitEvent, unwatchRepo, watchRepo } from "../git/git-watcher";
import {
  denyPendingQuestionRequests,
  resolveQuestionRequest,
} from "../interaction/question-broker";
import {
  getMcpCommands,
  getMcpLocations,
  getMcpStatus,
  revealMcpConfig,
  runMcpCommand,
} from "../mcp/mcp-service";
import { listSkills, revealSkill } from "../skills/skills-service";
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
  agentNavigateSchema,
  agentPromptSchema,
  agentSetModelSchema,
  agentSetThinkingSchema,
  browserBoundsSchema,
  browserCreateTabSchema,
  browserFindSchema,
  browserFindStopSchema,
  browserNavigateSchema,
  browserRecentSchema,
  browserTabSchema,
  browserWorkspaceSchema,
  clipboardWriteImageSchema,
  cwdSchema,
  dialogSaveImageSchema,
  diffCommitOrPushSchema,
  diffFilePatchSchema,
  diffPathSchema,
  diffReadSchema,
  diffReviewSchema,
  fileOpenSchema,
  filesListSchema,
  filesReadSchema,
  filesWriteSchema,
  gitCheckoutSchema,
  gitLogSchema,
  mcpCommandSchema,
  parseIpcInput,
  previewReadSchema,
  promptImageAttachmentSchema,
  questionRespondSchema,
  resourceLocationSchema,
  sessionIdSchema,
  sessionPinSchema,
  setModelThinkingSchema,
  startupMetricSchema,
  terminalCreateSchema,
  terminalResizeSchema,
  terminalWriteSchema,
  workspaceIdSchema,
  workspacePinSchema,
  workspaceRenameSchema,
} from "./schemas";

const reviewControllers = new Map<number, AbortController>();

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

  ipcMain.handle(IPC_CHANNELS.workspaceList, async (event) => {
    assertTrustedSender(event);
    await discoverAgentSessions();
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
    });
  });

  ipcMain.handle(IPC_CHANNELS.agentList, async (event) => {
    assertTrustedSender(event);
    await discoverAgentSessions();
    return listAgentSessions().map((info) => {
      const native = sessionResources().find(({ id }) => id === info.id)?.session;
      return native?.model
        ? {
            ...info,
            model: `${native.model.provider}/${native.model.id}`,
            thinkingLevel: native.thinkingLevel,
          }
        : info;
    });
  });

  ipcMain.handle(IPC_CHANNELS.agentCommands, async (event, input) => {
    assertTrustedSender(event);
    const sessionId = parseIpcInput(sessionIdSchema, input, IPC_CHANNELS.agentCommands);
    const runtime = getAgentRuntime();
    await runtime.ensure(getSenderWindow(event), sessionId);
    const resource = sessionResources().find((item) => item.id === sessionId);
    if (!resource) throw new Error("Session resources are not loaded.");
    return [
      ...(resource.session.extensionRunner?.getRegisteredCommands() ?? []).map((command) => ({
        name: command.name,
        description: command.description ?? "",
      })),
      ...resource.session.promptTemplates.map((template) => ({
        name: template.name,
        description: template.description,
      })),
    ];
  });

  ipcMain.handle(IPC_CHANNELS.agentPreviewEdits, (event, input: unknown) => {
    assertTrustedSender(event);
    return previewEdits(input);
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

  ipcMain.handle(IPC_CHANNELS.agentReleaseRuntime, async (event, sessionId: string) => {
    assertTrustedSender(event);
    await getAgentRuntime().releaseRuntime(
      parseIpcInput(sessionIdSchema, sessionId, IPC_CHANNELS.agentReleaseRuntime),
    );
  });

  ipcMain.handle(IPC_CHANNELS.agentPrompt, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(agentPromptSchema, input, IPC_CHANNELS.agentPrompt);
    await getAgentRuntime().prompt(getSenderWindow(event), {
      sessionId: parsed.sessionId,
      message: parsed.message,
      paths: parsed.paths ?? [],
      ...(parsed.delivery !== undefined ? { delivery: parsed.delivery } : {}),
      ...(parsed.userMessageId !== undefined ? { userMessageId: parsed.userMessageId } : {}),
      ...(parsed.attachments !== undefined ? { attachments: parsed.attachments } : {}),
      ...(parsed.skills !== undefined ? { skills: parsed.skills } : {}),

      ...(parsed.thinkingLevel !== undefined ? { thinkingLevel: parsed.thinkingLevel } : {}),
      ...(parsed.thinkingVariant !== undefined ? { thinkingVariant: parsed.thinkingVariant } : {}),
    });
  });

  ipcMain.handle(IPC_CHANNELS.agentCompact, async (event, sessionId: string) => {
    assertTrustedSender(event);
    await getAgentRuntime().compact(
      getSenderWindow(event),
      parseIpcInput(sessionIdSchema, sessionId, IPC_CHANNELS.agentCompact),
    );
  });

  ipcMain.handle(IPC_CHANNELS.agentAbort, async (event, sessionId: string) => {
    assertTrustedSender(event);
    return await getAgentRuntime().abort(
      parseIpcInput(sessionIdSchema, sessionId, IPC_CHANNELS.agentAbort),
    );
  });

  // Cursor-style "edit & resend": rewind conversation + workspace files to
  // just before a user message. The renderer refetches events afterwards and
  // re-prompts with the edited text, so no event is emitted here.
  ipcMain.handle(IPC_CHANNELS.agentNavigate, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(agentNavigateSchema, input, IPC_CHANNELS.agentNavigate);
    return await getAgentRuntime().navigate(
      getSenderWindow(event),
      parsed.sessionId,
      parsed.userMessageId,
    );
  });

  ipcMain.handle(IPC_CHANNELS.agentPin, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(sessionPinSchema, input, IPC_CHANNELS.agentPin);
    return setAgentSessionPinned(parsed.id, parsed.pinned);
  });

  ipcMain.handle(IPC_CHANNELS.agentDelete, async (event, sessionId: string) => {
    assertTrustedSender(event);
    const id = parseIpcInput(sessionIdSchema, sessionId, IPC_CHANNELS.agentDelete);
    return await removeAgentSession(id);
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

  ipcMain.handle(IPC_CHANNELS.agentSetThinking, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(agentSetThinkingSchema, input, IPC_CHANNELS.agentSetThinking);
    return await getAgentRuntime().setThinking(
      getSenderWindow(event),
      parsed.sessionId,
      parsed.thinkingVariant,
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

  // Observer fan-out: when any registry reports a process created/exited/killed,
  // push a coarse no-payload signal to every window. The renderer re-reads the
  // session-scoped snapshot, so a single signal drives both the composer bar and
  // the terminal panel without per-window bookkeeping here.

  onSessionResourcesChanged((cwd) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.resourcesChanged, cwd);
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

  ipcMain.handle(IPC_CHANNELS.diffReview, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(diffReviewSchema, input, IPC_CHANNELS.diffReview);

    const senderId = event.sender.id;
    reviewControllers.get(senderId)?.abort();
    const controller = new AbortController();
    reviewControllers.set(senderId, controller);
    try {
      const review = await reviewChanges(parsed.cwd, parsed.target, controller.signal);
      if (controller.signal.aborted) return { state: "superseded" } satisfies DiffReview;
      return review;
    } catch (cause) {
      if (controller.signal.aborted) return { state: "superseded" } satisfies DiffReview;
      throw cause;
    } finally {
      if (reviewControllers.get(senderId) === controller) reviewControllers.delete(senderId);
    }
  });

  ipcMain.handle(IPC_CHANNELS.diffRead, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(diffReadSchema, input, IPC_CHANNELS.diffRead);
    return await readDiff(parsed.cwd, parsed.path, parsed.mode);
  });

  ipcMain.handle(IPC_CHANNELS.diffFilePatch, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(diffFilePatchSchema, input, IPC_CHANNELS.diffFilePatch);

    return await readFilePatch(parsed.cwd, parsed.path, parsed.target, {
      originalPath: parsed.originalPath,
      untracked: parsed.untracked,
      ignoreWhitespace: parsed.ignoreWhitespace,
    });
  });

  ipcMain.handle(IPC_CHANNELS.diffStage, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(diffPathSchema, input, IPC_CHANNELS.diffStage);
    await stageFile(parsed.cwd, parsed.path);
  });

  ipcMain.handle(IPC_CHANNELS.diffUnstage, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(diffPathSchema, input, IPC_CHANNELS.diffUnstage);
    await unstageFile(parsed.cwd, parsed.path);
  });

  ipcMain.handle(IPC_CHANNELS.diffDiscardUnstaged, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(diffPathSchema, input, IPC_CHANNELS.diffDiscardUnstaged);
    await discardUnstagedFile(parsed.cwd, parsed.path);
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

  ipcMain.handle(IPC_CHANNELS.diffCommitOrPush, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(diffCommitOrPushSchema, input, IPC_CHANNELS.diffCommitOrPush);
    return await commitOrPush(parsed.cwd, {
      ...(parsed.message !== undefined ? { message: parsed.message } : {}),
      commit: parsed.commit,
      push: parsed.push,
      ...(parsed.includeUnstaged !== undefined ? { includeUnstaged: parsed.includeUnstaged } : {}),
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

  ipcMain.handle(IPC_CHANNELS.filesWrite, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(filesWriteSchema, input, IPC_CHANNELS.filesWrite);
    const result = writeWorkspaceFile(parsed.cwd, parsed.path, parsed.content);
    emitGitEvent({ cwd: parsed.cwd, kind: "working" });
    emitFilesEvent({ cwd: resolve(parsed.cwd), paths: [result.path] });
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.filesWatch, (event, cwd: string) => {
    assertTrustedSender(event);
    return watchWorkspace(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.filesWatch));
  });

  ipcMain.handle(IPC_CHANNELS.filesUnwatch, (event, cwd: string) => {
    assertTrustedSender(event);
    unwatchWorkspace(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.filesUnwatch));
  });

  ipcMain.handle(IPC_CHANNELS.previewRead, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(previewReadSchema, input, IPC_CHANNELS.previewRead);
    return readWorkspacePreview(parsed.cwd, parsed.path);
  });

  ipcMain.handle(IPC_CHANNELS.fileReadImage, (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(previewReadSchema, input, IPC_CHANNELS.fileReadImage);
    return readImagePreview(parsed.cwd, parsed.path);
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

  ipcMain.handle(IPC_CHANNELS.mcpLocations, (event, sessionId: string) => {
    assertTrustedSender(event);
    return getMcpLocations(parseIpcInput(sessionIdSchema, sessionId, IPC_CHANNELS.mcpLocations));
  });

  ipcMain.handle(IPC_CHANNELS.mcpStatus, async (event, sessionId: string) => {
    assertTrustedSender(event);
    const id = parseIpcInput(sessionIdSchema, sessionId, IPC_CHANNELS.mcpStatus);
    await getAgentRuntime().ensure(getSenderWindow(event), id);
    return getMcpStatus(id);
  });

  ipcMain.handle(IPC_CHANNELS.mcpCommands, async (event, sessionId: string) => {
    assertTrustedSender(event);
    const id = parseIpcInput(sessionIdSchema, sessionId, IPC_CHANNELS.mcpCommands);
    await getAgentRuntime().ensure(getSenderWindow(event), id);
    return getMcpCommands(id);
  });

  ipcMain.handle(
    IPC_CHANNELS.mcpRunCommand,
    async (event, input: { sessionId: string; name: string; args: string }) => {
      assertTrustedSender(event);
      const parsed = parseIpcInput(mcpCommandSchema, input, IPC_CHANNELS.mcpRunCommand);
      await getAgentRuntime().ensure(getSenderWindow(event), parsed.sessionId);
      return runMcpCommand(parsed.sessionId, parsed.name, parsed.args);
    },
  );

  ipcMain.handle(IPC_CHANNELS.mcpOpenConfig, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(resourceLocationSchema, input, IPC_CHANNELS.mcpOpenConfig);
    await revealMcpConfig(parsed.sessionId, parsed.path);
  });

  ipcMain.handle(IPC_CHANNELS.skillsList, async (event, sessionId: string) => {
    assertTrustedSender(event);
    const id = parseIpcInput(sessionIdSchema, sessionId, IPC_CHANNELS.skillsList);
    await getAgentRuntime().ensure(getSenderWindow(event), id);
    return listSkills(id);
  });

  ipcMain.handle(IPC_CHANNELS.skillsOpenDir, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(resourceLocationSchema, input, IPC_CHANNELS.skillsOpenDir);
    await revealSkill(parsed.sessionId, parsed.path);
  });

  ipcMain.handle(IPC_CHANNELS.modelList, (event) => {
    assertTrustedSender(event);
    return listModels();
  });

  ipcMain.handle(IPC_CHANNELS.modelSetDefault, (event, model: string) => {
    assertTrustedSender(event);
    return setDefaultModel(parseIpcInput(sessionIdSchema, model, IPC_CHANNELS.modelSetDefault));
  });

  ipcMain.handle(IPC_CHANNELS.modelSettings, (event) => {
    assertTrustedSender(event);
    return getModelSettings();
  });

  ipcMain.handle(IPC_CHANNELS.appReloadConfiguration, async (event) => {
    assertTrustedSender(event);
    const state = await getAgentRuntime().reloadConfiguration();
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed() && window.webContents !== event.sender)
        window.webContents.send(IPC_CHANNELS.modelCatalogChanged);
    return state;
  });

  ipcMain.handle(IPC_CHANNELS.modelProviderDetail, (event, provider: string) => {
    assertTrustedSender(event);
    return getProviderDetail(
      parseIpcInput(sessionIdSchema, provider, IPC_CHANNELS.modelProviderDetail),
    );
  });

  ipcMain.handle(IPC_CHANNELS.modelOpenConfig, (event, provider: string) => {
    assertTrustedSender(event);
    return revealProviderConfig(
      parseIpcInput(sessionIdSchema, provider, IPC_CHANNELS.modelOpenConfig),
    );
  });

  ipcMain.handle(IPC_CHANNELS.modelSetThinking, (event, input) => {
    assertTrustedSender(event);
    return setModelThinking(
      parseIpcInput(setModelThinkingSchema, input, IPC_CHANNELS.modelSetThinking),
    );
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
    denyPendingQuestionRequests();
    getSenderWindow(event).close();
  });

  ipcMain.handle(IPC_CHANNELS.windowState, (event) => {
    assertTrustedSender(event);
    const window = getSenderWindow(event);
    return { maximized: window.isMaximized() };
  });

  ipcMain.handle(IPC_CHANNELS.filePrepareImage, (event, input) => {
    assertTrustedSender(event);
    const image = parseIpcInput(
      promptImageAttachmentSchema,
      { ...input, type: "image" },
      IPC_CHANNELS.filePrepareImage,
    );
    return preparePromptImage(image);
  });

  ipcMain.handle(IPC_CHANNELS.clipboardWriteImage, (event, input) => {
    assertTrustedSender(event);
    const { png } = parseIpcInput(
      clipboardWriteImageSchema,
      input,
      IPC_CHANNELS.clipboardWriteImage,
    );
    const image = nativeImage.createFromBuffer(Buffer.from(png));
    if (image.isEmpty()) {
      throw new Error("Invalid image data.");
    }
    clipboard.writeImage(image);
  });

  ipcMain.handle(IPC_CHANNELS.dialogSaveImage, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(dialogSaveImageSchema, input, IPC_CHANNELS.dialogSaveImage);
    const result = await dialog.showSaveDialog(getSenderWindow(event), {
      defaultPath: defaultPngName(parsed.defaultName),
      filters: [{ name: "PNG Image", extensions: ["png"] }],
    });
    if (result.canceled || !result.filePath) {
      return { saved: false as const };
    }
    await writeFile(result.filePath, Buffer.from(parsed.png));
    return { saved: true as const, path: result.filePath };
  });
}

function defaultPngName(name: string | undefined): string {
  const base = (name?.trim() || "image")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/[\r\n\t]/g, "_")
    .slice(0, 120);
  return /\.png$/i.test(base) ? base : `${base}.png`;
}
