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
    listRuns: (sessionId) => ipcRenderer.invoke("agent:list-runs", sessionId),
    ensure: (sessionId) => ipcRenderer.invoke("agent:ensure", sessionId),
    prompt: (input) => ipcRenderer.invoke("agent:prompt", input),
    abort: (sessionId) => ipcRenderer.invoke("agent:abort", sessionId),
    delete: (sessionId) => ipcRenderer.invoke("agent:delete", sessionId),
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
    stage: (input) => ipcRenderer.invoke("diff:stage", input),
    unstage: (input) => ipcRenderer.invoke("diff:unstage", input),
    discard: (input) => ipcRenderer.invoke("diff:discard", input),
    commit: (input) => ipcRenderer.invoke("diff:commit", input),
    status: (cwd) => ipcRenderer.invoke("diff:status", cwd),
    stageAll: (cwd) => ipcRenderer.invoke("diff:stage-all", cwd),
    commitOrPush: (input) => ipcRenderer.invoke("diff:commit-or-push", input),
  },
  git: {
    branches: (cwd) => ipcRenderer.invoke("git:branches", cwd),
    checkout: (input) => ipcRenderer.invoke("git:checkout", input),
    createBranch: (input) => ipcRenderer.invoke("git:create-branch", input),
    pull: (cwd) => ipcRenderer.invoke("git:pull", cwd),
    fetch: (cwd) => ipcRenderer.invoke("git:fetch", cwd),
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
    settings: () => ipcRenderer.invoke("model:settings"),
    providerDetail: (provider) => ipcRenderer.invoke("model:provider-detail", provider),
    customProviderConfig: (provider) =>
      ipcRenderer.invoke("model:custom-provider-config", provider),
    deleteCustomProvider: (provider) =>
      ipcRenderer.invoke("model:delete-custom-provider", provider),
    configureProvider: (input) => ipcRenderer.invoke("model:configure-provider", input),
    upsertCustomProvider: (input) => ipcRenderer.invoke("model:upsert-custom-provider", input),
    updateConfig: (input) => ipcRenderer.invoke("model:update-config", input),
  },
  review: {
    start: (input) => ipcRenderer.invoke("review:start", input),
    list: (cwd) => ipcRenderer.invoke("review:list", cwd),
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
