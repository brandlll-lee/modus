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
const { createAgentRun } = await import("./agent-run-store");
const { listAgentEvents, recordAgentEvent } = await import("./agent-event-store");

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
  userData = await mkdtemp(join(tmpdir(), "modus-event-store-test-"));
});

afterAll(async () => {
  await rm(userData, { recursive: true, force: true }).catch(() => undefined);
});

describe("agent-event-store", () => {
  it("backfills persisted user prompts for older sessions without user message events", () => {
    const sessionId = `session-${crypto.randomUUID()}`;
    insertSession(sessionId);
    const run = createAgentRun({
      sessionId,
      prompt: "介绍一下你自己",
      userMessageId: "local-user-1",
    });
    recordAgentEvent({
      type: "run.started",
      sessionId,
      runId: run.id,
      userMessageId: "local-user-1",
      delivery: "normal",
    });
    recordAgentEvent({
      type: "message.started",
      sessionId,
      messageId: "assistant-1",
      role: "assistant",
    });
    recordAgentEvent({
      type: "message.delta",
      sessionId,
      messageId: "assistant-1",
      delta: "你好",
    });
    recordAgentEvent({ type: "run.completed", sessionId, runId: run.id });

    const events = listAgentEvents(sessionId);

    expect(events.map(({ event }) => event.type)).toContain("message.delta");
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: {
            type: "message.delta",
            sessionId,
            messageId: "local-user-1",
            delta: "介绍一下你自己",
          },
        }),
      ]),
    );
  });
});
