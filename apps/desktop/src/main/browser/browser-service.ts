import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, type BrowserWindow as BrowserWindowType, shell } from "electron";
import type { BrowserBounds, BrowserTabInfo } from "../../shared/contracts";
import { loadUrlBounded } from "./cdp/lifecycle";
import { captureScreenshot } from "./cdp/screenshot";
import type { RawCdpEvent } from "./cdp/session";
import { captureSnapshot } from "./cdp/snapshot";
import type { DesignThemeTokens } from "./design-overlay";
import { normalizeBrowserUrl } from "./security";
import {
  closeTab,
  createTab,
  emitBrowserEvent,
  getTab,
  listTabs,
  resolveTab,
  selectTab,
  type TabTarget,
  tabsForWorkspace,
  updateTabInfo,
  workspaceActiveTab,
} from "./tab-store";
import { hideView, setViewBounds, showView } from "./view-host";

/**
 * Public facade for the in-app browser. Composes the focused modules
 * (tab-store / view-host / security / cdp/*) behind the stable API consumed by
 * the IPC layer, the agent tool layer, and the context service.
 */

export type { TabTarget as BrowserOpTarget };
export { normalizeBrowserUrl };

const SCREENSHOT_DIR = "browser-screenshots";

/* ── Tab management (IPC layer) ───────────────────────────────────────── */

export function listBrowserTabs(workspaceId?: string): BrowserTabInfo[] {
  return listTabs(workspaceId);
}

export function getActiveBrowserTab(workspaceId: string): BrowserTabInfo | undefined {
  const tab = workspaceActiveTab(workspaceId);
  return tab ? updateTabInfo(tab) : undefined;
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
  /** True for agent-tool navigations: lights the "AI in control" glow. */
  agentInitiated?: boolean;
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
  if (input.agentInitiated) {
    // Agent navigations light the control glow; user address-bar navigations
    // (same code path via IPC) stay visually neutral.
    void tab.visual.engage();
    // Authoritative "the agent is browsing" signal → renderer auto-reveals the
    // browser panel if it isn't already showing.
    emitBrowserEvent({
      type: "browser.agent-activity",
      workspaceId: info.workspaceId,
      tabId: info.id,
    });
  }
  // Bounded so a page that never fires did-finish-load can't hang the agent;
  // ERR_ABORTED (follow-up nav / redirect / our stop) is handled inside.
  await loadUrlBounded(tab.view.webContents, url);
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

/* ── Agent operations (CDP-backed) ────────────────────────────────────── */

/**
 * Drop the "AI in control" visuals (glow + cursor) for every tab of a
 * workspace. Called by the agent runtime when a run finishes, fails, or is
 * cancelled — the visual control session spans the whole run, not one tool.
 */
export function releaseAgentBrowserControl(workspaceId: string): void {
  for (const tab of tabsForWorkspace(workspaceId)) {
    void tab.visual.release();
  }
}

/**
 * Light the "AI in control" visuals (breathing glow + cursor) for the tab a
 * browser tool is about to act on. Called for EVERY agent browser tool — read-
 * only ones (snapshot, screenshot, console…) included — so the presence shows
 * the moment the agent touches the browser and stays until the run releases it.
 * Best-effort: no tab yet (e.g. browser_tabs list before any tab) → no-op.
 */
export function engageAgentBrowser(target: TabTarget = {}): void {
  try {
    const tab = resolveTab(target);
    void tab.visual.engage();
    emitBrowserEvent({
      type: "browser.agent-activity",
      workspaceId: tab.workspaceId,
      tabId: tab.info.id,
    });
  } catch {
    // No resolvable tab yet — nothing to light up.
  }
}

/**
 * Toggle the user-driven Design Mode overlay for a tab (point-and-select →
 * chat context). `theme` carries Modus's resolved light/dark tokens so the
 * in-page overlay matches the app's own look regardless of the page.
 */
export async function setBrowserDesignMode(
  tabId: string,
  enabled: boolean,
  theme?: DesignThemeTokens,
): Promise<BrowserTabInfo> {
  const tab = resolveTab({ tabId });
  await tab.design.setEnabled(enabled, theme);
  emitBrowserEvent({
    type: "browser.design-mode-changed",
    workspaceId: tab.workspaceId,
    tabId,
    enabled,
  });
  return updateTabInfo(tab);
}

export async function sendBrowserCdp(
  target: TabTarget,
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const tab = resolveTab(target);
  await tab.cdp.ensureAttached();
  return tab.cdp.send(method, params, sessionId, signal);
}

export function drainBrowserEvents(target: TabTarget = {}): RawCdpEvent[] {
  return resolveTab(target).cdp.drainEvents();
}

export async function takeBrowserScreenshot(input: {
  target?: TabTarget;
  fullPage?: boolean;
}): Promise<{
  path: string;
  width: number;
  height: number;
  imageWidth?: number;
  imageHeight?: number;
  deviceScaleFactor?: number;
  base64: string;
}> {
  const tab = resolveTab(input.target ?? {});
  // The AI cursor must never appear in what the model sees as "the page".
  const shot = await tab.visual.hideDuring(() =>
    captureScreenshot(tab.cdp, { fullPage: input.fullPage === true }),
  );
  const dir = join(app.getPath("userData"), SCREENSHOT_DIR);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${tab.info.id}-${Date.now()}.png`);
  writeFileSync(filePath, Buffer.from(shot.base64, "base64"));
  return {
    path: filePath,
    width: shot.width,
    height: shot.height,
    ...(shot.imageWidth !== undefined ? { imageWidth: shot.imageWidth } : {}),
    ...(shot.imageHeight !== undefined ? { imageHeight: shot.imageHeight } : {}),
    ...(shot.deviceScaleFactor !== undefined ? { deviceScaleFactor: shot.deviceScaleFactor } : {}),
    base64: shot.base64,
  };
}

export async function takeBrowserSnapshot(input: {
  target?: TabTarget;
  maxLines?: number;
  maxDepth?: number;
}): Promise<{
  text: string;
  refCount: number;
  truncated: boolean;
}> {
  const tab = resolveTab(input.target ?? {});
  const page = {
    url: tab.view.webContents.getURL(),
    title: tab.view.webContents.getTitle(),
  };
  return captureSnapshot(tab.cdp, tab.snapshots, page, {
    ...(input.maxLines !== undefined ? { maxLines: input.maxLines } : {}),
    ...(input.maxDepth !== undefined ? { maxDepth: input.maxDepth } : {}),
  });
}

export async function resizeBrowser(
  target: TabTarget,
  width: number,
  height: number,
): Promise<BrowserTabInfo> {
  const tab = resolveTab(target);
  // Viewport emulation (the Puppeteer/Playwright setViewport mechanism), never
  // setBounds: the native view's geometry belongs to the renderer layout.
  await tab.cdp.ensureAttached();
  await tab.cdp.send("Emulation.setDeviceMetricsOverride", {
    width: Math.max(0, Math.round(width)),
    height: Math.max(0, Math.round(height)),
    deviceScaleFactor: 0,
    mobile: false,
  });
  return updateTabInfo(tab);
}

export function setBrowserLock(target: TabTarget, locked: boolean): BrowserTabInfo {
  const tab = resolveTab(target);
  tab.info = { ...tab.info, locked, updatedAt: new Date().toISOString() };
  emitBrowserEvent({ type: "browser.updated", tab: tab.info });
  return tab.info;
}

/* ── Agent context feed ───────────────────────────────────────────────── */

export function activeBrowserContext(workspaceId: string): string | undefined {
  const tab = workspaceActiveTab(workspaceId);
  if (!tab) {
    return undefined;
  }
  const info = updateTabInfo(tab);
  const consoleSummary = tab.consoleMessages
    .slice(-10)
    .map((entry) => `${entry.level}: ${entry.text}`)
    .join("\n");
  const networkSummary = tab.network
    .list({ failedOnly: true, limit: 20 })
    .map((entry) => `${entry.status ?? "failed"} ${entry.method} ${entry.url}`)
    .join("\n");
  return [
    `Browser tab: ${info.title}`,
    `URL: ${info.url}`,
    consoleSummary ? `Console\n${consoleSummary}` : "",
    networkSummary ? `Network issues\n${networkSummary}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
