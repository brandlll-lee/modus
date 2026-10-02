import { expect, it, vi } from "vitest";
import {
  getMcpCommands,
  getMcpLocations,
  getMcpStatus,
  revealMcpConfig,
  runMcpCommand,
} from "./mcp-service";

const mocks = vi.hoisted(() => ({
  session: {
    settingsManager: { isProjectTrusted: () => false },
    getAllTools: () => [],
    extensionRunner: {
      getCommand: () => ({ sourceInfo: { path: "fixture" } }),
      getRegisteredCommands: () => [
        { invocationName: "mcp", sourceInfo: { path: "fixture" } },
        { invocationName: "fixture-signin", sourceInfo: { path: "fixture" } },
        { invocationName: "unrelated", sourceInfo: { path: "another-extension" } },
      ],
    },
  },
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
}));
vi.mock("../agent/agent-paths", () => ({ getPiCliAgentDir: () => "missing-fixture" }));
vi.mock("../agent/agent-store", () => ({ getAgentSession: () => undefined }));
it("reads only the selected session and preserves native reports", async () => {
  expect(await getMcpStatus("selected")).toEqual([
    { sessionId: "selected", report: "native report" },
  ]);
  expect(mocks.invoke).toHaveBeenCalledWith(mocks.session, "mcp");
  await expect(getMcpStatus("closed")).rejects.toThrow("not loaded");
  expect(getMcpLocations("closed")).toEqual([]);
});
it("shares a concurrent report request and exposes only the active MCP extension commands", async () => {
  mocks.invoke.mockClear();
  await Promise.all([getMcpStatus("selected"), getMcpStatus("selected")]);
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  expect(getMcpCommands("selected").map((command) => command.name)).toEqual([
    "mcp",
    "fixture-signin",
  ]);
  await runMcpCommand("selected", "fixture-signin", "fixture-server");
  expect(mocks.invoke).toHaveBeenCalledWith(mocks.session, "fixture-signin", "fixture-server");
  await expect(runMcpCommand("selected", "unrelated", "")).rejects.toThrow("not available");
});
it("rejects locations that are not configuration sources", async () => {
  await expect(revealMcpConfig("selected", "unrelated")).rejects.toThrow("not available");
  expect(mocks.open).not.toHaveBeenCalled();
});
