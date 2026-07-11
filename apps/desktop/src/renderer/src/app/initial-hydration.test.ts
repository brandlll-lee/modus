import { describe, expect, it, vi } from "vitest";
import type { SecurityState } from "../../../preload/types";
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
    const securityState = deferred<SecurityState>();
    const workspaces = deferred<[]>();
    const sessions = deferred<[]>();
    const modelSettings = deferred<{ providers: []; models: [] }>();
    const source = {
      app: { securityState: vi.fn(() => securityState.promise) },
      workspace: { list: vi.fn(() => workspaces.promise) },
      agent: { list: vi.fn(() => sessions.promise) },
      model: { settings: vi.fn(() => modelSettings.promise) },
    } satisfies InitialAppDataSource;

    const hydration = beginInitialAppHydration(source);
    let settled = false;
    void hydration.settled.then(() => {
      settled = true;
    });

    expect(source.app.securityState).toHaveBeenCalledOnce();
    expect(source.workspace.list).toHaveBeenCalledOnce();
    expect(source.agent.list).toHaveBeenCalledOnce();
    expect(source.model.settings).toHaveBeenCalledOnce();

    securityState.resolve({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      senderValidation: true,
    });
    workspaces.resolve([]);
    sessions.resolve([]);
    await Promise.resolve();
    expect(settled).toBe(false);

    modelSettings.resolve({ providers: [], models: [] });
    await hydration.settled;
    expect(settled).toBe(true);
  });
});
