import { randomUUID } from "node:crypto";
import type { BrowserRecentInfo } from "../../shared/contracts";
import { getDatabase } from "../db/database";

const MAX_RECENTS_PER_WORKSPACE = 100;

type BrowserRecentRow = {
  id: string;
  workspace_id: string;
  url: string;
  title: string;
  favicon: string | null;
  last_opened_at: string;
  created_at: string;
};

function toRecent(row: BrowserRecentRow): BrowserRecentInfo {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    url: row.url,
    title: row.title,
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
    ...(row.favicon !== null ? { favicon: row.favicon } : {}),
  };
}

export function browserRecentKey(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return undefined;
  }
  return `${parsed.origin}${parsed.pathname}${parsed.search}`;
}

function fallbackTitle(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

export function listBrowserRecents(workspaceId: string): BrowserRecentInfo[] {
  const rows = getDatabase()
    .prepare(
      `select id, workspace_id, url, title, favicon, last_opened_at, created_at
       from browser_recents
       where workspace_id = ?
       order by last_opened_at desc, rowid desc
       limit ?`,
    )
    .all(workspaceId, MAX_RECENTS_PER_WORKSPACE) as BrowserRecentRow[];

  return rows.map(toRecent);
}

export function upsertBrowserRecent(input: {
  workspaceId: string;
  url: string;
  title?: string;
  favicon?: string;
  touch?: boolean;
}): void {
  const urlKey = browserRecentKey(input.url);
  if (!urlKey) {
    return;
  }

  const now = new Date().toISOString();
  const title = input.title?.trim() || fallbackTitle(input.url);
  const favicon = input.favicon?.trim() || null;
  const touch = input.touch !== false ? 1 : 0;
  const db = getDatabase();

  db.prepare(
    `insert into browser_recents (
       id, workspace_id, url_key, url, title, favicon, last_opened_at, created_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(workspace_id, url_key) do update set
       url = excluded.url,
       title = excluded.title,
       favicon = coalesce(excluded.favicon, browser_recents.favicon),
       last_opened_at = case when ? = 1
         then excluded.last_opened_at
         else browser_recents.last_opened_at
       end`,
  ).run(randomUUID(), input.workspaceId, urlKey, input.url, title, favicon, now, now, touch);

  db.prepare(
    `delete from browser_recents
     where workspace_id = ?
       and id not in (
         select id from browser_recents
         where workspace_id = ?
         order by last_opened_at desc, rowid desc
         limit ?
       )`,
  ).run(input.workspaceId, input.workspaceId, MAX_RECENTS_PER_WORKSPACE);
}

export function deleteBrowserRecent(id: string): void {
  getDatabase().prepare("delete from browser_recents where id = ?").run(id);
}
