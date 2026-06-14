import type { Debugger, WebContents } from "electron";
import { browserDebugLog } from "../debug";

/**
 * Thin owner of a WebContents' Chrome DevTools Protocol connection.
 *
 * Every page interaction in the browser (snapshot, input, screenshot, network,
 * dialogs) flows through a single `debugger.attach`. The session also turns on
 * flat-mode auto-attach so cross-origin (out-of-process) iframes surface as
 * child sessions — that is what lets the agent see and drive content inside
 * iframes (e.g. cookie-consent banners) that a plain `querySelectorAll` in the
 * top document can never reach.
 *
 * Electron's `debugger` already correlates command/response promises for us, so
 * this class only multiplexes the unsolicited *event* stream
 * (`Network.*`, `Page.javascriptDialogOpening`, `Target.attachedToTarget`, …)
 * to registered handlers.
 */

type CdpParams = Record<string, unknown>;

export type CdpEventHandler = (params: CdpParams, sessionId: string | undefined) => void;

const ROOT_DOMAINS = ["Page", "DOM", "Runtime", "Network"] as const;

const IFRAME_AUTO_ATTACH: CdpParams = {
  autoAttach: true,
  waitForDebuggerOnStart: false,
  flatten: true,
  filter: [{ type: "iframe", exclude: false }],
};

function readPositiveEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Upper bound on a single CDP command's response (like Puppeteer's
 * `protocolTimeout` / Codex's in-app-browser 20s `sendCommand` wrapper). Without
 * it, a command whose reply never arrives — the page navigated and the target
 * detached, a tab was discarded, a dialog wedged the renderer — hangs `await`
 * forever and freezes the whole agent run. Env-overridable for heavy pages.
 */
const CDP_COMMAND_TIMEOUT_MS = readPositiveEnv("MODUS_CDP_TIMEOUT_MS", 25_000);
/** Shorter bound for fire-and-forget domain enable / auto-attach bookkeeping. */
const CDP_ENABLE_TIMEOUT_MS = readPositiveEnv("MODUS_CDP_ENABLE_TIMEOUT_MS", 5_000);

function abortError(): Error {
  const error = new Error("CDP command aborted.");
  error.name = "AbortError";
  return error;
}

export class CdpSession {
  private readonly debug: Debugger;
  private attached = false;
  private listenersBound = false;
  private readonly handlers = new Map<string, Set<CdpEventHandler>>();
  /** Child iframe sessionId → its CDP frameId (== targetId for OOPIFs). */
  private readonly childFrames = new Map<string, string>();
  /** Reject callbacks for in-flight commands, so a detach can fail them fast. */
  private readonly inflight = new Set<(error: Error) => void>();

  constructor(webContents: WebContents) {
    this.debug = webContents.debugger;
  }

  get isAttached(): boolean {
    return this.attached && this.debug.isAttached();
  }

  /** Attach (idempotent) and enable the domains the browser tools rely on. */
  async attach(): Promise<void> {
    if (!this.debug.isAttached()) {
      try {
        this.debug.attach("1.3");
      } catch (error) {
        browserDebugLog("cdp", "debugger.attach FAILED", String(error));
        throw error;
      }
    }
    this.attached = true;
    this.bindListeners();
    await this.enableRoot();
    browserDebugLog("cdp", "attached + domains enabled");
  }

  /** Re-attach if the connection was lost (e.g. DevTools stole the protocol). */
  async ensureAttached(): Promise<void> {
    if (!this.isAttached) {
      await this.attach();
    }
  }

  private bindListeners(): void {
    if (this.listenersBound) {
      return;
    }
    this.listenersBound = true;
    this.debug.on("message", (_event, method, params, sessionId) => {
      this.dispatch(method, (params ?? {}) as CdpParams, sessionId || undefined);
    });
    this.debug.on("detach", () => {
      this.attached = false;
      this.childFrames.clear();
      // The connection is gone; fail every pending command now instead of
      // letting each wait out its full timeout. Handlers are kept so the next
      // ensureAttached() re-enables domains without losing subscriptions.
      this.rejectInflight(new Error("CDP debugger detached."));
    });
  }

  private async enableRoot(): Promise<void> {
    for (const domain of ROOT_DOMAINS) {
      await this.trySend(`${domain}.enable`);
    }
    // Accessibility powers the snapshot; enabling once is cheap (the tree is
    // computed lazily on getFullAXTree).
    await this.trySend("Accessibility.enable");
    await this.trySend("Target.setAutoAttach", IFRAME_AUTO_ATTACH);
  }

  private dispatch(method: string, params: CdpParams, sessionId: string | undefined): void {
    if (method === "Target.attachedToTarget") {
      this.onChildAttached(params);
    } else if (method === "Target.detachedFromTarget") {
      const childSessionId = typeof params.sessionId === "string" ? params.sessionId : undefined;
      if (childSessionId) {
        this.childFrames.delete(childSessionId);
      }
    }

    const handlers = this.handlers.get(method);
    if (handlers) {
      for (const handler of handlers) {
        handler(params, sessionId);
      }
    }
  }

  private onChildAttached(params: CdpParams): void {
    const childSessionId = typeof params.sessionId === "string" ? params.sessionId : undefined;
    if (!childSessionId) {
      return;
    }
    const targetInfo = params.targetInfo as { targetId?: string; url?: string } | undefined;
    this.childFrames.set(childSessionId, targetInfo?.targetId ?? "");
    browserDebugLog("cdp", "iframe child session attached", {
      sessionId: childSessionId.slice(0, 12),
      url: targetInfo?.url,
    });
    void this.enableChild(childSessionId);
  }

  private async enableChild(sessionId: string): Promise<void> {
    await this.trySend("Page.enable", {}, sessionId);
    await this.trySend("DOM.enable", {}, sessionId);
    await this.trySend("Accessibility.enable", {}, sessionId);
    // Auto-attach is not recursive, so each child must opt its own grandchildren
    // in for deeply nested cross-origin frames.
    await this.trySend("Target.setAutoAttach", IFRAME_AUTO_ATTACH, sessionId);
  }

  /**
   * Send a command (optionally to a child iframe session) and type the reply.
   * Bounded by {@link CDP_COMMAND_TIMEOUT_MS} and cancellable via `signal`, so a
   * lost response (navigation/target swap, discarded tab, wedged dialog) can
   * never hang the caller. A timeout resets the connection for re-attach.
   */
  async send<T>(
    method: string,
    params: CdpParams = {},
    sessionId?: string,
    signal?: AbortSignal,
  ): Promise<T> {
    return await this.withTimeout<T>(
      method,
      () => this.debug.sendCommand(method, params, sessionId),
      {
        timeoutMs: CDP_COMMAND_TIMEOUT_MS,
        wedgeOnTimeout: true,
        ...(signal ? { signal } : {}),
      },
    );
  }

  /** Best-effort send that swallows failures (used for enable/auto-attach). */
  private async trySend(method: string, params: CdpParams = {}, sessionId?: string): Promise<void> {
    try {
      // Bounded too: e.g. `Network.enable` hangs forever on discarded tabs.
      await this.withTimeout(method, () => this.debug.sendCommand(method, params, sessionId), {
        timeoutMs: CDP_ENABLE_TIMEOUT_MS,
        wedgeOnTimeout: false,
      });
    } catch {
      // Domain may be unsupported on this target, or the session may have
      // detached mid-navigation; non-fatal for bookkeeping commands.
    }
  }

  /**
   * Race a CDP command against a timeout and an optional abort signal. The
   * command's reject callback is registered in {@link inflight} so a detach can
   * settle it immediately. On timeout of a real command we drop the (likely
   * wedged) connection so the next ensureAttached() rebuilds a clean session.
   */
  private withTimeout<T>(
    method: string,
    start: () => Promise<unknown>,
    options: { timeoutMs: number; wedgeOnTimeout: boolean; signal?: AbortSignal },
  ): Promise<T> {
    const { timeoutMs, wedgeOnTimeout, signal } = options;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (run: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.inflight.delete(rejectInflight);
        signal?.removeEventListener("abort", onAbort);
        run();
      };
      const rejectInflight = (error: Error): void => finish(() => reject(error));
      const onAbort = (): void => rejectInflight(abortError());
      const timer = setTimeout(() => {
        if (wedgeOnTimeout) {
          this.markWedged();
        }
        rejectInflight(new Error(`CDP command "${method}" timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      this.inflight.add(rejectInflight);
      if (signal) {
        if (signal.aborted) {
          rejectInflight(abortError());
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      start().then(
        (value) => finish(() => resolve(value as T)),
        (error) => finish(() => reject(error instanceof Error ? error : new Error(String(error)))),
      );
    });
  }

  /** Fail every pending command (detach, dispose, or a wedged timeout). */
  private rejectInflight(error: Error): void {
    if (this.inflight.size === 0) {
      return;
    }
    const pending = [...this.inflight];
    this.inflight.clear();
    for (const reject of pending) {
      reject(error);
    }
  }

  /**
   * A timed-out command means the CDP connection is probably wedged. Drop it
   * (best-effort) so the next ensureAttached() reconnects fresh; the detach
   * event fails any sibling in-flight commands. Subscriptions survive — only the
   * electron debugger is detached, not our handler map.
   */
  private markWedged(): void {
    this.attached = false;
    try {
      if (this.debug.isAttached()) {
        this.debug.detach();
      }
    } catch {
      // Already detached or teardown race — nothing to recover.
    }
  }

  /** Subscribe to a CDP event by method name; returns an unsubscribe fn. */
  on(method: string, handler: CdpEventHandler): () => void {
    let handlers = this.handlers.get(method);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(method, handlers);
    }
    handlers.add(handler);
    return () => {
      this.handlers.get(method)?.delete(handler);
    };
  }

  /** Active child iframe session ids (for per-frame snapshots). */
  childSessionIds(): string[] {
    return [...this.childFrames.keys()];
  }

  /** CDP frameId for a child session, used to locate the owning iframe element. */
  frameIdForSession(sessionId: string): string | undefined {
    const frameId = this.childFrames.get(sessionId);
    return frameId ? frameId : undefined;
  }

  detach(): void {
    try {
      if (this.debug.isAttached()) {
        this.debug.detach();
      }
    } catch {
      // ignore teardown races
    }
    this.attached = false;
    this.rejectInflight(new Error("CDP session disposed."));
    this.handlers.clear();
    this.childFrames.clear();
  }
}
