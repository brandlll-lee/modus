import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let userData: string;

vi.mock("electron", () => ({
  app: { getPath: () => userData },
}));

const { getDatabase } = await import("../db/database");
const { createAgentRun, updateAgentRunStatus } = await import("./agent-run-store");
const { getLastTurnComparison } = await import("./checkpoint-service");

beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "modus-checkpoint-test-"));
});

afterAll(async () => {
  await rm(userData, { recursive: true, force: true }).catch(() => undefined);
});

function insertSession(sessionId: string, cwd: string): void {
  const now = new Date().toISOString();
  const workspaceId = `workspace-${sessionId}`;
  const db = getDatabase();
  db.prepare(
    `insert into workspaces (id, root_path, display_name, is_git_repository, last_opened_at, created_at)
     values (?, ?, ?, ?, ?, ?)`,
  ).run(workspaceId, cwd, "repo", 1, now, now);
  db.prepare(
    `insert into agent_sessions (id, workspace_id, title, cwd, status, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?)`,
  ).run(sessionId, workspaceId, "session", cwd, "idle", now, now);
}

function insertCheckpoint(
  sessionId: string,
  runId: string,
  cwd: string,
  kind: "auto" | "turn-end",
  commit: string,
): void {
  getDatabase()
    .prepare(
      `insert into agent_checkpoints
       (id, session_id, run_id, user_message_id, cwd, commit_hash, kind, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), sessionId, runId, null, cwd, commit, kind, new Date().toISOString());
}

describe("getLastTurnComparison", () => {
  it("uses the live checkout while running, then freezes at the terminal snapshot", () => {
    const sessionId = `session-${randomUUID()}`;
    const cwd = join(userData, sessionId);
    insertSession(sessionId, cwd);
    const run = createAgentRun({ sessionId, prompt: "change files" });
    insertCheckpoint(sessionId, run.id, cwd, "auto", "start-commit");

    expect(getLastTurnComparison(sessionId, cwd)).toMatchObject({
      state: "ready",
      comparison: {
        from: "start-commit",
        runId: run.id,
        status: "running",
        live: true,
      },
    });

    updateAgentRunStatus(run.id, "completed");
    expect(getLastTurnComparison(sessionId, cwd)).toEqual({
      state: "unavailable",
      reason: "missing-end",
      message: "Available after the next completed turn.",
    });

    insertCheckpoint(sessionId, run.id, cwd, "turn-end", "end-commit");
    expect(getLastTurnComparison(sessionId, cwd)).toMatchObject({
      state: "ready",
      comparison: {
        from: "start-commit",
        to: "end-commit",
        status: "completed",
        live: false,
      },
    });
  });

  it("rejects snapshots from another linked worktree", () => {
    const sessionId = `session-${randomUUID()}`;
    const cwd = join(userData, sessionId);
    insertSession(sessionId, cwd);
    const run = createAgentRun({ sessionId, prompt: "change files" });
    insertCheckpoint(sessionId, run.id, cwd, "auto", "start-commit");

    expect(getLastTurnComparison(sessionId, join(cwd, "other"))).toMatchObject({
      state: "unavailable",
      reason: "worktree-mismatch",
    });
  });

  it.each(["failed", "cancelled"] as const)("keeps a %s turn reviewable", (status) => {
    const sessionId = `session-${randomUUID()}`;
    const cwd = join(userData, sessionId);
    insertSession(sessionId, cwd);
    const run = createAgentRun({ sessionId, prompt: "change files" });
    insertCheckpoint(sessionId, run.id, cwd, "auto", "start-commit");
    updateAgentRunStatus(run.id, status);
    insertCheckpoint(sessionId, run.id, cwd, "turn-end", "end-commit");

    expect(getLastTurnComparison(sessionId, cwd)).toMatchObject({
      state: "ready",
      comparison: { status, live: false },
    });
  });

  it("reports the absence of a turn without throwing", () => {
    const sessionId = `session-${randomUUID()}`;
    const cwd = join(userData, sessionId);
    insertSession(sessionId, cwd);

    expect(getLastTurnComparison(sessionId, cwd)).toMatchObject({
      state: "unavailable",
      reason: "no-turn",
    });
  });
});
