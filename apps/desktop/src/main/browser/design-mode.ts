import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import type {
  DesignAnnotationPayload,
  DesignElementContentPart,
  DesignElementPart,
  DesignElementPayload,
} from "../../shared/contracts";
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
  /**
   * Capture a screenshot of `rect` as a PNG data URL.
   * `exact: true` keeps the clip flush to the rect (annotation lens);
   * default grows context for element thumbnails.
   */
  capture: (rect: ElementRect, options?: { exact?: boolean }) => Promise<string | undefined>;
  /** Emit a finished selection to the renderer. */
  onSelect: (element: DesignElementPayload, intent: "add" | "submit", seedText?: string) => void;
  onAnnotate: (annotation: DesignAnnotationPayload, intent: "add" | "submit") => void;
};

/** Shape pushed by the page overlay's event queue (see design-overlay.ts). */
type PageSelection = {
  type?: "element";
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
  color?: string;
  elements?: DesignElementPart[];
  contentParts?: DesignElementContentPart[];
  seedText?: string;
};

type PageAnnotation = {
  type: "annotation";
  kind: "add" | "submit";
  annotationKind: "freehand" | "box";
  label: string;
  rect: ElementRect;
  points?: Array<{ x: number; y: number }>;
  color?: string;
  seedText?: string;
  screenshotDataUrl?: string;
};

type PageAnnotationPreview = {
  type: "annotation-preview";
  annotationKind: "freehand" | "box";
  rect: ElementRect;
  inkRect: ElementRect;
  points?: Array<{ x: number; y: number }>;
};

type PageDesignEvent = PageSelection | PageAnnotation | PageAnnotationPreview;

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
      let parsed: PageDesignEvent[];
      try {
        parsed = JSON.parse(json) as PageDesignEvent[];
      } catch {
        return;
      }
      for (const sel of parsed) {
        if (sel.type === "annotation-preview") {
          await this.handleAnnotationPreview(sel);
        } else if (sel.type === "annotation") {
          await this.handleAnnotation(sel);
        } else {
          await this.handleSelection(sel);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  /**
   * Run `capture` under a Design Mode capture mode.
   * - `"page"`: hide all chrome (element thumbnails).
   * - `"ink"`: keep draw strokes so the PNG includes the mark + surrounding pad.
   * When `keepHidden` is true, leave capturing on so the caller can end it in
   * the same paint as `showLens` (avoids ink flash between capture and lens).
   */
  private async withCaptureMode<T>(
    mode: "page" | "ink",
    capture: () => Promise<T>,
    options: { keepHidden?: boolean } = {},
  ): Promise<T> {
    await this.call(`__modusDesignOverlay.setCaptureMode(${JSON.stringify(mode)})`).catch(
      () => undefined,
    );
    try {
      return await capture();
    } finally {
      if (!options.keepHidden) {
        await this.call(`__modusDesignOverlay.setCaptureMode("off")`).catch(() => undefined);
      }
    }
  }

  private async handleSelection(sel: PageSelection): Promise<void> {
    const screenshotDataUrl = await this.withCaptureMode("page", () =>
      this.deps.capture(sel.rect),
    ).catch((error) => {
      browserDebugLog("design", "element capture failed", String(error));
      return undefined;
    });
    await this.call(`__modusDesignOverlay.clearSelection()`).catch(() => undefined);
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
      ...(sel.color ? { color: sel.color } : {}),
      ...(sel.elements && sel.elements.length > 0 ? { elements: sel.elements } : {}),
      ...(sel.contentParts && sel.contentParts.length > 0 ? { contentParts: sel.contentParts } : {}),
      ...(screenshotDataUrl ? { screenshotDataUrl } : {}),
    };
    this.deps.onSelect(element, sel.kind, sel.seedText);
  }

  private async handleAnnotationPreview(sel: PageAnnotationPreview): Promise<void> {
    // Ink mode keeps the mark in the PNG (page + stroke + LENS_PAD surround).
    // keepHidden: showLens clears capturing in the same paint — no ink flash.
    const screenshotDataUrl = await this.withCaptureMode(
      "ink",
      () => this.deps.capture(sel.rect, { exact: true }),
      { keepHidden: true },
    ).catch((error) => {
      browserDebugLog("design", "annotation preview capture failed", String(error));
      return undefined;
    });
    const shown = await this.call(
      `__modusDesignOverlay.showLens(${JSON.stringify({
        dataUrl: screenshotDataUrl,
        lensRect: sel.rect,
        inkRect: sel.inkRect,
        kind: sel.annotationKind,
        points: sel.points,
      })})`,
    ).catch((error) => {
      browserDebugLog("design", "showLens failed", String(error));
      return false;
    });
    if (!shown) {
      await this.call(`__modusDesignOverlay.setCaptureMode("off")`).catch(() => undefined);
    }
  }

  private async handleAnnotation(sel: PageAnnotation): Promise<void> {
    // Prefer the preview bitmap (already includes ink). Fallback re-captures with ink.
    const screenshotDataUrl =
      sel.screenshotDataUrl ??
      (await this.withCaptureMode("ink", () => this.deps.capture(sel.rect, { exact: true })).catch(
        (error) => {
          browserDebugLog("design", "annotation capture failed", String(error));
          return undefined;
        },
      ));
    await this.call(`__modusDesignOverlay.clearSelection()`).catch(() => undefined);
    this.deps.onAnnotate(
      {
        id: randomUUID(),
        tabId: this.deps.tabId,
        url: this.deps.getUrl(),
        label: sel.label,
        kind: sel.annotationKind,
        rect: sel.rect,
        ...(sel.points && sel.points.length > 0 ? { points: sel.points } : {}),
        ...(sel.color ? { color: sel.color } : {}),
        ...(sel.seedText ? { seedText: sel.seedText } : {}),
        ...(screenshotDataUrl ? { screenshotDataUrl } : {}),
      },
      sel.kind,
    );
  }

  override dispose(): void {
    this.stopPolling();
    this.enabled = false;
    super.dispose();
  }
}
