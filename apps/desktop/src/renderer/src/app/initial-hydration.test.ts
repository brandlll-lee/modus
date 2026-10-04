import { describe, expect, it, vi } from "vitest";
import { beginInitialAppHydration, type InitialAppDataSource } from "./initial-hydration";

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
  };
}

describe("beginInitialAppHydration", () => {
  it("starts every independent read once and settles after every result completes", async () => {
    const workspaces = deferred<[]>();
    const sessions = deferred<[]>();
    const modelSettings = deferred<{ providers: []; models: []; errors: [] }>();
    const source = {
      workspace: { list: vi.fn(() => workspaces.promise) },
      agent: { list: vi.fn(() => sessions.promise) },
      model: { settings: vi.fn(() => modelSettings.promise) },
    } satisfies InitialAppDataSource;

    const hydration = beginInitialAppHydration(source);
    let settled = false;
    void hydration.settled.then(() => {
      settled = true;
    });

    expect(source.workspace.list).toHaveBeenCalledOnce();
    expect(source.agent.list).toHaveBeenCalledOnce();
    expect(source.model.settings).toHaveBeenCalledOnce();

    workspaces.resolve([]);
    sessions.resolve([]);
    await Promise.resolve();
    expect(settled).toBe(false);

    modelSettings.resolve({ providers: [], models: [], errors: [] });
    await hydration.settled;
    expect(settled).toBe(true);
  });
});
