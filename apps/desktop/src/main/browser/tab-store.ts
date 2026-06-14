import { randomUUID } from "node:crypto";
import {
  BrowserWindow,
  type BrowserWindow as BrowserWindowType,
  WebContentsView,
  type WebContentsView as WebContentsViewType,
} from "electron";
import type { BrowserConsoleMessage, BrowserEvent, BrowserTabInfo } from "../../shared/contracts";
import { IPC_CHANNELS } from "../ipc/channels";
import { AgentVisualizer } from "./agent-visualizer";
import { DialogController } from "./cdp/lifecycle";
import { NetworkRecorder } from "./cdp/network";
import { captureElementClip } from "./cdp/screenshot";
import { CdpSession } from "./cdp/session";
import { SnapshotStore } from "./cdp/snapshot";
import { DesignModeController } from "./design-mode";
import {
  applySessionSecurity,
  DEFAULT_URL,
  isNavigableUrl,
  normalizeBrowserUrl,
  workspacePartition,
} from "./security";
import { detachView } from "./view-host";

/**
 * Tab lifecycle + state. Each tab owns its WebContentsView and the CDP-backed
 * subsystems (session, network recorder, dialog controller, snapshot refs).
 *
 * Events broadcast to every live window: the previous design pinned events to
 * a single `ownerWindow`, which is why `browser.closed` was lost whenever the
 * view had been detached first.
 */

const MAX_BROWSER_LOGS = 300;

export type BrowserTab = {
  info: BrowserTabInfo;
  view: WebContentsViewType;
  workspaceId: string;
  ownerWindow?: BrowserWindowType;
  attached: boolean;
  cdp: CdpSession;
  network: NetworkRecorder;
  dialogs: DialogController;
  snapshots: SnapshotStore;
  visual: AgentVisualizer;
  /** User-driven "Design Mode" overlay (point-and-select → chat context). */
  design: DesignModeController;
  consoleMessages: BrowserConsoleMessage[];
  profiling: boolean;
};

const tabs = new Map<string, BrowserTab>();
const tabsByWorkspace = new Map<string, string[]>();
const activeTabByWorkspace = new Map<string, string>();

function now(): string {
  return new Date().toISOString();
}

export function emitBrowserEvent(event: BrowserEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.browserEvent, event);
    }
  }
}

function pushCapped<T>(items: T[], item: T, limit = MAX_BROWSER_LOGS): void {
  items.push(item);
  if (items.length > limit) {
    items.splice(0, items.length - limit);
  }
}

function normalizeTitle(title: string, url: string): string {
  return title.trim() || (url === DEFAULT_URL ? "New tab" : url);
}

function toTabInfo(tab: BrowserTab): BrowserTabInfo {
  const webContents = tab.view.webContents;
  const url = webContents.getURL() || tab.info.url || DEFAULT_URL;
  return {
    id: tab.info.id,
    workspaceId: tab.workspaceId,
    url,
    title: normalizeTitle(webContents.getTitle(), url),
    loading: webContents.isLoading(),
    canGoBack: webContents.navigationHistory.canGoBack(),
    canGoForward: webContents.navigationHistory.canGoForward(),
    devtoolsOpen: webContents.isDevToolsOpened(),
    locked: tab.info.locked,
    createdAt: tab.info.createdAt,
    updatedAt: now(),
    ...(tab.info.favicon ? { favicon: tab.info.favicon } : {}),
  };
}

export function updateTabInfo(tab: BrowserTab): BrowserTabInfo {
  tab.info = toTabInfo(tab);
  emitBrowserEvent({ type: "browser.updated", tab: tab.info });
  return tab.info;
}

function tabIdsForWorkspace(workspaceId: string): string[] {
  return tabsByWorkspace.get(workspaceId) ?? [];
}

export type TabTarget = {
  tabId?: string;
  workspaceId?: string;
};

/**
 * Resolve the tab a command targets. Explicit tabId wins; otherwise the
 * workspace's active tab. The bare cross-workspace "most recently active
 * anywhere" fallback only applies when no workspace is known at all, so one
 * workspace's agent can no longer silently drive another workspace's browser.
 */
export function resolveTab(target: TabTarget = {}): BrowserTab {
  if (target.tabId) {
    const tab = tabs.get(target.tabId);
    if (!tab) {
      throw new Error(`Browser tab not found: ${target.tabId}`);
    }
    return tab;
  }
  if (target.workspaceId) {
    const activeId = activeTabByWorkspace.get(target.workspaceId);
    const tab = activeId ? tabs.get(activeId) : undefined;
    if (!tab) {
      throw new Error(
        "No active browser tab in this workspace. Use browser_tabs({action:'new'}) or browser_navigate first.",
      );
    }
    return tab;
  }
  const lastActiveId = [...activeTabByWorkspace.values()].at(-1);
  const tab = lastActiveId ? tabs.get(lastActiveId) : undefined;
  if (!tab) {
    throw new Error("No active browser tab.");
  }
  return tab;
}

export function getTab(tabId: string): BrowserTab | undefined {
  return tabs.get(tabId);
}

export function workspaceActiveTab(workspaceId: string): BrowserTab | undefined {
  const activeId = activeTabByWorkspace.get(workspaceId);
  return activeId ? tabs.get(activeId) : undefined;
}

export function listTabs(workspaceId?: string): BrowserTabInfo[] {
  const ids = workspaceId ? tabIdsForWorkspace(workspaceId) : [...tabs.keys()];
  return ids
    .map((id) => tabs.get(id))
    .filter((tab): tab is BrowserTab => Boolean(tab))
    .map(updateTabInfo);
}

/** Live tab objects for a workspace (agent-control lifecycle fan-out). */
export function tabsForWorkspace(workspaceId: string): BrowserTab[] {
  return tabIdsForWorkspace(workspaceId)
    .map((id) => tabs.get(id))
    .filter((tab): tab is BrowserTab => Boolean(tab));
}

function wireTabEvents(tab: BrowserTab): void {
  const webContents = tab.view.webContents;

  webContents.on("console-message", (event) => {
    pushCapped(tab.consoleMessages, {
      id: randomUUID(),
      tabId: tab.info.id,
      level: event.level,
      text: event.message,
      ...(event.sourceId ? { url: event.sourceId } : {}),
      ...(event.lineNumber > 0 ? { line: event.lineNumber } : {}),
      createdAt: now(),
    });
  });

  webContents.on("did-start-loading", () => updateTabInfo(tab));
  webContents.on("did-stop-loading", () => updateTabInfo(tab));
  webContents.on("did-navigate", () => {
    // New document: every outstanding snapshot ref now points at dead nodes.
    tab.snapshots.invalidate();
    updateTabInfo(tab);
  });
  webContents.on("did-navigate-in-page", () => updateTabInfo(tab));
  webContents.on("page-title-updated", () => updateTabInfo(tab));
  webContents.on("devtools-opened", () => updateTabInfo(tab));
  webContents.on("devtools-closed", () => updateTabInfo(tab));
  webContents.on("page-favicon-updated", (_event, favicons) => {
    const favicon = favicons.at(0);
    tab.info = { ...tab.info, ...(favicon ? { favicon } : {}) };
    updateTabInfo(tab);
  });
  webContents.on("found-in-page", (_event, result) => {
    emitBrowserEvent({
      type: "browser.find-result",
      workspaceId: tab.workspaceId,
      tabId: tab.info.id,
      matches: result.matches,
      activeMatchOrdinal: result.activeMatchOrdinal,
      finalUpdate: result.finalUpdate,
    });
  });
  // Browser keyboard shortcuts must work while focus sits inside the page
  // (where the renderer's React handlers can't see keystrokes).
  webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }
    const chord = input.control || input.meta;
    const key = input.key.toLowerCase();

    if (key === "f12") {
      event.preventDefault();
      if (webContents.isDevToolsOpened()) {
        webContents.closeDevTools();
      } else {
        webContents.openDevTools({ mode: "right" });
      }
      return;
    }
    if (key === "f5" || (chord && key === "r")) {
      event.preventDefault();
      webContents.reload();
      return;
    }
    // Ctrl/Cmd+Shift+D toggles Design Mode — captured here so it works while
    // focus is inside the page (the renderer's React handlers can't see it).
    if (chord && input.shift && key === "d") {
      event.preventDefault();
      emitBrowserEvent({
        type: "browser.shortcut",
        workspaceId: tab.workspaceId,
        tabId: tab.info.id,
        shortcut: "toggle-design",
      });
      return;
    }
    if (!chord) {
      return;
    }
    if (key === "t") {
      event.preventDefault();
      createTab(tab.ownerWindow, { workspaceId: tab.workspaceId, select: true });
    } else if (key === "w") {
      event.preventDefault();
      closeTab(tab.info.id);
    } else if (key === "l") {
      // While Design Mode is on, Ctrl+L means "add the selected element to
      // chat" — let it reach the page overlay instead of hijacking it for the
      // address bar (otherwise the overlay's own Ctrl+L handler never fires).
      if (tab.design.isEnabled) {
        return;
      }
      event.preventDefault();
      emitBrowserEvent({
        type: "browser.shortcut",
        workspaceId: tab.workspaceId,
        tabId: tab.info.id,
        shortcut: "focus-address",
      });
    } else if (key === "f") {
      event.preventDefault();
      emitBrowserEvent({
        type: "browser.shortcut",
        workspaceId: tab.workspaceId,
        tabId: tab.info.id,
        shortcut: "find",
      });
    }
  });
  webContents.setWindowOpenHandler(({ url }) => {
    // Pop-ups open as sibling tabs instead of OS windows; everything outside
    // the protocol allowlist is dropped.
    if (isNavigableUrl(url)) {
      createTab(tab.ownerWindow, { workspaceId: tab.workspaceId, url, select: true });
    }
    return { action: "deny" };
  });
}

export function createTab(
  window: BrowserWindowType | undefined,
  input: { workspaceId: string; url?: string; select?: boolean },
): BrowserTabInfo {
  const id = randomUUID();
  const timestamp = now();
  const url = normalizeBrowserUrl(input.url ?? DEFAULT_URL);
  const view = new WebContentsView({
    webPreferences: {
      partition: workspacePartition(input.workspaceId),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  // Opaque white backing so the page never reveals the window's dark canvas
  // (#131314) along edges before first paint or during resize.
  view.setBackgroundColor("#ffffff");
  applySessionSecurity(view.webContents.session);

  const tab: BrowserTab = {
    info: {
      id,
      workspaceId: input.workspaceId,
      url,
      title: "New tab",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      devtoolsOpen: false,
      locked: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    view,
    workspaceId: input.workspaceId,
    attached: false,
    cdp: new CdpSession(view.webContents),
    network: new NetworkRecorder(id),
    dialogs: new DialogController(),
    snapshots: new SnapshotStore(),
    visual: new AgentVisualizer(view.webContents),
    // Self-referential init: the capture/onSelect closures need `tab`, which is
    // fully constructed by the time a selection fires. Assigned right below.
    design: undefined as unknown as DesignModeController,
    consoleMessages: [],
    profiling: false,
  };

  tab.design = new DesignModeController(view.webContents, {
    tabId: id,
    getUrl: () => tab.view.webContents.getURL(),
    capture: async (rect) => {
      const shot = await captureElementClip(tab.cdp, rect);
      return `data:image/png;base64,${shot.base64}`;
    },
    onSelect: (element) =>
      emitBrowserEvent({
        type: "browser.design-select",
        workspaceId: input.workspaceId,
        tabId: id,
        element,
      }),
  });

  tabs.set(id, tab);
  const workspaceTabs = tabIdsForWorkspace(input.workspaceId);
  workspaceTabs.push(id);
  tabsByWorkspace.set(input.workspaceId, workspaceTabs);

  wireTabEvents(tab);
  tab.network.bind(tab.cdp);
  tab.dialogs.bind(tab.cdp);
  void tab.cdp.attach().catch((error) => {
    console.warn(`[browser] CDP attach failed for tab ${id}:`, error);
  });

  if (window) {
    tab.ownerWindow = window;
  }
  if (input.select !== false) {
    activeTabByWorkspace.set(input.workspaceId, id);
  }
  if (url !== DEFAULT_URL) {
    void view.webContents.loadURL(url).catch(() => {
      // Load errors surface through did-fail-load / tab info; never unhandled.
    });
  }

  emitBrowserEvent({ type: "browser.created", tab: tab.info });
  if (input.select !== false) {
    emitBrowserEvent({ type: "browser.selected", workspaceId: input.workspaceId, tabId: id });
  }
  return tab.info;
}

export function selectTab(window: BrowserWindowType | undefined, tabId: string): BrowserTabInfo {
  const tab = resolveTab({ tabId });
  if (window) {
    tab.ownerWindow = window;
  }
  activeTabByWorkspace.set(tab.workspaceId, tab.info.id);
  emitBrowserEvent({ type: "browser.selected", workspaceId: tab.workspaceId, tabId });
  return updateTabInfo(tab);
}

export function closeTab(tabId: string): void {
  const tab = resolveTab({ tabId });

  detachView(tab);
  tabs.delete(tabId);
  const nextIds = tabIdsForWorkspace(tab.workspaceId).filter((id) => id !== tabId);
  tabsByWorkspace.set(tab.workspaceId, nextIds);

  let nextActiveId: string | undefined;
  if (activeTabByWorkspace.get(tab.workspaceId) === tabId) {
    nextActiveId = nextIds.at(-1);
    if (nextActiveId) {
      activeTabByWorkspace.set(tab.workspaceId, nextActiveId);
    } else {
      activeTabByWorkspace.delete(tab.workspaceId);
    }
  }

  tab.network.dispose();
  tab.dialogs.dispose();
  tab.visual.dispose();
  tab.design.dispose();
  tab.cdp.detach();
  try {
    tab.view.webContents.close();
  } catch {
    // Ignore teardown races.
  }

  emitBrowserEvent({ type: "browser.closed", workspaceId: tab.workspaceId, tabId });
  if (nextActiveId) {
    emitBrowserEvent({
      type: "browser.selected",
      workspaceId: tab.workspaceId,
      tabId: nextActiveId,
    });
  }
}

export function tabConsoleMessages(tab: BrowserTab): BrowserConsoleMessage[] {
  return tab.consoleMessages.slice(-MAX_BROWSER_LOGS);
}
