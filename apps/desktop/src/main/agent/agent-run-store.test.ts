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
const { createAgentRun, getActiveAgentRun, listAgentRuns, updateAgentRunStatus } = await import(
  "./agent-run-store"
);

function insertSession(sessionId: string): void {
  const now = new Date().toISOString();
  const db = getDatabase();
  db.prepare(
    `insert into workspaces (id, root_path, display_name, is_git_repository, last_opened_at, created_at)
     values (?, ?, ?, ?, ?, ?)`,
  ).run(`workspace-${sessionId}`, `root-${sessionId}`, "repo", 1, now, now);
  db.prepare(
    `insert into agent_sessions (id, workspace_id, title, cwd, status, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?)`,
  ).run(sessionId, `workspace-${sessionId}`, "session", `root-${sessionId}`, "idle", now, now);
}

beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "modus-run-store-test-"));
});

afterAll(async () => {
  // node:sqlite keeps the database handle process-wide; leave temp files for OS cleanup.
  await rm(userData, { recursive: true, force: true }).catch(() => undefined);
});

describe("agent-run-store", () => {
  it("creates, updates, and lists runs", () => {
    const sessionId = `session-${crypto.randomUUID()}`;
    insertSession(sessionId);
    const run = createAgentRun({
      sessionId,
      prompt: "implement feature",
      userMessageId: "message-1",
      model: "provider/model",
    });

    expect(run.status).toBe("running");
    expect(getActiveAgentRun(sessionId)?.id).toBe(run.id);

    const completed = updateAgentRunStatus(run.id, "completed");

    expect(completed?.status).toBe("completed");
    expect(completed?.completedAt).toBeDefined();
    expect(getActiveAgentRun(sessionId)).toBeUndefined();
    expect(listAgentRuns(sessionId).map((item) => item.id)).toEqual([run.id]);
  });

  it("returns latest active blocked or running run", () => {
    const sessionId = `session-${crypto.randomUUID()}`;
    insertSession(sessionId);
    const first = createAgentRun({ sessionId, prompt: "first" });
    updateAgentRunStatus(first.id, "blocked", "permission denied");
    const second = createAgentRun({ sessionId, prompt: "second" });

    expect(getActiveAgentRun(sessionId)?.id).toBe(second.id);
  });
});
