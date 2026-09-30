import { describe, expect, it, vi } from "vitest";
import { getMcpStatus, runMcpCommand, upsertMcpServer } from "./mcp-service";

const mocks = vi.hoisted(() => ({
  session: {},
  invoke: vi.fn(async () => "native report"),
  write: vi.fn(),
  idle: vi.fn(),
  reload: vi.fn(),
}));
vi.mock("electron", () => ({ shell: { openExternal: vi.fn() } }));
vi.mock("../agent/extension-ui", () => ({ invokeExtensionCommand: mocks.invoke }));
vi.mock("../agent/session-resources", () => ({
  sessionResources: () => [
    { id: "session", cwd: "workspace", session: mocks.session },
    { id: "other", cwd: "other-workspace", session: mocks.session },
  ],
  assertSessionResourcesIdle: mocks.idle,
  reloadSessionResources: mocks.reload,
}));
vi.mock("./mcp-config", () => ({
  loadWorkspaceMcpConfig: () => ({ servers: [], errors: [] }),
  upsertMcpServerEntry: mocks.write,
  findRawMcpEntry: () => undefined,
  userMcpConfigPath: () => "user/mcp.json",
}));

describe("native MCP service", () => {
  it("returns unparsed native reports associated with their session", async () => {
    expect(await getMcpStatus("workspace")).toEqual([
      { sessionId: "session", report: "native report" },
      { sessionId: "other", report: "native report" },
    ]);
    expect(mocks.invoke).toHaveBeenCalledWith(mocks.session, "mcp");
  });
  it("delegates actions to the selected session", async () => {
    expect(
      await runMcpCommand({ sessionId: "session", name: "fixture", action: "reconnect" }),
    ).toBe("native report");
    expect(mocks.invoke).toHaveBeenCalledWith(mocks.session, "mcp", "reconnect fixture");
    await expect(
      runMcpCommand({ sessionId: "closed", name: "fixture", action: "login" }),
    ).rejects.toThrow(/not open/);
  });
  it("checks every open workspace before changing user configuration", async () => {
    mocks.write.mockClear();
    mocks.idle.mockImplementation((cwd: string) => {
      if (cwd === "other-workspace") throw new Error("busy workspace");
    });
    await expect(
      upsertMcpServer("workspace", {
        name: "fixture",
        scope: "user",
        command: "fixture",
        transport: "stdio",
        enabled: true,
      }),
    ).rejects.toThrow("busy workspace");
    expect(mocks.write).not.toHaveBeenCalled();
    mocks.idle.mockReset();
  });
  it("checks streaming before modifying configuration", async () => {
    mocks.write.mockClear();
    mocks.idle.mockImplementationOnce(() => {
      throw new Error("streaming");
    });
    await expect(
      upsertMcpServer("workspace", {
        name: "fixture",
        command: "fixture",
        transport: "stdio",
        enabled: true,
      }),
    ).rejects.toThrow("streaming");
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
