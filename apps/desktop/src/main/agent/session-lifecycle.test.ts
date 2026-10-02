import { beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  dispose: vi.fn(async () => undefined),
  removeFile: vi.fn(async () => ({ method: "unlink" })),
  forget: vi.fn(),
  session: { isIdle: true },
  activeRun: undefined as unknown,
  commandActive: false,
}));
vi.mock("./runtime-registry", () => ({ getAgentRuntime: () => ({ dispose: native.dispose }) }));
vi.mock("./session-resources", () => ({
  assertConfigurationReady: vi.fn(),
  sessionResources: () => [{ id: "selected", session: native.session }],
}));
vi.mock("./agent-store", () => ({
  getAgentSession: () => ({ piSessionFile: "shared-session.jsonl" }),
  listAgentSessions: () => [{ id: "selected", workspaceId: "workspace" }],
  forgetAgentSession: native.forget,
}));
vi.mock("./session-file", () => ({ deleteSessionFile: native.removeFile }));
vi.mock("./agent-run-store", () => ({ getActiveAgentRun: () => native.activeRun }));
vi.mock("./extension-ui", () => ({ isExtensionCommandActive: () => native.commandActive }));
vi.mock("../interaction/question-broker", () => ({
  denyPendingQuestionRequestsForSession: vi.fn(),
}));

import { deleteWorkspaceSessions, removeAgentSession } from "./session-lifecycle";

beforeEach(() => {
  vi.clearAllMocks();
  native.dispose.mockResolvedValue(undefined);
  native.removeFile.mockResolvedValue({ method: "unlink" });
  native.session.isIdle = true;
  native.activeRun = undefined;
  native.commandActive = false;
});
it("closes the idle SDK before deleting the shared file and releases its metadata afterward", async () => {
  native.removeFile.mockImplementation(async () => {
    expect(native.dispose).toHaveBeenCalledWith("selected");
    expect(native.forget).not.toHaveBeenCalled();
    return { method: "trash" };
  });
  expect(await removeAgentSession("selected")).toEqual({ method: "trash" });
  expect(native.removeFile).toHaveBeenCalledWith("shared-session.jsonl");
  expect(native.forget).toHaveBeenCalledWith("selected");
});
it("keeps the sidebar record when file deletion fails", async () => {
  native.removeFile.mockRejectedValue(new Error("permission denied"));
  await expect(removeAgentSession("selected")).rejects.toThrow("permission denied");
  expect(native.forget).not.toHaveBeenCalled();
});
it("rejects execution, preparation, and extension activity before disposal", async () => {
  native.session.isIdle = false;
  await expect(removeAgentSession("selected")).rejects.toThrow("Wait for the agent");
  native.session.isIdle = true;
  native.activeRun = { status: "running" };
  await expect(removeAgentSession("selected")).rejects.toThrow("Wait for the agent");
  native.activeRun = undefined;
  native.commandActive = true;
  await expect(deleteWorkspaceSessions("workspace")).rejects.toThrow("Wait for the agent");
  expect(native.dispose).not.toHaveBeenCalled();
  expect(native.removeFile).not.toHaveBeenCalled();
});
