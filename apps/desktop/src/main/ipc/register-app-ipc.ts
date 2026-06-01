import { app, BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import { abortPiSession, createPiRpcSession, promptPiSession } from "../agent/pi-rpc-service";
import {
  createWorktree,
  deleteWorktree,
  listChanges,
  listWorktrees,
  readDiff,
  revertFile,
} from "../git/git-service";
import { listPermissionDecisions, recordPermissionDecision } from "../permissions/permission-store";
import {
  createTerminal,
  killTerminal,
  resizeTerminal,
  writeTerminal,
} from "../terminal/terminal-service";
import { getRecentWorkspaces, openWorkspace } from "../workspace/workspace-service";
import { IPC_CHANNELS } from "./channels";

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

  ipcMain.handle(IPC_CHANNELS.agentCreate, (event, input) => {
    assertTrustedSender(event);
    return createPiRpcSession(getSenderWindow(event), input);
  });

  ipcMain.handle(IPC_CHANNELS.agentPrompt, (event, input) => {
    assertTrustedSender(event);
    promptPiSession(input.sessionId, input.message);
  });

  ipcMain.handle(IPC_CHANNELS.agentAbort, (event, sessionId: string) => {
    assertTrustedSender(event);
    abortPiSession(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.terminalCreate, (event, input) => {
    assertTrustedSender(event);
    return createTerminal(getSenderWindow(event), input);
  });

  ipcMain.handle(IPC_CHANNELS.terminalWrite, (event, input) => {
    assertTrustedSender(event);
    writeTerminal(input.terminalId, input.data);
  });

  ipcMain.handle(IPC_CHANNELS.terminalResize, (event, input) => {
    assertTrustedSender(event);
    resizeTerminal(input.terminalId, input.cols, input.rows);
  });

  ipcMain.handle(IPC_CHANNELS.terminalKill, (event, terminalId: string) => {
    assertTrustedSender(event);
    killTerminal(terminalId);
  });

  ipcMain.handle(IPC_CHANNELS.diffList, async (event, cwd: string) => {
    assertTrustedSender(event);
    return await listChanges(cwd);
  });

  ipcMain.handle(IPC_CHANNELS.diffRead, async (event, input) => {
    assertTrustedSender(event);
    return await readDiff(input.cwd, input.path);
  });

  ipcMain.handle(IPC_CHANNELS.diffRevert, async (event, input) => {
    assertTrustedSender(event);
    await revertFile(input.cwd, input.path);
  });

  ipcMain.handle(IPC_CHANNELS.permissionDecide, (event, input) => {
    assertTrustedSender(event);
    return recordPermissionDecision(input.action, input.target, input.decision);
  });

  ipcMain.handle(IPC_CHANNELS.permissionList, (event) => {
    assertTrustedSender(event);
    return listPermissionDecisions();
  });

  ipcMain.handle(IPC_CHANNELS.worktreeList, async (event, cwd: string) => {
    assertTrustedSender(event);
    return await listWorktrees(cwd);
  });

  ipcMain.handle(IPC_CHANNELS.worktreeCreate, async (event, input) => {
    assertTrustedSender(event);
    return await createWorktree(input.cwd, input.taskId);
  });

  ipcMain.handle(IPC_CHANNELS.worktreeDelete, async (event, input) => {
    assertTrustedSender(event);
    await deleteWorktree(input.cwd, input.path);
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
    getSenderWindow(event).close();
  });

  ipcMain.handle(IPC_CHANNELS.windowState, (event) => {
    assertTrustedSender(event);
    const window = getSenderWindow(event);
    return { maximized: window.isMaximized() };
  });
}
