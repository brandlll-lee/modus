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
    list: () => ipcRenderer.invoke("agent:list"),
    listEvents: (sessionId) => ipcRenderer.invoke("agent:list-events", sessionId),
    prompt: (input) => ipcRenderer.invoke("agent:prompt", input),
    abort: (sessionId) => ipcRenderer.invoke("agent:abort", sessionId),
    setModel: (input) => ipcRenderer.invoke("agent:set-model", input),
    cycleModel: (input) => ipcRenderer.invoke("agent:cycle-model", input),
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
    list: () => ipcRenderer.invoke("terminal:list"),
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
  context: {
    search: (input) => ipcRenderer.invoke("context:search", input),
    resolve: (input) => ipcRenderer.invoke("context:resolve", input),
  },
  docs: {
    list: (workspaceId) => ipcRenderer.invoke("docs:list", workspaceId),
    add: (input) => ipcRenderer.invoke("docs:add", input),
    search: (input) => ipcRenderer.invoke("docs:search", input),
  },
  model: {
    list: () => ipcRenderer.invoke("model:list"),
    setDefault: (model) => ipcRenderer.invoke("model:set-default", model),
  },
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize") as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize") as Promise<void>,
    close: () => ipcRenderer.invoke("window:close") as Promise<void>,
    getState: () => ipcRenderer.invoke("window:state") as Promise<{ maximized: boolean }>,
    onStateChange: (callback) => {
      const listener = (_event: IpcRendererEvent, payload: unknown) =>
        callback(payload as { maximized: boolean });
      ipcRenderer.on("window:state-event", listener);
      return () => ipcRenderer.removeListener("window:state-event", listener);
    },
  },
};

contextBridge.exposeInMainWorld("modus", api);
