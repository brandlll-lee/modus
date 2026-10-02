import { randomUUID } from "node:crypto";
import type { BrowserRecentInfo } from "../../shared/contracts";

import { desktopPreferences, saveDesktopPreferences } from "../preferences/desktop-preferences";

const MAX_RECENTS_PER_WORKSPACE = 100;

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
  return desktopPreferences().browserRecents.filter((recent) => recent.workspaceId === workspaceId);
}

export function upsertBrowserRecent(input: {
  workspaceId: string;
  url: string;
  title?: string;
  favicon?: string;
  touch?: boolean;
}): void {
  const key = browserRecentKey(input.url);
  if (!key) return;
  const preferences = desktopPreferences(),
    index = preferences.browserRecents.findIndex(
      (recent) => recent.workspaceId === input.workspaceId && browserRecentKey(recent.url) === key,
    ),
    existing = preferences.browserRecents[index],
    now = new Date().toISOString();
  const recent: BrowserRecentInfo = {
    id: existing?.id ?? randomUUID(),
    workspaceId: input.workspaceId,
    url: input.url,
    title: input.title?.trim() || fallbackTitle(input.url),
    lastOpenedAt: input.touch === false && existing ? existing.lastOpenedAt : now,
    createdAt: existing?.createdAt ?? now,
    ...(input.favicon?.trim()
      ? { favicon: input.favicon.trim() }
      : existing?.favicon
        ? { favicon: existing.favicon }
        : {}),
  };
  if (existing && input.touch === false) preferences.browserRecents[index] = recent;
  else {
    if (index !== -1) preferences.browserRecents.splice(index, 1);
    preferences.browserRecents.unshift(recent);
  }
  let count = 0;
  preferences.browserRecents = preferences.browserRecents.filter(
    (item) => item.workspaceId !== input.workspaceId || ++count <= MAX_RECENTS_PER_WORKSPACE,
  );
  saveDesktopPreferences();
}

export function deleteBrowserRecent(id: string): void {
  const preferences = desktopPreferences();
  preferences.browserRecents = preferences.browserRecents.filter((recent) => recent.id !== id);
  saveDesktopPreferences();
}
