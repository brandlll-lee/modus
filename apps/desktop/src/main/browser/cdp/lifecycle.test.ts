import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { loadUrlBounded } from "./lifecycle";

type FakeWebContents = {
  loadURL: () => Promise<unknown>;
  stop: () => void;
  isDestroyed: () => boolean;
};

function fakeWebContents(overrides: Partial<FakeWebContents>): WebContents {
  return {
    loadURL: () => new Promise(() => {}),
    stop: () => undefined,
    isDestroyed: () => false,
    ...overrides,
  } as unknown as WebContents;
}

describe("loadUrlBounded", () => {
  it("resolves and stops the load when the page never finishes loading", async () => {
    const stop = vi.fn();
    // loadURL never settles — the bug that hung browser_navigate forever.
    const wc = fakeWebContents({ loadURL: () => new Promise(() => {}), stop });

    await loadUrlBounded(wc, "https://slow.example", 30);

    expect(stop).toHaveBeenCalledOnce();
  });

  it("treats ERR_ABORTED (follow-up navigation) as success", async () => {
    const aborted = Object.assign(new Error("net::ERR_ABORTED"), { errno: -3 });
    const wc = fakeWebContents({ loadURL: () => Promise.reject(aborted) });

    await expect(loadUrlBounded(wc, "https://x.example", 1000)).resolves.toBeUndefined();
  });

  it("propagates real load failures", async () => {
    const failure = Object.assign(new Error("net::ERR_NAME_NOT_RESOLVED"), { errno: -105 });
    const wc = fakeWebContents({ loadURL: () => Promise.reject(failure) });

    await expect(loadUrlBounded(wc, "https://nope.example", 1000)).rejects.toThrow(
      /ERR_NAME_NOT_RESOLVED/,
    );
  });

  it("resolves without stopping when the load finishes in time", async () => {
    const stop = vi.fn();
    const wc = fakeWebContents({ loadURL: () => Promise.resolve(undefined), stop });

    await loadUrlBounded(wc, "https://fast.example", 1000);

    expect(stop).not.toHaveBeenCalled();
  });
});
