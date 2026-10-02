import { type BrowserWindow as BrowserWindowType, shell } from "electron";
import type { BrowserBounds, BrowserTabInfo } from "../../shared/contracts";
import { normalizeBrowserUrl } from "./security";
import {
  closeTab,
  createTab,
  getTab,
  listTabs,
  resolveTab,
  selectTab,
  type TabTarget,
  updateTabInfo,
  workspaceActiveTab,
} from "./tab-store";
import { hideView, setViewBounds, showView } from "./view-host";

export type { TabTarget as BrowserOpTarget };
export { normalizeBrowserUrl };

/* ── Tab management (IPC layer) ───────────────────────────────────────── */

export function listBrowserTabs(workspaceId?: string): BrowserTabInfo[] {
  return listTabs(workspaceId);
}

export function createBrowserTab(
  window: BrowserWindowType | undefined,
  input: { workspaceId: string; url?: string; select?: boolean },
): BrowserTabInfo {
  return createTab(window, input);
}

export function selectBrowserTab(
  window: BrowserWindowType | undefined,
  tabId: string,
): BrowserTabInfo {
  return selectTab(window, tabId);
}

export function closeBrowserTab(tabId: string): void {
  closeTab(tabId);
}

export async function navigateBrowser(input: {
  window?: BrowserWindowType;
  workspaceId?: string;
  tabId?: string;
  url: string;
  newTab?: boolean;
}): Promise<BrowserTabInfo> {
  const url = normalizeBrowserUrl(input.url);
  const shouldCreateTab = input.newTab || !input.tabId;
  let info: BrowserTabInfo;
  if (shouldCreateTab) {
    const workspaceId =
      input.workspaceId ??
      (input.tabId ? resolveTab({ tabId: input.tabId }).workspaceId : undefined);
    if (!workspaceId) {
      throw new Error("workspaceId is required to create a browser tab.");
    }
    info = createTab(input.window, { workspaceId, select: true });
  } else {
    const tabId = input.tabId;
    if (!tabId) {
      throw new Error("tabId is required to navigate an existing browser tab.");
    }
    info = selectTab(input.window, tabId);
  }
  const tab = resolveTab({ tabId: info.id });

  await tab.view.webContents.loadURL(url);
  return updateTabInfo(tab);
}

export function navigateBrowserBack(target: TabTarget = {}): BrowserTabInfo {
  const tab = resolveTab(target);
  if (tab.view.webContents.navigationHistory.canGoBack()) {
    tab.view.webContents.navigationHistory.goBack();
  }
  return updateTabInfo(tab);
}

export function navigateBrowserForward(target: TabTarget = {}): BrowserTabInfo {
  const tab = resolveTab(target);
  if (tab.view.webContents.navigationHistory.canGoForward()) {
    tab.view.webContents.navigationHistory.goForward();
  }
  return updateTabInfo(tab);
}

export function reloadBrowser(target: TabTarget = {}): BrowserTabInfo {
  const tab = resolveTab(target);
  tab.view.webContents.reload();
  return updateTabInfo(tab);
}

export function showBrowserTab(
  window: BrowserWindowType,
  tabId: string,
  bounds: BrowserBounds,
): void {
  const tab = resolveTab({ tabId });
  showView(tab, window, bounds);
  updateTabInfo(tab);
}

export function setBrowserBounds(tabId: string, bounds: BrowserBounds): void {
  const tab = resolveTab({ tabId });
  setViewBounds(tab, bounds);
}

export function hideBrowserTab(tabId: string): void {
  const tab = getTab(tabId);
  if (tab) {
    hideView(tab);
  }
}

export function toggleBrowserDevtools(tabId: string): BrowserTabInfo {
  const tab = resolveTab({ tabId });
  if (tab.view.webContents.isDevToolsOpened()) {
    tab.view.webContents.closeDevTools();
  } else {
    tab.view.webContents.openDevTools({ mode: "right" });
  }
  return updateTabInfo(tab);
}

export async function openBrowserExternal(tabId: string): Promise<void> {
  const tab = resolveTab({ tabId });
  const url = tab.view.webContents.getURL();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Only http(s) browser pages can be opened externally.");
  }
  await shell.openExternal(url);
}

/* ── Find in page (UI find bar) ───────────────────────────────────────── */

export function findInBrowserPage(
  tabId: string,
  query: string,
  options: { forward?: boolean; findNext?: boolean; matchCase?: boolean } = {},
): void {
  const tab = resolveTab({ tabId });
  tab.view.webContents.findInPage(query, {
    forward: options.forward ?? true,
    findNext: options.findNext ?? false,
    matchCase: options.matchCase ?? false,
  });
}

export function stopFindInBrowserPage(
  tabId: string,
  action: "clearSelection" | "keepSelection" | "activateSelection" = "clearSelection",
): void {
  const tab = getTab(tabId);
  tab?.view.webContents.stopFindInPage(action);
}
