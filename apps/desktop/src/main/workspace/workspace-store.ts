import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { WorkspaceInfo } from "../../shared/contracts";
import { desktopPreferences, saveDesktopPreferences } from "../preferences/desktop-preferences";
export function listWorkspaces(): WorkspaceInfo[] {
  return [...desktopPreferences().workspaces].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      (b.pinnedAt ?? b.lastOpenedAt).localeCompare(a.pinnedAt ?? a.lastOpenedAt),
  );
}
export function getWorkspace(id: string): WorkspaceInfo | undefined {
  return desktopPreferences().workspaces.find((workspace) => workspace.id === id);
}
export function upsertWorkspace(rootPath: string, isGitRepository: boolean): WorkspaceInfo {
  const preferences = desktopPreferences(),
    existing = preferences.workspaces.find((workspace) => workspace.rootPath === rootPath);
  if (existing) {
    existing.isGitRepository = isGitRepository;
    existing.lastOpenedAt = new Date().toISOString();
    saveDesktopPreferences();
    return existing;
  }
  const workspace = {
    id: randomUUID(),
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
  const workspace = desktopPreferences().workspaces.find((workspace) => workspace.id === id);
  if (!workspace) return;
  workspace.pinned = pinned;
  if (pinned) workspace.pinnedAt = new Date().toISOString();
  else delete workspace.pinnedAt;
  saveDesktopPreferences();
}
export function renameWorkspace(id: string, displayName: string): void {
  const workspace = getWorkspace(id);
  if (!workspace) return;
  workspace.displayName = displayName;
  saveDesktopPreferences();
}
export function removeWorkspace(id: string): void {
  const preferences = desktopPreferences();
  preferences.workspaces = preferences.workspaces.filter((workspace) => workspace.id !== id);
  preferences.browserRecents = preferences.browserRecents.filter(
    (recent) => recent.workspaceId !== id,
  );
  saveDesktopPreferences();
}
