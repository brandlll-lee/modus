import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import type { WorkspaceInfo } from "../../shared/contracts";
import { isGitRepository } from "../git/git-service";
import { desktopPreferences, saveDesktopPreferences } from "../preferences/desktop-preferences";

const sessionWorkspaces = new Map<string, WorkspaceInfo>();

export async function syncSessionWorkspaces(entries: SessionInfo[]): Promise<void> {
  const existingByRoot = new Map(listWorkspaces().map((item) => [resolve(item.rootPath), item]));
  const modified = new Map<string, Date>();
  for (const entry of entries) {
    const root = resolve(entry.cwd);
    if (entry.modified > (modified.get(root) ?? new Date(0))) modified.set(root, entry.modified);
  }
  const discovered = await Promise.all(
    [...modified].map(async ([rootPath, time]): Promise<WorkspaceInfo> => {
      const existing = existingByRoot.get(rootPath);
      return {
        id: existing?.id ?? rootPath,
        rootPath,
        displayName: existing?.displayName ?? basename(rootPath),
        isGitRepository: existing?.isGitRepository ?? (await isGitRepository(rootPath)),
        lastOpenedAt: time.toISOString(),
        pinned: existing?.pinned ?? false,
      };
    }),
  );
  sessionWorkspaces.clear();
  for (const workspace of discovered) sessionWorkspaces.set(workspace.rootPath, workspace);
}

export function listWorkspaces(): WorkspaceInfo[] {
  const workspaces = new Map<string, WorkspaceInfo & { pinnedAt?: string }>(sessionWorkspaces);
  for (const preference of desktopPreferences().workspaces) {
    const root = resolve(preference.rootPath);
    const discovered = workspaces.get(root);
    workspaces.set(root, {
      ...preference,
      lastOpenedAt:
        discovered && discovered.lastOpenedAt > preference.lastOpenedAt
          ? discovered.lastOpenedAt
          : preference.lastOpenedAt,
    });
  }
  return [...workspaces.values()].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      (b.pinnedAt ?? b.lastOpenedAt).localeCompare(a.pinnedAt ?? a.lastOpenedAt),
  );
}
export function getWorkspace(id: string): WorkspaceInfo | undefined {
  return listWorkspaces().find((workspace) => workspace.id === id);
}
export function upsertWorkspace(rootPath: string, isGitRepository: boolean): WorkspaceInfo {
  const preferences = desktopPreferences(),
    existing = preferences.workspaces.find(
      (workspace) => resolve(workspace.rootPath) === resolve(rootPath),
    );
  if (existing) {
    existing.isGitRepository = isGitRepository;
    existing.lastOpenedAt = new Date().toISOString();
    saveDesktopPreferences();
    return existing;
  }
  const workspace = {
    id: sessionWorkspaces.get(resolve(rootPath))?.id ?? randomUUID(),
    rootPath,
    displayName: basename(rootPath),
    isGitRepository,
    lastOpenedAt: new Date().toISOString(),
    pinned: false,
  };
  preferences.workspaces.push(workspace);
  saveDesktopPreferences();
  return workspace;
}
export function setWorkspacePinned(id: string, pinned: boolean): void {
  const workspace = workspacePreference(id);
  if (!workspace) return;
  workspace.pinned = pinned;
  if (pinned) workspace.pinnedAt = new Date().toISOString();
  else delete workspace.pinnedAt;
  saveDesktopPreferences();
}
export function renameWorkspace(id: string, displayName: string): void {
  const workspace = workspacePreference(id);
  if (!workspace) return;
  workspace.displayName = displayName;
  saveDesktopPreferences();
}

function workspacePreference(id: string): (WorkspaceInfo & { pinnedAt?: string }) | undefined {
  const preferences = desktopPreferences();
  const existing = preferences.workspaces.find((workspace) => workspace.id === id);
  if (existing) return existing;
  const workspace = getWorkspace(id);
  if (!workspace) return undefined;
  const preference = { ...workspace };
  preferences.workspaces.push(preference);
  return preference;
}
export function removeWorkspace(id: string): void {
  const preferences = desktopPreferences();
  preferences.workspaces = preferences.workspaces.filter((workspace) => workspace.id !== id);
  preferences.browserRecents = preferences.browserRecents.filter(
    (recent) => recent.workspaceId !== id,
  );
  saveDesktopPreferences();
}
