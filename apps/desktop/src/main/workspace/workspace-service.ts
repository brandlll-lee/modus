import { dialog, shell } from "electron";
import type { WorkspaceInfo } from "../../shared/contracts";
import { archiveWorkspaceSessions } from "../agent/session-lifecycle";
import { isGitRepository } from "../git/git-service";
import {
  getWorkspace,
  listWorkspaces,
  removeWorkspace,
  renameWorkspace,
  setWorkspacePinned,
  upsertWorkspace,
} from "./workspace-store";

export async function openWorkspace(): Promise<WorkspaceInfo | undefined> {
  const result = await dialog.showOpenDialog({
    title: "Open Modus Workspace",
    properties: ["openDirectory"],
  });
  const rootPath = result.filePaths[0];
  if (result.canceled || !rootPath) {
    return undefined;
  }
  return upsertWorkspace(rootPath, await isGitRepository(rootPath));
}

export function getRecentWorkspaces(): WorkspaceInfo[] {
  return listWorkspaces();
}

/** Pin / unpin a project; returns the re-sorted recents. */
export function setProjectPinned(id: string, pinned: boolean): WorkspaceInfo[] {
  setWorkspacePinned(id, pinned);
  return listWorkspaces();
}

/** Rename a project's sidebar label; returns the updated recents. */
export function renameProject(id: string, displayName: string): WorkspaceInfo[] {
  renameWorkspace(id, displayName);
  return listWorkspaces();
}

/** Archive all of a project's chats (full per-session teardown). Returns count removed. */
export async function archiveProjectChats(id: string): Promise<number> {
  return archiveWorkspaceSessions(id);
}

/**
 * Remove a project from Modus: tear down its sessions first (no orphaned
 * runtimes/checkpoints), then drop the workspace row. Files on disk are kept.
 */
export async function removeProject(id: string): Promise<WorkspaceInfo[]> {
  await archiveWorkspaceSessions(id);
  removeWorkspace(id);
  return listWorkspaces();
}

/** Reveal a project's root folder in the OS file manager. */
export async function revealProject(id: string): Promise<void> {
  const workspace = getWorkspace(id);
  if (!workspace) {
    return;
  }
  const failure = await shell.openPath(workspace.rootPath);
  if (failure) {
    throw new Error(failure);
  }
}
