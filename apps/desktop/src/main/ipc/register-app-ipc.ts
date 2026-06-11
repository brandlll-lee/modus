import { isAbsolute, resolve, sep } from "node:path";
import { app, BrowserWindow, type IpcMainInvokeEvent, ipcMain, shell } from "electron";
import { listAgentEvents, recordAgentEvent } from "../agent/agent-event-store";
import { listAgentRuns } from "../agent/agent-run-store";
import { deleteAgentSession, getAgentSession, listAgentSessions } from "../agent/agent-store";
import {
  deleteSessionCheckpoints,
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
import { resolveContext, searchContext } from "../context/context-service";
import { addDocSource, indexWorkspaceDocs, listDocSources, searchDocs } from "../docs/docs-service";
import {
  applyWorktreeChanges,
  checkoutBranch,
  commitChanges,
  commitOrPush,
  createBranch,
  createWorktree,
  deleteWorktree,
  discardFile,
  fetchAll,
  getStatusSummary,
  getWorkingChangeStats,
  listBranches,
  listChanges,
  listWorktrees,
  pullCurrentBranch,
  readDiff,
  readFileVersions,
  revertFile,
  stageAll,
  stageFile,
  unstageFile,
} from "../git/git-service";
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
  denyPendingPermissionRequestsForSession,
  resolvePermissionRequest,
} from "../permissions/permission-broker";
import { listPermissionDecisions, recordPermissionDecision } from "../permissions/permission-store";
import { listRuleFiles } from "../rules/rules-service";
import { createSkill, ensureSkillsDir, getSkill, listSkills } from "../skills/skills-service";
import {
  createTerminal,
  killTerminal,
  listTerminals,
  removeTerminal,
  resizeTerminal,
  writeTerminal,
} from "../terminal/terminal-service";
import { getRecentWorkspaces, openWorkspace } from "../workspace/workspace-service";
import { IPC_CHANNELS } from "./channels";
import {
  agentCreateSchema,
  agentCycleModelSchema,
  agentPromptSchema,
  agentRollbackSchema,
  agentSetModelSchema,
  checkpointRestoreSchema,
  configureProviderSchema,
  contextResolveSchema,
  contextSearchSchema,
  cwdSchema,
  diffCommitOrPushSchema,
  diffCommitSchema,
  diffFileVersionsSchema,
  diffPathSchema,
  diffReadSchema,
  docsAddSchema,
  docsSearchSchema,
  fileOpenSchema,
  gitCheckoutSchema,
  gitCreateBranchSchema,
  mcpServerNameSchema,
  mcpSetEnabledSchema,
  mcpUpsertSchema,
  parseIpcInput,
  permissionDecideSchema,
  reviewStartSchema,
  sessionIdSchema,
  skillsCreateSchema,
  skillsGetSchema,
  terminalCreateSchema,
  terminalResizeSchema,
  terminalWriteSchema,
  testCustomProviderSchema,
  updateModelConfigSchema,
  upsertCustomProviderSchema,
  worktreeCreateSchema,
  worktreeDeleteSchema,
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

function getSenderWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);

  if (!window) {
    throw new Error("Unable to resolve sender window.");
  }

  return window;
}

export function registerAppIpc(): void {
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

  ipcMain.handle(IPC_CHANNELS.workspaceOpen, async (event) => {
    assertTrustedSender(event);
    return await openWorkspace();
  });

  ipcMain.handle(IPC_CHANNELS.workspaceList, (event) => {
    assertTrustedSender(event);
    return getRecentWorkspaces();
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
      ...(parsed.worktreeMode !== undefined ? { worktreeMode: parsed.worktreeMode } : {}),
    });
  });

  ipcMain.handle(IPC_CHANNELS.agentList, (event) => {
    assertTrustedSender(event);
    return listAgentSessions();
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

  ipcMain.handle(IPC_CHANNELS.agentDelete, async (event, sessionId: string) => {
    assertTrustedSender(event);
    const id = parseIpcInput(sessionIdSchema, sessionId, IPC_CHANNELS.agentDelete);
    // Tear down any live runtime first, then drop the record (events/runs cascade).
    await getAgentRuntime().dispose(id);
    const session = getAgentSession(id);
    if (session) {
      await deleteSessionCheckpoints(id, session.cwd).catch(() => {});
    }
    denyPendingPermissionRequestsForSession(id, "Session archived");
    deleteAgentSession(id);
  });

  ipcMain.handle(IPC_CHANNELS.agentSetModel, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(agentSetModelSchema, input, IPC_CHANNELS.agentSetModel);
    return await getAgentRuntime().setModel(
      getSenderWindow(event),
      parsed.sessionId,
      parsed.model,
      parsed.thinkingLevel,
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
      cwd: parsed.cwd,
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
    return await readFileVersions(parsed.cwd, parsed.path, parsed.mode, parsed.originalPath);
  });

  ipcMain.handle(IPC_CHANNELS.diffRevert, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(diffPathSchema, input, IPC_CHANNELS.diffRevert);
    await revertFile(parsed.cwd, parsed.path);
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

  ipcMain.handle(IPC_CHANNELS.diffDiscard, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(diffPathSchema, input, IPC_CHANNELS.diffDiscard);
    await discardFile(parsed.cwd, parsed.path);
  });

  ipcMain.handle(IPC_CHANNELS.diffCommit, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(diffCommitSchema, input, IPC_CHANNELS.diffCommit);
    return await commitChanges(parsed.cwd, parsed.message);
  });

  ipcMain.handle(IPC_CHANNELS.diffStatus, async (event, cwd: string) => {
    assertTrustedSender(event);
    return await getStatusSummary(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.diffStatus));
  });

  // Working-tree change summary (file list + ± line counts) for the composer
  // changes strip and the worktree apply review.
  ipcMain.handle(IPC_CHANNELS.diffStats, async (event, cwd: string) => {
    assertTrustedSender(event);
    return await getWorkingChangeStats(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.diffStats));
  });

  ipcMain.handle(IPC_CHANNELS.diffStageAll, async (event, cwd: string) => {
    assertTrustedSender(event);
    await stageAll(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.diffStageAll));
  });

  ipcMain.handle(IPC_CHANNELS.diffCommitOrPush, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(diffCommitOrPushSchema, input, IPC_CHANNELS.diffCommitOrPush);
    return await commitOrPush(parsed.cwd, {
      ...(parsed.message !== undefined ? { message: parsed.message } : {}),
      ...(parsed.stageAll !== undefined ? { stageAll: parsed.stageAll } : {}),
      commit: parsed.commit,
      push: parsed.push,
    });
  });

  ipcMain.handle(IPC_CHANNELS.gitBranches, async (event, cwd: string) => {
    assertTrustedSender(event);
    return await listBranches(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.gitBranches));
  });

  ipcMain.handle(IPC_CHANNELS.gitCheckout, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(gitCheckoutSchema, input, IPC_CHANNELS.gitCheckout);
    return { output: await checkoutBranch(parsed.cwd, parsed.name, parsed.remote ?? false) };
  });

  ipcMain.handle(IPC_CHANNELS.gitCreateBranch, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(gitCreateBranchSchema, input, IPC_CHANNELS.gitCreateBranch);
    return { output: await createBranch(parsed.cwd, parsed.name) };
  });

  ipcMain.handle(IPC_CHANNELS.gitPull, async (event, cwd: string) => {
    assertTrustedSender(event);
    return { output: await pullCurrentBranch(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.gitPull)) };
  });

  ipcMain.handle(IPC_CHANNELS.gitFetch, async (event, cwd: string) => {
    assertTrustedSender(event);
    return { output: await fetchAll(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.gitFetch)) };
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

  ipcMain.handle(IPC_CHANNELS.contextSearch, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(contextSearchSchema, input, IPC_CHANNELS.contextSearch);
    if (parsed.kind === "doc" || /^docs?/i.test(parsed.query)) {
      await indexWorkspaceDocs(parsed.workspaceId, parsed.cwd);
    }
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
    return getSkill(parsed.cwd, parsed.id);
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

  ipcMain.handle(IPC_CHANNELS.worktreeList, async (event, cwd: string) => {
    assertTrustedSender(event);
    return await listWorktrees(parseIpcInput(cwdSchema, cwd, IPC_CHANNELS.worktreeList));
  });

  ipcMain.handle(IPC_CHANNELS.worktreeCreate, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(worktreeCreateSchema, input, IPC_CHANNELS.worktreeCreate);
    return await createWorktree(parsed.cwd, parsed.taskId);
  });

  ipcMain.handle(IPC_CHANNELS.worktreeDelete, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(worktreeDeleteSchema, input, IPC_CHANNELS.worktreeDelete);
    await deleteWorktree(parsed.cwd, parsed.path);
  });

  // Cursor "/apply-worktree" equivalent: land a worktree session's changes in
  // the main checkout via a snapshot diff + three-way apply.
  ipcMain.handle(IPC_CHANNELS.worktreeApply, async (event, input) => {
    assertTrustedSender(event);
    const parsed = parseIpcInput(worktreeDeleteSchema, input, IPC_CHANNELS.worktreeApply);
    return await applyWorktreeChanges(parsed.cwd, parsed.path);
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
    getSenderWindow(event).close();
  });

  ipcMain.handle(IPC_CHANNELS.windowState, (event) => {
    assertTrustedSender(event);
    const window = getSenderWindow(event);
    return { maximized: window.isMaximized() };
  });
}
