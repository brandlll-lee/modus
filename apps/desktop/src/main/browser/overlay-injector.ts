import type { WebContents } from "electron";
import { browserDebugLog } from "./debug";

/**
 * Shared base for page-injected browser overlays (the agent-presence cursor and
 * Design Mode both build on this).
 *
 * Why a base class: both overlays need the exact same hard-won injection
 * plumbing — isolated-world bootstrap (so the page's own JS never sees our
 * globals), browser-privileged `insertCSS` (immune to page CSP), and a
 * self-healing re-assert across navigations / SPA re-renders. Keeping that in
 * one place stops the two overlays from drifting apart and means a fix here
 * (e.g. the SPA `<body>` re-render bug) lands for both at once.
 *
 * Each concrete overlay owns:
 * - a distinct WORLD_ID (so two overlays never collide in one page),
 * - a distinct global accessor name on `window` (set by its bootstrap),
 * - its own CSS + bootstrap script,
 * - a `reassert()` that replays its "active" state after the document changes.
 */
export abstract class OverlayInjector {
  private injected = false;
  protected disposed = false;

  /** Sentinel returned by a `call` probe when the isolated-world global is gone. */
  private static readonly MISSING = "__MODUS_OVERLAY_MISSING__";

  constructor(
    protected readonly webContents: WebContents,
    private readonly worldId: number,
    private readonly globalName: string,
    private readonly css: string,
    private readonly bootstrap: string,
  ) {
    // A full main-frame navigation throws away injected DOM/CSS and the
    // isolated-world global; drop the flag and replay active state.
    webContents.on("did-navigate", () => {
      this.injected = false;
      this.reassert();
    });
    // SPA route changes keep the same document/world (global survives) but often
    // re-render <body> wholesale; the in-page self-heal re-mounts the node, here
    // we just re-assert active state.
    webContents.on("did-navigate-in-page", () => this.reassert());
    // The last moment a document can settle — covers overlays that raced an
    // early did-navigate before the DOM was ready.
    webContents.on("did-finish-load", () => this.reassert());
  }

  protected get gone(): boolean {
    return this.disposed || this.webContents.isDestroyed();
  }

  /** Replay the overlay's active state after the document changed (if engaged). */
  protected abstract reassert(): void;

  private async ensureInjected(): Promise<boolean> {
    if (this.gone) {
      return false;
    }
    if (this.injected) {
      return true;
    }
    try {
      await this.webContents.insertCSS(this.css, { cssOrigin: "user" });
      await this.webContents.executeJavaScriptInIsolatedWorld(this.worldId, [
        { code: this.bootstrap },
      ]);
      this.injected = true;
      return true;
    } catch (error) {
      browserDebugLog("overlay", `inject failed (${this.globalName})`, String(error));
      return false;
    }
  }

  /**
   * Evaluate `code` against the overlay global in the isolated world, returning
   * its result. Self-heals: if the global vanished (a document swap whose
   * navigation event we didn't observe), re-bootstrap onto the current document
   * and land the call once more so commands never silently no-op mid-session.
   */
  protected async call<T = unknown>(code: string): Promise<T | undefined> {
    if (!(await this.ensureInjected())) {
      return undefined;
    }
    const probe = `window.${this.globalName} ? (${code}) : ${JSON.stringify(OverlayInjector.MISSING)}`;
    try {
      let result = await this.webContents.executeJavaScriptInIsolatedWorld(this.worldId, [
        { code: probe },
      ]);
      if (result === OverlayInjector.MISSING) {
        this.injected = false;
        if (await this.ensureInjected()) {
          result = await this.webContents.executeJavaScriptInIsolatedWorld(this.worldId, [
            { code: probe },
          ]);
        }
      }
      return result === OverlayInjector.MISSING ? undefined : (result as T);
    } catch (error) {
      browserDebugLog("overlay", `call failed (${this.globalName})`, String(error));
      return undefined;
    }
  }

  dispose(): void {
    this.disposed = true;
  }
}
