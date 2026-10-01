import type { DatabaseSync } from "node:sqlite";

export function migrateSessionSchema(db: DatabaseSync): void {
  const columns = db.prepare("pragma table_info(agent_sessions)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "parent_session_id")) return;

  db.exec("begin immediate");
  try {
    db.exec(`
      update agent_sessions
      set archived_at = coalesce(archived_at, updated_at)
      where parent_session_id is not null;
      delete from agent_events where type in ('subagent.started', 'subagent.updated');
      drop index if exists idx_agent_sessions_parent;
    `);
    for (const name of [
      "parent_session_id",
      "subagent_task",
      "subagent_type",
      "subagent_readonly",
      "subagent_worktree_path",
      "subagent_worktree_branch",
      "subagent_worktree_base_sha",
      "subagent_integration_status",
      "subagent_changed_files_json",
      "subagent_conflict_files_json",
    ]) {
      if (columns.some((column) => column.name === name)) {
        db.exec(`alter table agent_sessions drop column ${name}`);
      }
    }
    db.exec("commit");
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}
