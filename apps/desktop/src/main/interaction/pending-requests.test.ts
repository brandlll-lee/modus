import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PendingRequestRegistry } from "./pending-requests";

type Ctx = { value: string };

describe("PendingRequestRegistry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function open(registry: PendingRequestRegistry<string, Ctx>, id: string, sessionId?: string) {
    return registry.open({
      id,
      ...(sessionId !== undefined ? { sessionId } : {}),
      context: { value: id },
      timeoutMs: 1_000,
      onTimeout: (context) => `timeout:${context.value}`,
    });
  }

  it("settles a pending request with the built result", async () => {
    const registry = new PendingRequestRegistry<string, Ctx>();
    const pending = open(registry, "a");
    const returned = registry.settle("a", (context) => `done:${context.value}`);
    expect(returned).toBe("done:a");
    await expect(pending).resolves.toBe("done:a");
  });

  it("returns undefined when settling an unknown id and does not throw", () => {
    const registry = new PendingRequestRegistry<string, Ctx>();
    expect(registry.settle("missing", () => "x")).toBeUndefined();
  });

  it("falls back to onTimeout when nobody settles in time", async () => {
    const registry = new PendingRequestRegistry<string, Ctx>();
    const pending = open(registry, "a");
    vi.advanceTimersByTime(1_000);
    await expect(pending).resolves.toBe("timeout:a");
  });

  it("cancelAll resolves every pending request", async () => {
    const registry = new PendingRequestRegistry<string, Ctx>();
    const first = open(registry, "a");
    const second = open(registry, "b");
    registry.cancelAll((context) => `cancelled:${context.value}`);
    await expect(first).resolves.toBe("cancelled:a");
    await expect(second).resolves.toBe("cancelled:b");
  });

  it("cancelForSession only resolves requests of that session", async () => {
    const registry = new PendingRequestRegistry<string, Ctx>();
    const mine = open(registry, "a", "session-1");
    const other = open(registry, "b", "session-2");
    registry.cancelForSession("session-1", (context) => `cancelled:${context.value}`);
    await expect(mine).resolves.toBe("cancelled:a");
    // The other session's request is still pending; its timeout still fires.
    registry.settle("b", () => "kept");
    await expect(other).resolves.toBe("kept");
  });

  it("a settled request no longer times out", async () => {
    const registry = new PendingRequestRegistry<string, Ctx>();
    const pending = open(registry, "a");
    registry.settle("a", () => "done");
    vi.advanceTimersByTime(5_000);
    await expect(pending).resolves.toBe("done");
  });
});
