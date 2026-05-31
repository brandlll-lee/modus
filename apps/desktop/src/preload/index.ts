import type { IpcRendererEvent } from "electron";
import { contextBridge, ipcRenderer } from "electron";
import type { AgentEvent, TerminalEvent } from "../shared/contracts";
import type { ModusApi, SecurityState } from "./types";

const api: ModusApi = {
  app: {
    version: () => ipcRenderer.invoke("app:version") as Promise<string>,
    securityState: () => ipcRenderer.invoke("app:security-state") as Promise<SecurityState>,
  },
  workspace: {
    open: () => ipcRenderer.invoke("workspace:open"),
    list: () => ipcRenderer.invoke("workspace:list"),
  },
  agent: {
    create: (input) => ipcRenderer.invoke("agent:create", input),
    prompt: (input) => ipcRenderer.invoke("agent:prompt", input),
    abort: (sessionId) => ipcRenderer.invoke("agent:abort", sessionId),
    onEvent: (callback) => {
      const listener = (_event: IpcRendererEvent, payload: unknown) =>
        callback(payload as AgentEvent);
      ipcRenderer.on("agent:event", listener);
      return () => ipcRenderer.removeListener("agent:event", listener);
    },
  },
  terminal: {
    create: (input) => ipcRenderer.invoke("terminal:create", input),
    write: (input) => ipcRenderer.invoke("terminal:write", input),
    resize: (input) => ipcRenderer.invoke("terminal:resize", input),
    kill: (terminalId) => ipcRenderer.invoke("terminal:kill", terminalId),
    onEvent: (callback) => {
      const listener = (_event: IpcRendererEvent, payload: unknown) =>
        callback(payload as TerminalEvent);
      ipcRenderer.on("terminal:event", listener);
      return () => ipcRenderer.removeListener("terminal:event", listener);
    },
  },
  diff: {
    list: (cwd) => ipcRenderer.invoke("diff:list", cwd),
    read: (input) => ipcRenderer.invoke("diff:read", input),
    revert: (input) => ipcRenderer.invoke("diff:revert", input),
  },
  permission: {
    decide: (input) => ipcRenderer.invoke("permission:decide", input),
    list: () => ipcRenderer.invoke("permission:list"),
  },
  worktree: {
    list: (cwd) => ipcRenderer.invoke("worktree:list", cwd),
    create: (input) => ipcRenderer.invoke("worktree:create", input),
    delete: (input) => ipcRenderer.invoke("worktree:delete", input),
  },
};

contextBridge.exposeInMainWorld("modus", api);
