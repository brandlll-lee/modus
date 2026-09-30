import { expect, it, vi } from "vitest";
import { getMcpLocations, getMcpStatus, revealMcpConfig } from "./mcp-service";

const mocks = vi.hoisted(() => ({
  session: { settingsManager: { isProjectTrusted: () => false }, getAllTools: () => [] },
  invoke: vi.fn(async () => "native report"),
  open: vi.fn(),
}));
vi.mock("electron", () => ({ shell: { openExternal: vi.fn(), openPath: mocks.open } }));
vi.mock("../agent/extension-ui", () => ({ invokeExtensionCommand: mocks.invoke }));
vi.mock("../agent/session-resources", () => ({
  sessionResources: () => [
    { id: "selected", cwd: "workspace", session: mocks.session },
    { id: "other", cwd: "workspace", session: {} },
  ],
  reloadSessionResources: vi.fn(),
}));
vi.mock("./mcp-config", () => ({
  mcpConfigPaths: () => [],
  loadWorkspaceMcpConfig: () => ({ servers: [], errors: [] }),
}));
it("reads only the selected session and preserves native reports", async () => {
  expect(await getMcpStatus("selected")).toEqual([
    { sessionId: "selected", report: "native report" },
  ]);
  expect(mocks.invoke).toHaveBeenCalledWith(mocks.session, "mcp");
  expect(await getMcpStatus("closed")).toEqual([]);
  expect(getMcpLocations("closed")).toEqual([]);
});
it("rejects locations that are not configuration sources", async () => {
  await expect(revealMcpConfig("selected", "unrelated")).rejects.toThrow("not available");
  expect(mocks.open).not.toHaveBeenCalled();
});
