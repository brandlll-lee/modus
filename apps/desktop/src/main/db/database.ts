import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app } from "electron";

let database: DatabaseSync | undefined;

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
  `);
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
