import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migrateSessionSchema } from "./session-schema";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    pragma foreign_keys = on;
    create table agent_sessions (
      id text primary key, title text, pi_session_file text, updated_at text,
      archived_at text,
      parent_session_id text references agent_sessions(id) on delete cascade,
      subagent_task text, subagent_type text, subagent_readonly integer,
      subagent_worktree_path text, subagent_worktree_branch text,
      subagent_worktree_base_sha text, subagent_integration_status text,
      subagent_changed_files_json text, subagent_conflict_files_json text
    );
    create index idx_agent_sessions_parent on agent_sessions(parent_session_id);
    create table agent_events (
      id text primary key,
      session_id text references agent_sessions(id) on delete cascade,
      type text, payload_json text
    );
    insert into agent_sessions (id, title, updated_at) values ('main', 'Chat', '2026-10-01');
    insert into agent_sessions (id, title, updated_at, pi_session_file, parent_session_id)
      values ('worker', 'Research', '2026-09-30', '/sessions/research.jsonl', 'main');
    insert into agent_events values ('text', 'worker', 'message.delta', '{"delta":"Saved answer"}');
    insert into agent_events values ('status', 'main', 'subagent.started', '{}');
  `);
  return db;
}

describe("session schema migration", () => {
  it("preserves independent archived conversations and their history across repeated startup", () => {
    const db = database();
    try {
      migrateSessionSchema(db);
      migrateSessionSchema(db);
      expect(
        db
          .prepare("pragma table_info(agent_sessions)")
          .all()
          .map((row) => row.name),
      ).toEqual(["id", "title", "pi_session_file", "updated_at", "archived_at"]);
      expect(db.prepare("select * from agent_sessions where id = 'worker'").get()).toEqual({
        id: "worker",
        title: "Research",
        pi_session_file: "/sessions/research.jsonl",
        updated_at: "2026-09-30",
        archived_at: "2026-09-30",
      });
      db.exec("delete from agent_sessions where id = 'main'");
      expect(db.prepare("select payload_json from agent_events").all()).toEqual([
        { payload_json: '{"delta":"Saved answer"}' },
      ]);
      expect(db.prepare("pragma foreign_key_check").all()).toEqual([]);
      expect(db.prepare("pragma integrity_check").get()).toEqual({ integrity_check: "ok" });
    } finally {
      db.close();
    }
  });

  it("rolls back the whole migration when a database operation fails", () => {
    const db = database();
    try {
      db.exec(`create trigger protect_history before delete on agent_events
        begin select raise(abort, 'History locked'); end;`);
      expect(() => migrateSessionSchema(db)).toThrow("History locked");
      expect(
        db
          .prepare("select archived_at, parent_session_id from agent_sessions where id = 'worker'")
          .get(),
      ).toEqual({ archived_at: null, parent_session_id: "main" });
      expect(db.prepare("select count(*) as count from agent_events").get()).toEqual({ count: 2 });
      db.exec("drop trigger protect_history");
      migrateSessionSchema(db);
      expect(db.prepare("pragma integrity_check").get()).toEqual({ integrity_check: "ok" });
    } finally {
      db.close();
    }
  });
});
