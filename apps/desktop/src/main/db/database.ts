import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app } from "electron";

let database: DatabaseSync | undefined;

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function addColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  if (!hasColumn(db, table, column)) {
    db.exec(`alter table ${table} add column ${column} ${definition}`);
  }
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    create table if not exists workspaces (
      id text primary key,
      root_path text not null unique,
      display_name text not null,
      is_git_repository integer not null default 0,
      last_opened_at text not null,
      created_at text not null
    );

    create table if not exists agent_sessions (
      id text primary key,
      workspace_id text not null references workspaces(id) on delete cascade,
      title text not null,
      cwd text not null,
      status text not null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists permissions (
      id text primary key,
      action text not null,
      target text not null,
      decision text not null,
      created_at text not null
    );

    create table if not exists agent_events (
      id text primary key,
      session_id text not null references agent_sessions(id) on delete cascade,
      type text not null,
      payload_json text not null,
      created_at text not null
    );

    create table if not exists agent_runs (
      id text primary key,
      session_id text not null references agent_sessions(id) on delete cascade,
      user_message_id text,
      prompt text not null,
      status text not null,
      model text,
      started_at text not null,
      completed_at text,
      error text
    );

    create table if not exists terminal_outputs (
      terminal_id text primary key,
      workspace_id text not null,
      cwd text not null,
      output text not null,
      updated_at text not null
    );

    create table if not exists docs_sources (
      id text primary key,
      workspace_id text not null,
      title text not null,
      path text,
      url text,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists docs_chunks (
      id text primary key,
      source_id text not null references docs_sources(id) on delete cascade,
      heading text,
      content text not null,
      ordinal integer not null
    );

    create table if not exists agent_reviews (
      id text primary key,
      session_id text,
      workspace_id text,
      cwd text not null,
      depth text not null,
      status text not null,
      summary text not null,
      issues_json text not null,
      created_at text not null
    );

    create table if not exists app_settings (
      key text primary key,
      value text,
      updated_at text not null
    );

    create table if not exists model_provider_configs (
      provider_id text primary key,
      display_name text not null,
      source text not null,
      base_url text,
      api text,
      auth_header integer not null default 0,
      headers_json text,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists model_configs (
      id text primary key,
      provider_id text not null references model_provider_configs(provider_id) on delete cascade,
      model_id text not null,
      display_name text not null,
      source text not null,
      enabled integer not null default 0,
      context_window integer,
      max_tokens integer,
      reasoning integer not null default 0,
      thinking_level text not null default 'off',
      thinking_level_map_json text,
      created_at text not null,
      updated_at text not null,
      unique(provider_id, model_id)
    );

    create table if not exists agent_checkpoints (
      id text primary key,
      session_id text not null references agent_sessions(id) on delete cascade,
      run_id text,
      user_message_id text,
      cwd text not null,
      commit_hash text not null,
      kind text not null default 'auto',
      created_at text not null
    );

    create index if not exists idx_agent_checkpoints_session
      on agent_checkpoints(session_id);
  `);

  addColumn(db, "agent_sessions", "runtime", "text not null default 'pi-sdk'");
  addColumn(db, "agent_sessions", "model", "text");
  addColumn(db, "agent_sessions", "pi_session_id", "text");
  addColumn(db, "agent_sessions", "pi_session_file", "text");
  addColumn(db, "agent_sessions", "worktree_path", "text");
  // PI session-tree leaf id captured right before each prompt — the exact
  // branch point used to rewind the conversation when the message is edited.
  // "root" marks an empty tree (first message); NULL marks legacy runs.
  addColumn(db, "agent_runs", "pi_leaf_before", "text");
}

export function getDatabase(): DatabaseSync {
  if (database) {
    return database;
  }

  const dbPath = join(app.getPath("userData"), "modus.sqlite");
  mkdirSync(dirname(dbPath), { recursive: true });

  database = new DatabaseSync(dbPath);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  migrate(database);

  return database;
}
