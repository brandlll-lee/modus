import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, type BrowserWindow as BrowserWindowType, shell } from "electron";
import type {
  BrowserBounds,
  BrowserConsoleMessage,
  BrowserNetworkRequest,
  BrowserTabInfo,
} from "../../shared/contracts";
import {
  type ClickOptions,
  clickAtPoint,
  dragBetweenPoints,
  fillRef,
  hoverAtPoint,
  type Point,
  pressKeyCombo,
  resolveActionPoint,
  scrollAtPoint,
  selectOptionRef,
  typeText,
} from "./cdp/input";
import {
  type DialogPolicy,
  loadUrlBounded,
  type ObservedDialog,
  settleAfterAction,
  waitForText,
} from "./cdp/lifecycle";
import { captureScreenshot } from "./cdp/screenshot";
import { type CaptureSnapshotOptions, captureSnapshot } from "./cdp/snapshot";
import type { DesignThemeTokens } from "./design-overlay";
import { normalizeBrowserUrl } from "./security";
import {
  type BrowserTab,
  closeTab,
  createTab,
  emitBrowserEvent,
  getTab,
  listTabs,
  resolveTab,
  selectTab,
  type TabTarget,
  tabConsoleMessages,
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
const PROFILE_DIR = "browser-logs";

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
    void resolveTab(target).visual.engage();
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

export type BrowserActionOutcome = {
  tab: BrowserTabInfo;
  /** True when the action triggered a navigation/load. */
  pageChanged: boolean;
  /** Dialogs auto-handled since the action started, if any. */
  dialogs: ObservedDialog[];
};

function dialogsSince(tab: BrowserTab, sinceIso: string): ObservedDialog[] {
  return tab.dialogs.recentDialogs().filter((dialog) => dialog.at >= sinceIso);
}

async function finishAction(tab: BrowserTab, startedAt: string): Promise<BrowserActionOutcome> {
  const pageChanged = await settleAfterAction(tab.view.webContents);
  return {
    tab: updateTabInfo(tab),
    pageChanged,
    dialogs: dialogsSince(tab, startedAt),
  };
}

export async function snapshotBrowser(
  target: TabTarget = {},
  options: CaptureSnapshotOptions = {},
): Promise<{ text: string; refCount: number; truncated: boolean; tab: BrowserTabInfo }> {
  const tab = resolveTab(target);
  const info = updateTabInfo(tab);
  const result = await captureSnapshot(
    tab.cdp,
    tab.snapshots,
    { url: info.url, title: info.title },
    options,
  );
  return { ...result, tab: info };
}

export async function clickBrowserRef(
  target: TabTarget,
  ref: string,
  options: ClickOptions = {},
): Promise<BrowserActionOutcome> {
  const tab = resolveTab(target);
  const startedAt = new Date().toISOString();
  // Resolve first (actionability), let the AI cursor fly to the target, then
  // fire the trusted click exactly where the cursor landed.
  const point = await resolveActionPoint(tab.cdp, tab.snapshots.resolve(ref));
  await tab.visual.actionCue(point, "click");
  await clickAtPoint(tab.cdp, point, options);
  return finishAction(tab, startedAt);
}

export async function clickBrowserXY(
  target: TabTarget,
  x: number,
  y: number,
  options: ClickOptions = {},
): Promise<BrowserActionOutcome> {
  const tab = resolveTab(target);
  const startedAt = new Date().toISOString();
  await tab.visual.actionCue({ x, y }, "click");
  await clickAtPoint(tab.cdp, { x, y }, options);
  return finishAction(tab, startedAt);
}

export async function hoverBrowserRef(
  target: TabTarget,
  ref: string,
): Promise<BrowserActionOutcome> {
  const tab = resolveTab(target);
  const startedAt = new Date().toISOString();
  const point = await resolveActionPoint(tab.cdp, tab.snapshots.resolve(ref), {
    skipHitTestCheck: true,
  });
  await tab.visual.actionCue(point, "hover");
  await hoverAtPoint(tab.cdp, point);
  return finishAction(tab, startedAt);
}

export async function dragBrowserRefs(
  target: TabTarget,
  startRef: string,
  endRef: string,
): Promise<BrowserActionOutcome> {
  const tab = resolveTab(target);
  const startedAt = new Date().toISOString();
  const start = await resolveActionPoint(tab.cdp, tab.snapshots.resolve(startRef), {
    skipHitTestCheck: true,
  });
  const end = await resolveActionPoint(tab.cdp, tab.snapshots.resolve(endRef), {
    skipHitTestCheck: true,
  });
  await tab.visual.actionCue(start, "drag");
  // The cursor glides to the drop point in step with the synthetic drag.
  const glide = tab.visual.glideTo(end);
  await dragBetweenPoints(tab.cdp, start, end);
  await glide;
  return finishAction(tab, startedAt);
}

export async function fillBrowserRef(
  target: TabTarget,
  ref: string,
  value: string,
): Promise<BrowserActionOutcome> {
  const tab = resolveTab(target);
  const startedAt = new Date().toISOString();
  const refTarget = tab.snapshots.resolve(ref);
  const point = await resolveActionPoint(tab.cdp, refTarget, { skipHitTestCheck: true });
  await tab.visual.actionCue(point, "input");
  await fillRef(tab.cdp, refTarget, value);
  return finishAction(tab, startedAt);
}

export async function typeBrowserText(
  target: TabTarget,
  ref: string | undefined,
  text: string,
  options: { submit?: boolean } = {},
): Promise<BrowserActionOutcome> {
  const tab = resolveTab(target);
  const startedAt = new Date().toISOString();
  let sessionId: string | undefined;
  if (ref) {
    const refTarget = tab.snapshots.resolve(ref);
    sessionId = refTarget.sessionId;
    const point = await resolveActionPoint(tab.cdp, refTarget, { skipHitTestCheck: true });
    await tab.visual.actionCue(point, "input");
    await tab.cdp.send("DOM.focus", { backendNodeId: refTarget.backendNodeId }, sessionId);
  } else {
    await tab.visual.engage();
  }
  await typeText(tab.cdp, text, sessionId);
  if (options.submit) {
    await pressKeyCombo(tab.cdp, "Enter", sessionId);
  }
  return finishAction(tab, startedAt);
}

export async function selectBrowserOption(
  target: TabTarget,
  ref: string,
  values: string[],
): Promise<BrowserActionOutcome & { selected: string[] }> {
  const tab = resolveTab(target);
  const startedAt = new Date().toISOString();
  const refTarget = tab.snapshots.resolve(ref);
  const point = await resolveActionPoint(tab.cdp, refTarget, { skipHitTestCheck: true });
  await tab.visual.actionCue(point, "click");
  const selected = await selectOptionRef(tab.cdp, refTarget, values);
  const outcome = await finishAction(tab, startedAt);
  return { ...outcome, selected };
}

export async function pressBrowserKey(
  target: TabTarget,
  key: string,
): Promise<BrowserActionOutcome> {
  const tab = resolveTab(target);
  const startedAt = new Date().toISOString();
  await tab.visual.engage();
  await pressKeyCombo(tab.cdp, key);
  return finishAction(tab, startedAt);
}

export async function scrollBrowser(input: {
  target?: TabTarget;
  ref?: string;
  deltaX?: number;
  deltaY?: number;
}): Promise<BrowserActionOutcome> {
  const tab = resolveTab(input.target ?? {});
  const startedAt = new Date().toISOString();
  const deltaX = input.deltaX ?? 0;
  const deltaY = input.deltaY ?? 600;

  let point: Point;
  if (input.ref) {
    point = await resolveActionPoint(tab.cdp, tab.snapshots.resolve(input.ref), {
      skipHitTestCheck: true,
    });
  } else {
    const metrics = await tab.cdp.send<{
      cssLayoutViewport?: { clientWidth?: number; clientHeight?: number };
    }>("Page.getLayoutMetrics");
    point = {
      x: (metrics.cssLayoutViewport?.clientWidth ?? 800) / 2,
      y: (metrics.cssLayoutViewport?.clientHeight ?? 600) / 2,
    };
  }
  await tab.visual.actionCue(point, "scroll");
  await scrollAtPoint(tab.cdp, point, deltaX, deltaY);
  return finishAction(tab, startedAt);
}

export async function takeBrowserScreenshot(input: {
  target?: TabTarget;
  fullPage?: boolean;
}): Promise<{ path: string; width: number; height: number; base64: string }> {
  const tab = resolveTab(input.target ?? {});
  // The AI cursor must never appear in what the model sees as "the page".
  const shot = await tab.visual.hideDuring(() =>
    captureScreenshot(tab.cdp, { fullPage: input.fullPage === true }),
  );
  const dir = join(app.getPath("userData"), SCREENSHOT_DIR);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${tab.info.id}-${Date.now()}.png`);
  writeFileSync(filePath, Buffer.from(shot.base64, "base64"));
  return { path: filePath, width: shot.width, height: shot.height, base64: shot.base64 };
}

export async function waitForBrowser(input: {
  target?: TabTarget;
  text?: string;
  textGone?: string;
  timeMs?: number;
}): Promise<string> {
  const tab = resolveTab(input.target ?? {});

  if (input.text === undefined && input.textGone === undefined) {
    const timeMs = Math.min(Math.max(input.timeMs ?? 1000, 50), 30_000);
    await new Promise((resolve) => setTimeout(resolve, timeMs));
    return `Waited ${timeMs}ms.`;
  }

  const result = await waitForText(tab.cdp, {
    ...(input.text !== undefined ? { text: input.text } : {}),
    ...(input.textGone !== undefined ? { textGone: input.textGone } : {}),
    ...(input.timeMs !== undefined ? { timeoutMs: input.timeMs } : {}),
  });
  const label = input.text !== undefined ? `text "${input.text}"` : `text "${input.textGone}" gone`;
  if (!result.matched) {
    throw new Error(`Timed out after ${result.elapsedMs}ms waiting for ${label}.`);
  }
  return `Condition met after ${result.elapsedMs}ms: ${label}.`;
}

export function handleBrowserDialog(
  target: TabTarget,
  policy: DialogPolicy,
): { lastDialog?: ObservedDialog } {
  const tab = resolveTab(target);
  tab.dialogs.arm(policy);
  const lastDialog = tab.dialogs.lastDialog;
  return lastDialog ? { lastDialog } : {};
}

export function browserConsoleMessages(
  target: TabTarget = {},
  filter: { level?: BrowserConsoleMessage["level"] } = {},
): BrowserConsoleMessage[] {
  const tab = resolveTab(target);
  const messages = tabConsoleMessages(tab);
  return filter.level ? messages.filter((message) => message.level === filter.level) : messages;
}

export function browserNetworkRequests(
  target: TabTarget = {},
  filter: { urlContains?: string; failedOnly?: boolean; limit?: number } = {},
): BrowserNetworkRequest[] {
  const tab = resolveTab(target);
  return tab.network.list(filter);
}

export function browserNetworkRequestDetail(
  target: TabTarget,
  requestId: string,
): BrowserNetworkRequest {
  const tab = resolveTab(target);
  const entry = tab.network.getById(requestId);
  if (!entry) {
    throw new Error(`Network request not found: ${requestId}. Use browser_network_requests first.`);
  }
  return entry;
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

const MAX_EVALUATE_OUTPUT = 8_000;

export async function evaluateBrowser(target: TabTarget, expression: string): Promise<string> {
  const tab = resolveTab(target);
  await tab.cdp.ensureAttached();
  const result = await tab.cdp.send<{
    result?: { value?: unknown; description?: string; type?: string };
    exceptionDetails?: { exception?: { description?: string }; text?: string };
  }>("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        "Evaluation threw an exception.",
    );
  }
  const value = result.result?.value;
  let rendered: string;
  if (value === undefined) {
    rendered = result.result?.description ?? "undefined";
  } else {
    try {
      rendered = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    } catch {
      rendered = String(value);
    }
  }
  if (rendered.length > MAX_EVALUATE_OUTPUT) {
    rendered = `${rendered.slice(0, MAX_EVALUATE_OUTPUT)}\n… (truncated)`;
  }
  return rendered;
}

export function setBrowserLock(target: TabTarget, locked: boolean): BrowserTabInfo {
  const tab = resolveTab(target);
  tab.info = { ...tab.info, locked, updatedAt: new Date().toISOString() };
  emitBrowserEvent({ type: "browser.updated", tab: tab.info });
  return tab.info;
}

/* ── CPU profiling ────────────────────────────────────────────────────── */

export async function startBrowserProfile(target: TabTarget = {}): Promise<void> {
  const tab = resolveTab(target);
  if (tab.profiling) {
    return;
  }
  await tab.cdp.ensureAttached();
  await tab.cdp.send("Profiler.enable");
  await tab.cdp.send("Profiler.start");
  tab.profiling = true;
}

export async function stopBrowserProfile(
  target: TabTarget = {},
): Promise<{ rawPath: string; summaryPath: string }> {
  const tab = resolveTab(target);
  if (!tab.profiling) {
    throw new Error("Browser profile is not running.");
  }
  const result = await tab.cdp.send<{ profile?: unknown }>("Profiler.stop");
  tab.profiling = false;
  const dir = join(app.getPath("userData"), PROFILE_DIR);
  mkdirSync(dir, { recursive: true });
  const stamp = Date.now();
  const rawPath = join(dir, `${tab.info.id}-${stamp}.cpuprofile`);
  const summaryPath = join(dir, `${tab.info.id}-${stamp}-summary.json`);
  writeFileSync(rawPath, JSON.stringify(result.profile ?? result, null, 2));
  writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        tabId: tab.info.id,
        url: tab.info.url,
        title: tab.info.title,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  return { rawPath, summaryPath };
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
