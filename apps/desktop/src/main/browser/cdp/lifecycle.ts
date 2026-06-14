import type { WebContents } from "electron";
import type { CdpSession } from "./session";

/**
 * Navigation settling and JavaScript dialog handling.
 *
 * Dialogs: a JS `alert()`/`confirm()`/`prompt()` blocks the renderer until it
 * is answered. The old `browser_handle_dialog` only "recorded a policy" that
 * nothing ever read, so any alert hung the page forever. Here
 * `Page.javascriptDialogOpening` is answered immediately using the tab's
 * armed policy (set via browser_handle_dialog), falling back to dismiss, so
 * the page can never deadlock; every dialog is recorded for the agent.
 *
 * Navigation: after a click or form submit the page may start loading; tools
 * wait for the load to settle before returning so the agent never reads the
 * pre-action DOM and reports false success.
 */

export interface DialogPolicy {
  accept: boolean;
  promptText?: string;
}

export interface ObservedDialog {
  type: string;
  message: string;
  handledWith: "policy-accept" | "policy-dismiss" | "default-dismiss" | "auto-accept-unload";
  at: string;
}

export class DialogController {
  private policy: DialogPolicy | undefined;
  private readonly history: ObservedDialog[] = [];
  private unsubscribe: (() => void) | undefined;

  bind(session: CdpSession): void {
    this.unsubscribe = session.on("Page.javascriptDialogOpening", (params, sessionId) => {
      void this.handleDialog(session, params, sessionId);
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** Arm a one-shot policy for the next dialog (browser_handle_dialog). */
  arm(policy: DialogPolicy): void {
    this.policy = policy;
  }

  get lastDialog(): ObservedDialog | undefined {
    return this.history[this.history.length - 1];
  }

  recentDialogs(limit = 5): ObservedDialog[] {
    return this.history.slice(-limit);
  }

  private async handleDialog(
    session: CdpSession,
    params: Record<string, unknown>,
    sessionId: string | undefined,
  ): Promise<void> {
    const type = typeof params.type === "string" ? params.type : "alert";
    const message = typeof params.message === "string" ? params.message : "";
    const armed = this.policy;
    this.policy = undefined;

    // beforeunload prompts would otherwise wedge every navigation; leaving the
    // page is what the agent asked for, so auto-accept those.
    const isUnload = type === "beforeunload";
    const accept = isUnload ? true : (armed?.accept ?? false);

    const reply: Record<string, unknown> = { accept };
    if (armed?.promptText !== undefined && type === "prompt") {
      reply.promptText = armed.promptText;
    }
    try {
      await session.send("Page.handleJavaScriptDialog", reply, sessionId);
    } catch {
      // Dialog may have been handled by a competing client or already closed.
    }

    this.history.push({
      type,
      message,
      handledWith: isUnload
        ? "auto-accept-unload"
        : armed
          ? armed.accept
            ? "policy-accept"
            : "policy-dismiss"
          : "default-dismiss",
      at: new Date().toISOString(),
    });
    if (this.history.length > 20) {
      this.history.splice(0, this.history.length - 20);
    }
  }
}

/* ── Navigation settling ──────────────────────────────────────────────── */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readPositiveEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Chromium net error fired when a load is superseded/stopped — expected. */
const ERR_ABORTED = -3;
/**
 * Hard cap on a single navigation. `webContents.loadURL` only resolves on
 * `did-finish-load`, which heavy SPAs, stalled sub-resources, or redirect loops
 * may never fire — hanging `browser_navigate` forever (and freezing the viewport
 * mid-load). Env-overridable for unusually slow sites.
 */
const NAV_TIMEOUT_MS = readPositiveEnv("MODUS_NAV_TIMEOUT_MS", 30_000);

/**
 * Navigate without ever waiting forever. Races `loadURL` against a timeout; on
 * timeout it `stop()`s the stuck load so the already-committed page stays
 * interactable (loadURL then rejects ERR_ABORTED, treated as success). Real
 * load failures still reject so the caller can report them.
 */
export async function loadUrlBounded(
  webContents: WebContents,
  url: string,
  timeoutMs: number = NAV_TIMEOUT_MS,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let done = false;
    const settle = (run: () => void): void => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      run();
    };
    const timer = setTimeout(() => {
      try {
        if (!webContents.isDestroyed()) {
          webContents.stop();
        }
      } catch {
        // teardown race — nothing to stop
      }
      settle(resolve);
    }, timeoutMs);
    webContents.loadURL(url).then(
      () => settle(resolve),
      (error: unknown) => {
        const code = (error as { errno?: number }).errno;
        if (code === ERR_ABORTED) {
          settle(resolve);
        } else {
          settle(() => reject(error instanceof Error ? error : new Error(String(error))));
        }
      },
    );
  });
}

/**
 * Give the page a beat to react to an action, then — if a navigation/load was
 * triggered — wait for it to finish (bounded). Returns true when a load
 * happened, so tools can tell the agent the page changed.
 */
export async function settleAfterAction(
  webContents: WebContents,
  options: { settleMs?: number; loadTimeoutMs?: number } = {},
): Promise<boolean> {
  const settleMs = options.settleMs ?? 150;
  const loadTimeoutMs = options.loadTimeoutMs ?? 10_000;

  await delay(settleMs);
  if (webContents.isDestroyed() || !webContents.isLoading()) {
    return false;
  }

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      webContents.removeListener("did-stop-loading", finish);
      resolve();
    };
    const timer = setTimeout(finish, loadTimeoutMs);
    webContents.on("did-stop-loading", finish);
  });
  // One more beat for post-load rendering (fonts, hydration kick-off).
  await delay(100);
  return true;
}

/** Poll the page's visible text until `text` appears (or disappears). */
export async function waitForText(
  session: CdpSession,
  options: { text?: string; textGone?: string; timeoutMs?: number },
): Promise<{ matched: boolean; elapsedMs: number }> {
  const timeoutMs = Math.min(options.timeoutMs ?? 10_000, 60_000);
  const started = Date.now();
  const needle = options.text ?? options.textGone ?? "";
  const wantGone = options.textGone !== undefined;

  while (Date.now() - started < timeoutMs) {
    let haystack = "";
    try {
      const result = await session.send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
        expression: 'document.body ? document.body.innerText : ""',
        returnByValue: true,
      });
      haystack = typeof result.result?.value === "string" ? result.result.value : "";
    } catch {
      // Page navigating; treat as not-yet-matched and keep polling.
    }
    const present = haystack.includes(needle);
    if (wantGone ? !present : present) {
      return { matched: true, elapsedMs: Date.now() - started };
    }
    await delay(250);
  }
  return { matched: false, elapsedMs: Date.now() - started };
}
