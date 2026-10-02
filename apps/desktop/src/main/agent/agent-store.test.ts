import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { desktopPreferences } from "../preferences/desktop-preferences";

let root: string;
vi.mock("electron", () => ({ app: { getPath: () => root } }));
vi.mock("./session-directory", () => ({ sessionDirectory: () => join(root, "sessions") }));

import {
  appendAgentView,
  listAgentEvents,
  readAgentHistory,
  releaseAgentView,
  seedAgentView,
} from "./agent-history";
import {
  bindSessionManager,
  createAgentSessionRecord,
  discoverAgentSessions,
  getAgentSession,
  listAgentSessions,
  listArchivedAgentSessions,
  releaseSessionManager,
  sessionManagerFor,
  setAgentSessionArchived,
  setAgentSessionPinned,
  updateAgentSessionTitle,
} from "./agent-store";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "modus-native-history-"));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const id = crypto.randomUUID(),
    cwd = join(root, id);
  mkdirSync(cwd);
  desktopPreferences().workspaces.push({
    id,
    rootPath: cwd,
    displayName: "Fixture",
    isGitRepository: false,
    pinned: false,
    lastOpenedAt: new Date().toISOString(),
  });
  const manager = SessionManager.create(cwd, join(root, "sessions"));
  const user = manager.appendMessage({
    role: "user",
    content: "First question",
    timestamp: Date.now(),
  });
  manager.appendMessage(fauxAssistantMessage([{ type: "text", text: "First answer" }]));
  createAgentSessionRecord({ id, workspaceId: id, cwd, title: "First question" });
  bindSessionManager(id, manager);
  return { id, cwd, manager, user };
}
it("reads native files after runtime release and follows CLI title changes", () => {
  const { id, manager } = fixture();
  releaseSessionManager(id);
  SessionManager.open(manager.getSessionFile()!).appendSessionInfo("CLI title");
  expect(getAgentSession(id)?.title).toBe("CLI title");
  expect(
    readAgentHistory(id).events.some(
      ({ event }) => event.type === "message.delta" && event.delta === "First answer",
    ),
  ).toBe(true);
  updateAgentSessionTitle(id, "Desktop title");
  expect(SessionManager.open(manager.getSessionFile()!).getSessionName()).toBe("Desktop title");
});
it("keeps desktop pin and archive preferences separate from native history", () => {
  const { id, manager } = fixture();
  setAgentSessionPinned(id, true);
  setAgentSessionArchived(id, true);
  expect(listAgentSessions().some((item) => item.id === id)).toBe(false);
  expect(listArchivedAgentSessions(id).map((item) => item.id)).toEqual([id]);
  expect(
    listAgentSessions({ includeSessionId: id }).find((item) => item.id === id)?.pinnedAt,
  ).toBeDefined();
  expect(manager.getEntries().filter((entry) => entry.type === "message")).toHaveLength(2);
});
it("discovers a CLI session in the configured native directory", async () => {
  const { id, cwd } = fixture();
  const external = SessionManager.create(cwd, join(root, "sessions"));
  external.appendMessage({ role: "user", content: "From CLI", timestamp: Date.now() });
  external.appendMessage(fauxAssistantMessage([{ type: "text", text: "CLI answer" }]));
  await discoverAgentSessions();
  expect(
    listAgentSessions().some(
      (item) => item.workspaceId === id && item.piSessionId === external.getSessionId(),
    ),
  ).toBe(true);
});
it.each([
  "missing",
  "empty",
  "invalid",
])("reports a %s native session without replacing it", (kind) => {
  const { id, manager } = fixture(),
    file = manager.getSessionFile()!;
  releaseSessionManager(id);
  if (kind === "missing") unlinkSync(file);
  else writeFileSync(file, kind === "empty" ? "" : "not a PI session");
  expect(() => sessionManagerFor(id)).toThrow();
  expect(getAgentSession(id)?.status).toBe("error");
  expect(listAgentSessions().some((item) => item.id === id)).toBe(true);
});
it("restores tool images, errors, and native branch selection", () => {
  const { id, manager, user } = fixture();
  manager.appendMessage(
    fauxAssistantMessage(
      [{ type: "toolCall", id: "image-tool", name: "read", arguments: { path: "image.png" } }],
      { stopReason: "toolUse" },
    ),
  );
  manager.appendMessage({
    role: "toolResult",
    toolCallId: "image-tool",
    toolName: "read",
    content: [
      { type: "text", text: "Image" },
      { type: "image", data: "pixels", mimeType: "image/png" },
    ],
    isError: false,
    timestamp: Date.now(),
  });
  manager.appendMessage(
    fauxAssistantMessage([], { stopReason: "error", errorMessage: "Quota exhausted" }),
  );
  const history = readAgentHistory(id);
  expect(history.runs.at(-1)).toMatchObject({ status: "failed", error: "Quota exhausted" });
  expect(history.events.find(({ event }) => event.type === "tool.ended")?.event).toMatchObject({
    images: [{ type: "image", data: "pixels", mimeType: "image/png" }],
  });
  manager.branch(user);
  expect(readAgentHistory(id).events.some(({ event }) => event.type === "tool.ended")).toBe(false);
  expect(
    manager
      .getEntries()
      .some((entry) => entry.type === "message" && entry.message.role === "toolResult"),
  ).toBe(true);
});
it("preserves immediate GUI feedback through initialization and releases its cache", () => {
  const { id } = fixture();
  appendAgentView({ type: "message.started", sessionId: id, messageId: "pending", role: "user" });
  seedAgentView(id);
  expect(
    listAgentEvents(id).some(
      ({ event }) => event.type === "message.started" && event.messageId === "pending",
    ),
  ).toBe(true);
  releaseAgentView(id);
  expect(
    listAgentEvents(id).some(
      ({ event }) => event.type === "message.started" && event.messageId === "pending",
    ),
  ).toBe(false);
});

it("keeps an unfinished native branch visible without inventing a completed run", () => {
  const { id, manager } = fixture();
  const user = manager.appendMessage({
    role: "user",
    content: "Pending question",
    timestamp: Date.now(),
  });
  manager.appendMessage(
    fauxAssistantMessage(
      [{ type: "toolCall", id: "pending-tool", name: "read", arguments: { path: "file.ts" } }],
      { stopReason: "toolUse" },
    ),
  );
  const history = readAgentHistory(id);
  expect(
    history.events.some(
      ({ event }) => event.type === "message.delta" && event.delta === "Pending question",
    ),
  ).toBe(true);
  expect(history.runs.some((run) => run.userMessageId === user)).toBe(false);
});
