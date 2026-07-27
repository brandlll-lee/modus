import type { IpcRendererEvent } from "electron";
import { contextBridge, ipcRenderer } from "electron";
import type { AgentEvent, BrowserEvent, GitChangeEvent, TerminalEvent } from "../shared/contracts";
import type { ModusApi, SecurityState } from "./types";

const api: ModusApi = {
  app: {
    version: () => ipcRenderer.invoke("app:version") as Promise<string>,
    securityState: () => ipcRenderer.invoke("app:security-state") as Promise<SecurityState>,
    startupMetric: (input) => ipcRenderer.invoke("app:startup-metric", input),
  },
  workspace: {
    open: () => ipcRenderer.invoke("workspace:open"),
    list: () => ipcRenderer.invoke("workspace:list"),
    pin: (input) => ipcRenderer.invoke("workspace:pin", input),
    rename: (input) => ipcRenderer.invoke("workspace:rename", input),
    archiveChats: (id) => ipcRenderer.invoke("workspace:archive-chats", { id }),
    deleteChats: (id) => ipcRenderer.invoke("workspace:delete-chats", { id }),
    remove: (id) => ipcRenderer.invoke("workspace:remove", { id }),
    reveal: (id) => ipcRenderer.invoke("workspace:reveal", { id }),
  },
  file: {
    open: (input) => ipcRenderer.invoke("file:open", input),
  },
  agent: {
    create: (input) => ipcRenderer.invoke("agent:create", input),
    list: (input) => ipcRenderer.invoke("agent:list", input),
    listArchived: (workspaceId) => ipcRenderer.invoke("agent:list-archived", workspaceId),
    listEvents: (sessionId) => ipcRenderer.invoke("agent:list-events", sessionId),
    listRuns: (sessionId) => ipcRenderer.invoke("agent:list-runs", sessionId),
    ensure: (sessionId) => ipcRenderer.invoke("agent:ensure", sessionId),
    prompt: (input) => ipcRenderer.invoke("agent:prompt", input),
    abort: (sessionId) => ipcRenderer.invoke("agent:abort", sessionId),
    rollback: (input) => ipcRenderer.invoke("agent:rollback", input),
    pin: (input) => ipcRenderer.invoke("agent:pin", input),
    archive: (sessionId) => ipcRenderer.invoke("agent:archive", sessionId),
    restore: (sessionId) => ipcRenderer.invoke("agent:restore", sessionId),
    delete: (sessionId) => ipcRenderer.invoke("agent:delete", sessionId),
    applySubagentWorktree: (sessionId) =>
      ipcRenderer.invoke("agent:apply-subagent-worktree", sessionId),
    abortSubagentWorktreeApply: (sessionId) =>
      ipcRenderer.invoke("agent:abort-subagent-worktree-apply", sessionId),
    cleanupSubagentWorktree: (sessionId) =>
      ipcRenderer.invoke("agent:cleanup-subagent-worktree", sessionId),
    setModel: (input) => ipcRenderer.invoke("agent:set-model", input),
    cycleModel: (input) => ipcRenderer.invoke("agent:cycle-model", input),
    onEvent: (callback) => {
      const listener = (_event: IpcRendererEvent, payload: unknown) =>
        callback(payload as AgentEvent);
      ipcRenderer.on("agent:event", listener);
      return () => ipcRenderer.removeListener("agent:event", listener);
    },
    onFocusSession: (callback) => {
      const listener = (_event: IpcRendererEvent, payload: unknown) => callback(payload as string);
      ipcRenderer.on("agent:focus-session", listener);
      return () => ipcRenderer.removeListener("agent:focus-session", listener);
    },
  },
  terminal: {
    create: (input) => ipcRenderer.invoke("terminal:create", input),
    write: (input) => ipcRenderer.invoke("terminal:write", input),
    resize: (input) => ipcRenderer.invoke("terminal:resize", input),
    kill: (terminalId) => ipcRenderer.invoke("terminal:kill", terminalId),
    remove: (terminalId) => ipcRenderer.invoke("terminal:remove", terminalId),
    list: () => ipcRenderer.invoke("terminal:list"),
    onEvent: (callback) => {
      const listener = (_event: IpcRendererEvent, payload: unknown) =>
        callback(payload as TerminalEvent);
      ipcRenderer.on("terminal:event", listener);
      return () => ipcRenderer.removeListener("terminal:event", listener);
    },
  },
  process: {
    list: (input) => ipcRenderer.invoke("process:list", input),
    kill: (id) => ipcRenderer.invoke("process:kill", { id }),
    onChanged: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("process:changed", listener);
      return () => ipcRenderer.removeListener("process:changed", listener);
    },
  },
  browser: {
    listTabs: (input) => ipcRenderer.invoke("browser:list-tabs", input),
    createTab: (input) => ipcRenderer.invoke("browser:create-tab", input),
    selectTab: (input) => ipcRenderer.invoke("browser:select-tab", input),
    closeTab: (input) => ipcRenderer.invoke("browser:close-tab", input),
    navigate: (input) => ipcRenderer.invoke("browser:navigate", input),
    back: (input) => ipcRenderer.invoke("browser:back", input),
    forward: (input) => ipcRenderer.invoke("browser:forward", input),
    reload: (input) => ipcRenderer.invoke("browser:reload", input),
    setBounds: (input) => ipcRenderer.invoke("browser:set-bounds", input),
    show: (input) => ipcRenderer.invoke("browser:show", input),
    hide: (input) => ipcRenderer.invoke("browser:hide", input),
    toggleDevtools: (input) => ipcRenderer.invoke("browser:toggle-devtools", input),
    openExternal: (input) => ipcRenderer.invoke("browser:open-external", input),
    setDesignMode: (input) => ipcRenderer.invoke("browser:design-mode", input),
    find: (input) => ipcRenderer.invoke("browser:find", input),
    findStop: (input) => ipcRenderer.invoke("browser:find-stop", input),
    listRecents: (input) => ipcRenderer.invoke("browser:list-recents", input),
    deleteRecent: (input) => ipcRenderer.invoke("browser:delete-recent", input),
    onEvent: (callback) => {
      const listener = (_event: IpcRendererEvent, payload: unknown) =>
        callback(payload as BrowserEvent);
      ipcRenderer.on("browser:event", listener);
      return () => ipcRenderer.removeListener("browser:event", listener);
    },
  },
  diff: {
    review: (input) => ipcRenderer.invoke("diff:review", input),
    read: (input) => ipcRenderer.invoke("diff:read", input),
    filePatch: (input) => ipcRenderer.invoke("diff:file-patch", input),
    stage: (input) => ipcRenderer.invoke("diff:stage", input),
    unstage: (input) => ipcRenderer.invoke("diff:unstage", input),
    discardUnstaged: (input) => ipcRenderer.invoke("diff:discard-unstaged", input),
    status: (cwd) => ipcRenderer.invoke("diff:status", cwd),
    stats: (cwd) => ipcRenderer.invoke("diff:stats", cwd),
    statsSince: (input) => ipcRenderer.invoke("diff:stats-since", input),
    sessionStats: (sessionId) => ipcRenderer.invoke("diff:session-stats", sessionId),
    commitOrPush: (input) => ipcRenderer.invoke("diff:commit-or-push", input),
  },
  files: {
    list: (input) => ipcRenderer.invoke("files:list", input),
    read: (input) => ipcRenderer.invoke("files:read", input),
  },
  git: {
    branches: (cwd) => ipcRenderer.invoke("git:branches", cwd),
    checkout: (input) => ipcRenderer.invoke("git:checkout", input),
    isRepository: (cwd) => ipcRenderer.invoke("git:is-repository", cwd),
    init: (cwd) => ipcRenderer.invoke("git:init", cwd),
    log: (input) => ipcRenderer.invoke("git:log", input),
    watch: (cwd) => ipcRenderer.invoke("git:watch", cwd),
    unwatch: (cwd) => ipcRenderer.invoke("git:unwatch", cwd),
    onChanged: (callback) => {
      const listener = (_event: IpcRendererEvent, payload: unknown) =>
        callback(payload as GitChangeEvent);
      ipcRenderer.on("git:event", listener);
      return () => ipcRenderer.removeListener("git:event", listener);
    },
  },
  permission: {
    decide: (input) => ipcRenderer.invoke("permission:decide", input),
    list: () => ipcRenderer.invoke("permission:list"),
    getMode: (input) => ipcRenderer.invoke("permission:get-mode", input ?? {}),
    setMode: (input) => ipcRenderer.invoke("permission:set-mode", input),
    clearProjectMode: (input) => ipcRenderer.invoke("permission:clear-project-mode", input),
  },
  questions: {
    respond: (input) => ipcRenderer.invoke("questions:respond", input),
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
    refreshCatalog: () => ipcRenderer.invoke("model:refresh-catalog"),
    onCatalogChanged: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("model:catalog-changed", listener);
      return () => ipcRenderer.removeListener("model:catalog-changed", listener);
    },
    providerDetail: (provider) => ipcRenderer.invoke("model:provider-detail", provider),
    connectionMethods: (provider) =>
      ipcRenderer.invoke("model:provider-connection-methods", provider),
    startProviderAuth: (input) => ipcRenderer.invoke("model:provider-auth-start", input),
    providerAuthState: (input) => ipcRenderer.invoke("model:provider-auth-state", input),
    respondProviderAuth: (input) => ipcRenderer.invoke("model:provider-auth-respond", input),
    cancelProviderAuth: (input) => ipcRenderer.invoke("model:provider-auth-cancel", input),
    disconnectProvider: (provider) => ipcRenderer.invoke("model:disconnect-provider", provider),
    customProviderConfig: (provider) =>
      ipcRenderer.invoke("model:custom-provider-config", provider),
    deleteCustomProvider: (provider) =>
      ipcRenderer.invoke("model:delete-custom-provider", provider),
    configureProvider: (input) => ipcRenderer.invoke("model:configure-provider", input),
    upsertCustomProvider: (input) => ipcRenderer.invoke("model:upsert-custom-provider", input),
    testCustomProvider: (input) => ipcRenderer.invoke("model:test-custom-provider", input),
    updateConfig: (input) => ipcRenderer.invoke("model:update-config", input),
  },
  review: {
    start: (input) => ipcRenderer.invoke("review:start", input),
    list: (cwd) => ipcRenderer.invoke("review:list", cwd),
  },
  checkpoint: {
    list: (sessionId) => ipcRenderer.invoke("checkpoint:list", sessionId),
    restore: (input) => ipcRenderer.invoke("checkpoint:restore", input),
  },
  mcp: {
    list: () => ipcRenderer.invoke("mcp:list"),
    sync: (cwd) => ipcRenderer.invoke("mcp:sync", cwd),
    openConfig: (cwd) => ipcRenderer.invoke("mcp:open-config", cwd),
    upsert: (input) => ipcRenderer.invoke("mcp:upsert", input),
    delete: (input) => ipcRenderer.invoke("mcp:delete", input),
    setEnabled: (input) => ipcRenderer.invoke("mcp:set-enabled", input),
    entry: (input) => ipcRenderer.invoke("mcp:entry", input),
  },
  rules: {
    list: (cwd) => ipcRenderer.invoke("rules:list", cwd),
  },
  personalization: {
    get: () => ipcRenderer.invoke("personalization:get"),
    save: (input) => ipcRenderer.invoke("personalization:save", input),
    open: () => ipcRenderer.invoke("personalization:open"),
  },
  skills: {
    list: (cwd) => ipcRenderer.invoke("skills:list", cwd),
    get: (input) => ipcRenderer.invoke("skills:get", input),
    create: (input) => ipcRenderer.invoke("skills:create", input),
    openDir: (cwd) => ipcRenderer.invoke("skills:open-dir", cwd),
  },
  subagents: {
    list: (cwd) => ipcRenderer.invoke("subagents:list", cwd),
    get: (input) => ipcRenderer.invoke("subagents:get", input),
    create: (input) => ipcRenderer.invoke("subagents:create", input),
    update: (input) => ipcRenderer.invoke("subagents:update", input),
    delete: (input) => ipcRenderer.invoke("subagents:delete", input),
    openDir: (input) => ipcRenderer.invoke("subagents:open-dir", input),
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
