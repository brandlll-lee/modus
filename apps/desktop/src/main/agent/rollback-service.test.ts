import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let userData: string;
let sessionDir: string;

vi.mock("electron", () => ({
  app: {
    getPath: () => userData,
  },
}));

const restoreCheckpointMock = vi.hoisted(() => vi.fn());
vi.mock("./checkpoint-service", () => ({
  restoreCheckpoint: restoreCheckpointMock,
}));

const { getDatabase } = await import("../db/database");
const { recordAgentEvent, listAgentEvents } = await import("./agent-event-store");
const { createAgentRun } = await import("./agent-run-store");
const { PI_ROOT_LEAF, ROLLBACK_MARKER_TYPE, rollbackToUserMessage } = await import(
  "./rollback-service"
);

function fakeRuntime() {
  return {
    abort: vi.fn<(sessionId: string) => Promise<void>>().mockResolvedValue(undefined),
    dispose: vi.fn<(sessionId: string) => Promise<void>>().mockResolvedValue(undefined),
  };
}

function insertSession(sessionId: string, piSessionFile?: string): void {
  const now = new Date().toISOString();
  const db = getDatabase();
  db.prepare(
    `insert into workspaces (id, root_path, display_name, is_git_repository, last_opened_at, created_at)
     values (?, ?, ?, ?, ?, ?)`,
  ).run(`workspace-${sessionId}`, `root-${sessionId}`, "repo", 1, now, now);
  db.prepare(
    `insert into agent_sessions (id, workspace_id, title, cwd, status, pi_session_file, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    `workspace-${sessionId}`,
    "session",
    `root-${sessionId}`,
    "idle",
    piSessionFile ?? null,
    now,
    now,
  );
}

function insertCheckpoint(sessionId: string, runId: string | null, kind: string): string {
  const id = randomUUID();
  getDatabase()
    .prepare(
      `insert into agent_checkpoints (id, session_id, run_id, user_message_id, cwd, commit_hash, kind, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      sessionId,
      runId,
      null,
      `root-${sessionId}`,
      "deadbeef",
      kind,
      new Date().toISOString(),
    );
  return id;
}

/** Append a minimal message entry; tests don't need full AgentMessage shapes. */
function appendTreeMessage(manager: SessionManager, message: { role: string; content: string }) {
  manager.appendMessage(message as unknown as Parameters<SessionManager["appendMessage"]>[0]);
}

/**
 * Simulates one full prompt turn the way PiSdkRuntime records it: capture the
 * tree leaf, create the run row, emit the user-message + run events into the
 * store, and append the user/assistant entries to the PI session tree.
 */
function recordTurn(
  manager: SessionManager,
  sessionId: string,
  prompt: string,
  options: { anchored?: boolean } = {},
): { runId: string; userMessageId: string } {
  const piLeafBefore = manager.getLeafId() ?? PI_ROOT_LEAF;
  const userMessageId = `local-user:${randomUUID()}`;
  const run = createAgentRun({
    sessionId,
    prompt,
    userMessageId,
    ...(options.anchored === false ? {} : { piLeafBefore }),
  });
  recordAgentEvent({ type: "message.started", sessionId, messageId: userMessageId, role: "user" });
  recordAgentEvent({ type: "message.delta", sessionId, messageId: userMessageId, delta: prompt });
  recordAgentEvent({ type: "message.completed", sessionId, messageId: userMessageId });
  recordAgentEvent({ type: "run.started", sessionId, runId: run.id, delivery: "normal" });

  appendTreeMessage(manager, { role: "user", content: prompt });
  appendTreeMessage(manager, { role: "assistant", content: `re: ${prompt}` });

  recordAgentEvent({
    type: "message.started",
    sessionId,
    messageId: `assistant:${run.id}`,
    role: "assistant",
  });
  recordAgentEvent({
    type: "message.delta",
    sessionId,
    messageId: `assistant:${run.id}`,
    delta: `re: ${prompt}`,
  });
  recordAgentEvent({ type: "run.completed", sessionId, runId: run.id });
  return { runId: run.id, userMessageId };
}

function createPiSession(sessionId: string): { manager: SessionManager; file: string } {
  const manager = SessionManager.create(`root-${sessionId}`, sessionDir);
  const file = manager.getSessionFile();
  if (!file) {
    throw new Error("expected a persisted session file");
  }
  return { manager, file };
}

beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "modus-rollback-test-"));
  sessionDir = await mkdtemp(join(tmpdir(), "modus-rollback-pi-"));
});

afterAll(async () => {
  // node:sqlite keeps the database handle process-wide; leave temp files for OS cleanup.
  await rm(userData, { recursive: true, force: true }).catch(() => undefined);
  await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
});

describe("rollbackToUserMessage", () => {
  it("rewinds events, runs, checkpoints and the PI tree to before a mid-conversation message", async () => {
    const sessionId = `session-${randomUUID()}`;
    const { manager, file } = createPiSession(sessionId);
    insertSession(sessionId, file);

    const first = recordTurn(manager, sessionId, "first prompt");
    const second = recordTurn(manager, sessionId, "second prompt");
    const third = recordTurn(manager, sessionId, "third prompt");
    insertCheckpoint(sessionId, first.runId, "auto");
    const secondCheckpoint = insertCheckpoint(sessionId, second.runId, "auto");
    insertCheckpoint(sessionId, third.runId, "auto");
    const backupId = insertCheckpoint(sessionId, null, "restore-backup");

    const runtime = fakeRuntime();
    const result = await rollbackToUserMessage(runtime, {
      sessionId,
      userMessageId: second.userMessageId,
    });

    expect(runtime.abort).toHaveBeenCalledWith(sessionId);
    expect(runtime.dispose).toHaveBeenCalledWith(sessionId);
    expect(restoreCheckpointMock).toHaveBeenCalledWith(secondCheckpoint);
    expect(result).toMatchObject({
      sessionId,
      userMessageId: second.userMessageId,
      filesRestored: true,
      checkpointId: secondCheckpoint,
      removedRuns: 2,
    });

    // History: only the first turn's events/run survive.
    const events = listAgentEvents(sessionId).map((item) => item.event);
    expect(
      events.some((event) => event.type === "message.delta" && event.delta === "second prompt"),
    ).toBe(false);
    expect(
      events.some((event) => event.type === "message.delta" && event.delta === "first prompt"),
    ).toBe(true);
    const runRows = getDatabase()
      .prepare("select id from agent_runs where session_id = ? order by rowid asc")
      .all(sessionId) as Array<{ id: string }>;
    expect(runRows.map((row) => row.id)).toEqual([first.runId]);

    // Auto checkpoints of removed runs are gone; restore backups survive.
    const checkpointRows = getDatabase()
      .prepare("select id, kind from agent_checkpoints where session_id = ? order by rowid asc")
      .all(sessionId) as Array<{ id: string; kind: string }>;
    expect(checkpointRows.map((row) => row.kind).sort()).toEqual(["auto", "restore-backup"]);
    expect(checkpointRows.some((row) => row.id === backupId)).toBe(true);

    // PI tree: reload from disk → leaf is the rollback marker, context is the
    // first turn only (marker entries never reach the LLM).
    const reloaded = SessionManager.open(file, undefined, `root-${sessionId}`);
    const leaf = reloaded.getLeafEntry();
    expect(leaf).toMatchObject({ type: "custom", customType: ROLLBACK_MARKER_TYPE });
    const context = reloaded.buildSessionContext();
    expect(context.messages).toHaveLength(2);
    expect(context.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "re: first prompt",
    });
  });

  it("rewinds to before the first message using the root sentinel", async () => {
    const sessionId = `session-${randomUUID()}`;
    const { manager, file } = createPiSession(sessionId);
    insertSession(sessionId, file);
    const first = recordTurn(manager, sessionId, "only prompt");

    const result = await rollbackToUserMessage(fakeRuntime(), {
      sessionId,
      userMessageId: first.userMessageId,
    });

    expect(result.filesRestored).toBe(false);
    expect(result.removedRuns).toBe(1);
    expect(listAgentEvents(sessionId)).toHaveLength(0);

    const reloaded = SessionManager.open(file, undefined, `root-${sessionId}`);
    expect(reloaded.buildSessionContext().messages).toHaveLength(0);
    // The next prompt resumes cleanly from the (empty) rolled-back branch.
    appendTreeMessage(reloaded, { role: "user", content: "fresh start" });
    const next = reloaded.buildSessionContext();
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0]).toMatchObject({ content: "fresh start" });
  });

  it("aligns legacy runs without anchors by ordinal position", async () => {
    const sessionId = `session-${randomUUID()}`;
    const { manager, file } = createPiSession(sessionId);
    insertSession(sessionId, file);
    recordTurn(manager, sessionId, "legacy one", { anchored: false });
    const second = recordTurn(manager, sessionId, "legacy two", { anchored: false });

    await rollbackToUserMessage(fakeRuntime(), {
      sessionId,
      userMessageId: second.userMessageId,
    });

    const reloaded = SessionManager.open(file, undefined, `root-${sessionId}`);
    const context = reloaded.buildSessionContext();
    expect(context.messages).toHaveLength(2);
    expect(context.messages.at(-1)).toMatchObject({ content: "re: legacy one" });
  });

  it("resolves backfilled user:<runId> message ids", async () => {
    const sessionId = `session-${randomUUID()}`;
    const { manager, file } = createPiSession(sessionId);
    insertSession(sessionId, file);
    const first = recordTurn(manager, sessionId, "alpha");
    recordTurn(manager, sessionId, "beta");

    const result = await rollbackToUserMessage(fakeRuntime(), {
      sessionId,
      userMessageId: `user:${first.runId}`,
    });

    expect(result.removedRuns).toBe(2);
    const reloaded = SessionManager.open(file, undefined, `root-${sessionId}`);
    expect(reloaded.buildSessionContext().messages).toHaveLength(0);
  });

  it("rejects unknown messages and sessions", async () => {
    const sessionId = `session-${randomUUID()}`;
    insertSession(sessionId);

    await expect(
      rollbackToUserMessage(fakeRuntime(), { sessionId, userMessageId: "local-user:nope" }),
    ).rejects.toThrow(/no longer exists/);
    await expect(
      rollbackToUserMessage(fakeRuntime(), {
        sessionId: "missing-session",
        userMessageId: "local-user:nope",
      }),
    ).rejects.toThrow(/not found/);
  });
});
