import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { WorkspaceInfo } from "../../shared/contracts";
import { getDatabase } from "../db/database";

type WorkspaceRow = {
  id: string;
  root_path: string;
  display_name: string;
  is_git_repository: number;
  last_opened_at: string;
};

function toWorkspace(row: WorkspaceRow): WorkspaceInfo {
  return {
    id: row.id,
    rootPath: row.root_path,
    displayName: row.display_name,
    isGitRepository: row.is_git_repository === 1,
    lastOpenedAt: row.last_opened_at,
  };
}

export function listWorkspaces(): WorkspaceInfo[] {
  const rows = getDatabase()
    .prepare(
      `select id, root_path, display_name, is_git_repository, last_opened_at
       from workspaces
       order by last_opened_at desc`,
    )
    .all() as WorkspaceRow[];

  return rows.map(toWorkspace);
}

export function upsertWorkspace(rootPath: string, isGitRepository: boolean): WorkspaceInfo {
  const db = getDatabase();
  const existing = db
    .prepare(
      `select id, root_path, display_name, is_git_repository, last_opened_at
       from workspaces
       where root_path = ?`,
    )
    .get(rootPath) as WorkspaceRow | undefined;

  const now = new Date().toISOString();
  const id = existing?.id ?? randomUUID();
  const displayName = basename(rootPath);

  db.prepare(
    `insert into workspaces (id, root_path, display_name, is_git_repository, last_opened_at, created_at)
     values (?, ?, ?, ?, ?, ?)
     on conflict(root_path) do update set
       display_name = excluded.display_name,
       is_git_repository = excluded.is_git_repository,
       last_opened_at = excluded.last_opened_at`,
  ).run(id, rootPath, displayName, isGitRepository ? 1 : 0, now, now);

  return {
    id,
    rootPath,
    displayName,
    isGitRepository,
    lastOpenedAt: now,
  };
}
