import type { AgentSession, ResourceLoader } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  assertIdle: vi.fn(),
  refresh: vi.fn(async () => undefined),
  getModel: vi.fn(),
}));
vi.mock("./model-service", () => ({
  refreshRemoteModelCatalog: native.refresh,
  getModelRuntime: async () => ({ getModel: native.getModel }),
  getModelSettings: () => ({ models: [], providers: [], errors: [] }),
}));

import {
  assertConfigurationReady,
  onSessionResourcesChanged,
  registerSessionResources,
  releaseSessionResources,
  reloadPiConfiguration as reload,
} from "./session-resources";

const ids: string[] = [];
const reloadPiConfiguration = () => reload({ assertIdle: native.assertIdle });
function register(cwd: string, reload: () => Promise<void>) {
  const id = crypto.randomUUID();
  ids.push(id);
  const session = { reload } as AgentSession;
  registerSessionResources({ id, cwd, loader: {} as ResourceLoader, session });
  return session;
}
beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  for (const id of ids.splice(0)) releaseSessionResources(id);
});

it("refreshes models once and reloads all loaded workspaces in order", async () => {
  const calls: string[] = [];
  native.refresh.mockImplementation(async () => {
    calls.push("models");
  });
  register("workspace-a", async () => {
    calls.push("a");
  });
  register("workspace-b", async () => {
    calls.push("b");
  });
  const changed = vi.fn();
  const unsubscribe = onSessionResourcesChanged(changed);
  try {
    expect((await reloadPiConfiguration()).errors).toEqual([]);
  } finally {
    unsubscribe();
  }
  expect(calls).toEqual(["models", "a", "b"]);
  expect(native.refresh).toHaveBeenCalledOnce();
  expect(changed.mock.calls).toEqual([["workspace-a"], ["workspace-b"]]);
});
it("checks native idle state before changing any configuration", async () => {
  native.assertIdle.mockImplementation(() => {
    throw new Error("native busy");
  });
  const reload = vi.fn();
  register("workspace", reload);
  await expect(reloadPiConfiguration()).rejects.toThrow("native busy");
  expect(native.refresh).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
  expect(assertConfigurationReady).not.toThrow();
});
it("blocks concurrent reload and entry until native reload finishes", async () => {
  let finish!: () => void;
  register(
    "workspace",
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = reloadPiConfiguration();
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(assertConfigurationReady).toThrow("configuration reload");
  await expect(reloadPiConfiguration()).rejects.toThrow("configuration reload");
  finish();
  await pending;
  expect(assertConfigurationReady).not.toThrow();
});
it("reports partial failure, continues other sessions, and releases the reload guard", async () => {
  register("broken", async () => {
    throw new Error("native load failure");
  });
  const reload = vi.fn(async () => undefined);
  register("working", reload);
  const state = await reloadPiConfiguration();
  expect(state.errors.join("\n")).toContain("native load failure");
  expect(reload).toHaveBeenCalledOnce();
  expect(assertConfigurationReady).not.toThrow();
});
it("releases the guard after model refresh fails", async () => {
  native.refresh.mockRejectedValue(new Error("catalog failure"));
  await expect(reloadPiConfiguration()).rejects.toThrow("catalog failure");
  expect(assertConfigurationReady).not.toThrow();
});
it("updates the selected model through PI while keeping its thinking choice", async () => {
  const session = register("workspace", async () => undefined);
  Object.assign(session, {
    model: { provider: "fixture", id: "selected" },
    thinkingLevel: "high",
    setModel: vi.fn(async () => undefined),
    setThinkingLevel: vi.fn(),
  });
  const updated = { provider: "fixture", id: "selected", contextWindow: 200000 };
  native.getModel.mockReturnValue(updated);
  await reloadPiConfiguration();
  expect(native.getModel).toHaveBeenCalledWith("fixture", "selected");
  expect(session.setModel).toHaveBeenCalledWith(updated);
  expect(session.setThinkingLevel).toHaveBeenCalledWith("high");
});
it("refreshes native model settings with no session loaded", async () => {
  expect((await reloadPiConfiguration()).errors).toEqual([]);
  expect(native.refresh).toHaveBeenCalledOnce();
});
