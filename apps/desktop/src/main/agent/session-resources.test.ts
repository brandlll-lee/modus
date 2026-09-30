import type { AgentSession, DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import {
  assertSessionResourcesIdle,
  onSessionResourcesChanged,
  registerSessionResources,
  releaseSessionResources,
  reloadSessionResources,
} from "./session-resources";

const trust = vi.hoisted(() => vi.fn(async () => true));
vi.mock("./project-trust", () => ({ resolveProjectTrust: trust }));
const ids: string[] = [];
function register(cwd: string, reload: () => Promise<void>, streaming = false) {
  const id = crypto.randomUUID();
  ids.push(id);
  const settingsManager = SettingsManager.inMemory({}, { projectTrusted: false });
  registerSessionResources({
    id,
    cwd,
    loader: {} as DefaultResourceLoader,
    session: { settingsManager, isStreaming: streaming, reload } as unknown as AgentSession,
  });
  return settingsManager;
}
afterEach(() => {
  for (const id of ids.splice(0)) releaseSessionResources(id);
  trust.mockClear();
});
it("applies the current project trust decision before native reload and publishes afterward", async () => {
  const reload = vi.fn(async () => {
    expect(settings.isProjectTrusted()).toBe(true);
  });
  const settings = register("workspace", reload);
  const changed = vi.fn();
  const unsubscribe = onSessionResourcesChanged(changed);
  try {
    await reloadSessionResources("workspace");
  } finally {
    unsubscribe();
  }
  expect(reload).toHaveBeenCalledOnce();
  expect(changed).toHaveBeenCalledWith("workspace");
});
it("rejects concurrent refresh and streaming writes without affecting other workspaces", async () => {
  let finish!: () => void;
  register(
    "workspace",
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = reloadSessionResources("workspace");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await expect(reloadSessionResources("workspace")).rejects.toThrow("Wait for the agent");
  expect(() => assertSessionResourcesIdle("another-workspace")).not.toThrow();
  finish();
  await pending;
  expect(() => assertSessionResourcesIdle("workspace")).not.toThrow();
  register("busy", vi.fn(), true);
  await expect(reloadSessionResources("busy")).rejects.toThrow("Wait for the agent");
});
