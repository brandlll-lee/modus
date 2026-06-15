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
  pinned: number;
};

const SELECT_COLUMNS = "id, root_path, display_name, is_git_repository, last_opened_at, pinned";

function toWorkspace(row: WorkspaceRow): WorkspaceInfo {
  return {
    id: row.id,
    rootPath: row.root_path,
    displayName: row.display_name,
    isGitRepository: row.is_git_repository === 1,
    lastOpenedAt: row.last_opened_at,
    pinned: row.pinned === 1,
  };
}

/** Pinned projects first (most-recently-pinned on top), then recents. */
export function listWorkspaces(): WorkspaceInfo[] {
  const rows = getDatabase()
    .prepare(
      `select ${SELECT_COLUMNS}
       from workspaces
       order by pinned desc, coalesce(pinned_at, last_opened_at) desc`,
    )
    .all() as WorkspaceRow[];

  return rows.map(toWorkspace);
}

export function getWorkspace(id: string): WorkspaceInfo | undefined {
  const row = getDatabase()
    .prepare(`select ${SELECT_COLUMNS} from workspaces where id = ?`)
    .get(id) as WorkspaceRow | undefined;
  return row ? toWorkspace(row) : undefined;
}

export function upsertWorkspace(rootPath: string, isGitRepository: boolean): WorkspaceInfo {
  const db = getDatabase();
  const existing = db
    .prepare(`select ${SELECT_COLUMNS} from workspaces where root_path = ?`)
    .get(rootPath) as WorkspaceRow | undefined;

  const now = new Date().toISOString();
  const id = existing?.id ?? randomUUID();
  // Preserve a user-renamed display name across re-opens; only seed it on first add.
  const displayName = existing?.display_name ?? basename(rootPath);

  db.prepare(
    `insert into workspaces (id, root_path, display_name, is_git_repository, last_opened_at, created_at)
     values (?, ?, ?, ?, ?, ?)
     on conflict(root_path) do update set
       is_git_repository = excluded.is_git_repository,
       last_opened_at = excluded.last_opened_at`,
  ).run(id, rootPath, displayName, isGitRepository ? 1 : 0, now, now);

  return {
    id,
    rootPath,
    displayName,
    isGitRepository,
    lastOpenedAt: now,
    pinned: existing?.pinned === 1,
  };
}

/** Toggle a project's pinned state; `pinned_at` orders pinned projects. */
export function setWorkspacePinned(id: string, pinned: boolean): void {
  getDatabase()
    .prepare("update workspaces set pinned = ?, pinned_at = ? where id = ?")
    .run(pinned ? 1 : 0, pinned ? new Date().toISOString() : null, id);
}

/** Rename a project's sidebar display name. Empty names are rejected by the IPC schema. */
export function renameWorkspace(id: string, displayName: string): void {
  getDatabase().prepare("update workspaces set display_name = ? where id = ?").run(displayName, id);
}

/**
 * Remove a project from Modus. Sessions/events/runs cascade via FK, but their
 * runtime + checkpoint teardown must happen first (see archiveWorkspaceSessions).
 * Files on disk are never touched.
 */
export function removeWorkspace(id: string): void {
  getDatabase().prepare("delete from workspaces where id = ?").run(id);
}
