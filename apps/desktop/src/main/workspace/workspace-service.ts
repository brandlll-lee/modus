import { dialog } from "electron";
import type { WorkspaceInfo } from "../../shared/contracts";
import { isGitRepository } from "../git/git-service";
import { listWorkspaces, upsertWorkspace } from "./workspace-store";

export async function openWorkspace(): Promise<WorkspaceInfo | undefined> {
  const result = await dialog.showOpenDialog({
    title: "Open Modus Workspace",
    properties: ["openDirectory"],
  });

  if (result.canceled || !result.filePaths[0]) {
    return undefined;
  }

  const rootPath = result.filePaths[0];
  return upsertWorkspace(rootPath, await isGitRepository(rootPath));
}

export function getRecentWorkspaces(): WorkspaceInfo[] {
  return listWorkspaces();
}
