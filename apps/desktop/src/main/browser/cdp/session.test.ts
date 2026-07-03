import type { WebContents } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CdpSession } from "./session";

/** Minimal WebContents whose debugger never answers a command, to prove that
 *  `send` can no longer hang waiting for a lost CDP response. */
function neverAnsweringWebContents(): WebContents {
  const dbg = {
    isAttached: () => true,
    attach: () => undefined,
    detach: () => undefined,
    on: () => undefined,
    sendCommand: () => new Promise(() => {}),
  };
  return { debugger: dbg } as unknown as WebContents;
}

function eventingWebContents(): {
  webContents: WebContents;
  emitMessage: (method: string, params?: Record<string, unknown>, sessionId?: string) => void;
} {
  let attached = false;
  const listeners: Array<(
    event: unknown,
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
  ) => void> = [];
  const dbg = {
    isAttached: () => attached,
    attach: () => {
      attached = true;
    },
    detach: () => {
      attached = false;
    },
    on: (event: string, listener: unknown) => {
      if (event === "message") {
        listeners.push(listener as (typeof listeners)[number]);
      }
    },
    sendCommand: vi.fn(async () => ({})),
  };
  return {
    webContents: { debugger: dbg } as unknown as WebContents,
    emitMessage: (method, params = {}, sessionId) => {
      for (const listener of listeners) {
        listener({}, method, params, sessionId);
      }
    },
  };
}

describe("CdpSession.send bounding", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects a command whose response never arrives instead of hanging forever", async () => {
    vi.useFakeTimers();
    const session = new CdpSession(neverAnsweringWebContents());

    const pending = session.send("Input.dispatchKeyEvent");
    const assertion = expect(pending).rejects.toThrow(/timed out/i);
    // Past the default 25s bound; without the timeout race this never settles.
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it("rejects immediately when handed an already-aborted signal", async () => {
    const session = new CdpSession(neverAnsweringWebContents());
    await expect(
      session.send("Page.captureScreenshot", {}, undefined, AbortSignal.abort()),
    ).rejects.toThrow(/abort/i);
  });

  it("rejects an in-flight command when its abort signal fires (Stop)", async () => {
    const session = new CdpSession(neverAnsweringWebContents());
    const controller = new AbortController();

    const pending = session.send("Page.navigate", {}, undefined, controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow(/abort/i);
  });

  it("drains raw CDP events exactly once", async () => {
    const { webContents, emitMessage } = eventingWebContents();
    const session = new CdpSession(webContents);

    await session.attach();
    emitMessage("Network.requestWillBeSent", { requestId: "1" });
    emitMessage("Page.loadEventFired", {}, "child-session");

    expect(session.drainEvents()).toEqual([
      expect.objectContaining({
        method: "Network.requestWillBeSent",
        params: { requestId: "1" },
      }),
      expect.objectContaining({
        method: "Page.loadEventFired",
        params: {},
        sessionId: "child-session",
      }),
    ]);
    expect(session.drainEvents()).toEqual([]);
  });
});
