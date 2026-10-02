import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { BrowserRecentInfo, WorkspaceInfo } from "../../shared/contracts";

export type DesktopPreferences = {
  workspaces: (WorkspaceInfo & { pinnedAt?: string })[];
  sessions: Record<string, { pinnedAt?: string; archivedAt?: string }>;
  browserRecents: BrowserRecentInfo[];
};

let cached: DesktopPreferences | undefined;

export function desktopPreferences(): DesktopPreferences {
  if (cached) return cached;
  const file = join(app.getPath("userData"), "desktop-preferences.json");
  cached = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as DesktopPreferences)
    : { workspaces: [], sessions: {}, browserRecents: [] };
  return cached;
}

export function saveDesktopPreferences(): void {
  const directory = app.getPath("userData");
  mkdirSync(directory, { recursive: true });
  const file = join(directory, "desktop-preferences.json");
  writeFileSync(file, `${JSON.stringify(desktopPreferences(), null, 2)}\n`, {
    mode: 0o600,
  });
}
