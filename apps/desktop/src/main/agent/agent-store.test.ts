import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let userData: string;

vi.mock("electron", () => ({
  app: {
    getPath: () => userData,
  },
}));

const { getDatabase } = await import("../db/database");
const {
  listAgentSessions,
  listArchivedAgentSessions,
  setAgentSessionArchived,
  setAgentSessionPinned,
} = await import("./agent-store");

function insertWorkspace(workspaceId: string): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `insert into workspaces (id, root_path, display_name, is_git_repository, last_opened_at, created_at)
       values (?, ?, ?, ?, ?, ?)`,
    )
    .run(workspaceId, `root-${workspaceId}`, "repo", 1, now, now);
}

function insertSession(workspaceId: string, sessionId: string, title: string): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `insert into agent_sessions (id, workspace_id, title, cwd, status, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sessionId, workspaceId, title, `root-${workspaceId}`, "idle", now, now);
}

beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "modus-agent-store-test-"));
});

afterAll(async () => {
  await rm(userData, { recursive: true, force: true }).catch(() => undefined);
});

describe("agent-store", () => {
  it("hides archived sessions from the default list", () => {
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    const visibleId = `session-${crypto.randomUUID()}`;
    const archivedId = `session-${crypto.randomUUID()}`;
    insertWorkspace(workspaceId);
    insertSession(workspaceId, visibleId, "Visible");
    insertSession(workspaceId, archivedId, "Archived");

    setAgentSessionArchived(archivedId, true);

    expect(listAgentSessions().map((session) => session.id)).toContain(visibleId);
    expect(listAgentSessions().map((session) => session.id)).not.toContain(archivedId);
    expect(
      listAgentSessions({ includeSessionId: archivedId }).map((session) => session.id),
    ).toEqual(expect.arrayContaining([visibleId, archivedId]));
    expect(listArchivedAgentSessions(workspaceId).map((session) => session.id)).toEqual([
      archivedId,
    ]);
  });

  it("sorts pinned sessions before regular sessions", () => {
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    const regularId = `session-${crypto.randomUUID()}`;
    const pinnedId = `session-${crypto.randomUUID()}`;
    insertWorkspace(workspaceId);
    insertSession(workspaceId, regularId, "Regular");
    insertSession(workspaceId, pinnedId, "Pinned");

    setAgentSessionPinned(pinnedId, true);

    const orderedIds = listAgentSessions()
      .filter((session) => session.workspaceId === workspaceId)
      .map((session) => session.id);
    expect(orderedIds).toEqual([pinnedId, regularId]);
  });
});
