import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import type { DesignElementPayload } from "../../shared/contracts";
import { browserDebugLog } from "./debug";
import {
  DESIGN_OVERLAY_BOOTSTRAP,
  DESIGN_OVERLAY_CSS,
  DESIGN_WORLD_ID,
  type DesignThemeTokens,
} from "./design-overlay";
import { OverlayInjector } from "./overlay-injector";

/** Rectangle in root-viewport CSS pixels (matches screenshots + input coords). */
export type ElementRect = { x: number; y: number; width: number; height: number };

/** Wiring the controller needs from the owning tab (no direct CDP/event coupling). */
export type DesignModeDeps = {
  tabId: string;
  /** Current page URL at capture time. */
  getUrl: () => string;
  /** Capture an element-clipped screenshot; returns a PNG data URL (or undefined). */
  capture: (rect: ElementRect) => Promise<string | undefined>;
  /** Emit a finished selection to the renderer (→ chat composer). */
  onSelect: (element: DesignElementPayload) => void;
};

/** Shape pushed by the page overlay's event queue (see design-overlay.ts). */
type PageSelection = {
  kind: "add" | "submit";
  label: string;
  tagName: string;
  componentName?: string;
  source?: { file: string; line: number; column?: number };
  domPath: string;
  text?: string;
  styleSummary?: Record<string, string>;
  attributes?: Record<string, string>;
  ancestors?: Array<{ tag: string; id?: string; classes?: string; role?: string; text?: string }>;
  props?: Record<string, string>;
  rect: ElementRect;
  seedText?: string;
};

const POLL_INTERVAL_MS = 140;

/**
 * Drives the page-injected Design Mode overlay for one tab: enable/disable,
 * theming (so the overlay matches Modus's light/dark tokens), and the polling
 * hand-off that turns a page-side selection into a fully-formed
 * `DesignElementPayload` (identity + source + element screenshot).
 *
 * "User-control" overlay — orthogonal to `AgentVisualizer`'s "agent-control"
 * overlay: distinct world id, distinct global, can coexist on the same tab.
 */
export class DesignModeController extends OverlayInjector {
  private enabled = false;
  private theme: DesignThemeTokens | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private draining = false;

  constructor(
    webContents: WebContents,
    private readonly deps: DesignModeDeps,
  ) {
    super(
      webContents,
      DESIGN_WORLD_ID,
      "__modusDesignOverlay",
      DESIGN_OVERLAY_CSS,
      DESIGN_OVERLAY_BOOTSTRAP,
    );
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** OverlayInjector hook: replay enabled + theme after a navigation/SPA render. */
  protected reassert(): void {
    if (this.enabled) {
      void this.apply();
    }
  }

  async setEnabled(enabled: boolean, theme?: DesignThemeTokens): Promise<void> {
    if (this.gone) {
      return;
    }
    this.enabled = enabled;
    if (theme) {
      this.theme = theme;
    }
    await this.apply();
    if (enabled) {
      this.startPolling();
    } else {
      this.stopPolling();
    }
  }

  /** Push current theme + enabled state into the page overlay. */
  private async apply(): Promise<void> {
    if (this.theme) {
      await this.call(`__modusDesignOverlay.setTheme(${JSON.stringify(this.theme)})`);
    }
    await this.call(`__modusDesignOverlay.setEnabled(${this.enabled ? "true" : "false"})`);
  }

  private startPolling(): void {
    if (this.pollTimer) {
      return;
    }
    this.pollTimer = setInterval(() => void this.drain(), POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  /** Drain queued page selections, enrich each (screenshot), and emit. */
  private async drain(): Promise<void> {
    if (this.draining || this.gone || !this.enabled) {
      return;
    }
    this.draining = true;
    try {
      const json = await this.call<string>(`__modusDesignOverlay.takeEvents()`);
      if (!json || json === "[]") {
        return;
      }
      let parsed: PageSelection[];
      try {
        parsed = JSON.parse(json) as PageSelection[];
      } catch {
        return;
      }
      for (const sel of parsed) {
        await this.handleSelection(sel);
      }
    } finally {
      this.draining = false;
    }
  }

  private async handleSelection(sel: PageSelection): Promise<void> {
    const screenshotDataUrl = await this.deps.capture(sel.rect).catch((error) => {
      browserDebugLog("design", "element capture failed", String(error));
      return undefined;
    });
    const element: DesignElementPayload = {
      id: randomUUID(),
      tabId: this.deps.tabId,
      url: this.deps.getUrl(),
      label: sel.label,
      tagName: sel.tagName,
      ...(sel.componentName ? { componentName: sel.componentName } : {}),
      ...(sel.source ? { source: sel.source } : {}),
      domPath: sel.domPath,
      ...(sel.text ? { text: sel.text } : {}),
      ...(sel.styleSummary ? { styleSummary: sel.styleSummary } : {}),
      ...(sel.attributes ? { attributes: sel.attributes } : {}),
      ...(sel.ancestors && sel.ancestors.length > 0 ? { ancestors: sel.ancestors } : {}),
      ...(sel.props ? { props: sel.props } : {}),
      rect: sel.rect,
      ...(screenshotDataUrl ? { screenshotDataUrl } : {}),
    };
    this.deps.onSelect(element);
  }

  override dispose(): void {
    this.stopPolling();
    this.enabled = false;
    super.dispose();
  }
}
