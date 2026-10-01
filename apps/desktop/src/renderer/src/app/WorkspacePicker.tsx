import { Menu } from "@base-ui/react/menu";
import {
  IconCheck,
  IconChevronDown,
  IconFolder,
  IconFolderPlus,
  IconGitBranch,
} from "@tabler/icons-react";
import type { WorkspaceInfo } from "../../../shared/contracts";
import { BranchSwitcher } from "../features/git/BranchSwitcher";

const WORKSPACE_TRIGGER_CLASS =
  "flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-sm font-normal text-fg-muted outline-none transition-colors hover:bg-hover hover:text-fg data-popup-open:bg-hover data-popup-open:text-fg disabled:opacity-60 disabled:hover:bg-transparent";

export function WorkspacePicker({
  activeWorkspace,
  branch,
  cwd,
  workspaces,
  onSelectWorkspace,
  onOpenFolder,
  onError,
}: {
  activeWorkspace: WorkspaceInfo | null;
  branch: string | undefined;
  cwd: string | undefined;
  workspaces: WorkspaceInfo[];
  onSelectWorkspace(workspace: WorkspaceInfo): void;
  onOpenFolder(): void;
  onError(message: string): void;
}) {
  return (
    <div className="app-no-drag flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <WorkspaceMenu
        activeWorkspace={activeWorkspace}
        onOpenFolder={onOpenFolder}
        onSelect={onSelectWorkspace}
        workspaces={workspaces}
      />
      <BranchSwitcher cwd={cwd} onError={onError} triggerClassName={WORKSPACE_TRIGGER_CLASS}>
        <span className="toolbar-icon">
          <IconGitBranch size={18} stroke={1.7} />
        </span>
        <span className="max-w-40 truncate">{branch ?? "No branch"}</span>
        <IconChevronDown className="toolbar-icon" size={13} stroke={2} />
      </BranchSwitcher>
    </div>
  );
}

/**
 * Folder switcher: lists every known workspace (the authoritative recents from
 * `workspace.list()`), marks the active one, and offers "Open folder…" to add a
 * new root. Selecting a different workspace hands it to the host, which switches
 * and opens a fresh chat — no empty session row is created until the first prompt.
 */
function WorkspaceMenu({
  activeWorkspace,
  workspaces,
  onSelect,
  onOpenFolder,
  triggerClassName = WORKSPACE_TRIGGER_CLASS,
}: {
  activeWorkspace: WorkspaceInfo | null;
  workspaces: WorkspaceInfo[];
  onSelect(workspace: WorkspaceInfo): void;
  onOpenFolder(): void;
  triggerClassName?: string;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger className={triggerClassName}>
        <span className="toolbar-icon">
          <IconFolder size={18} stroke={1.7} />
        </span>
        <span className="max-w-40 truncate">{activeWorkspace?.displayName ?? "No workspace"}</span>
        <IconChevronDown className="toolbar-icon" size={13} stroke={2} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="start" side="bottom" sideOffset={6}>
          <Menu.Popup className="scroll-thin origin-(--transform-origin) max-h-[360px] min-w-[260px] overflow-y-auto popup-chrome p-1">
            {workspaces.length === 0 ? (
              <div className="px-2.5 py-3 text-center text-2xs text-fg-faint">
                No recent workspaces
              </div>
            ) : (
              workspaces.map((workspace) => {
                const active = workspace.id === activeWorkspace?.id;
                return (
                  <Menu.Item
                    className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-fg text-sm outline-none transition-colors select-none data-highlighted:bg-hover"
                    closeOnClick
                    key={workspace.id}
                    onClick={() => {
                      if (!active) {
                        onSelect(workspace);
                      }
                    }}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center text-accent">
                      {active ? <IconCheck size={14} stroke={2} /> : null}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{workspace.displayName}</span>
                      <span className="truncate text-2xs text-fg-faint">{workspace.rootPath}</span>
                    </span>
                  </Menu.Item>
                );
              })
            )}
            <div className="my-1 h-px bg-hairline" />
            <Menu.Item
              className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-fg text-sm outline-none transition-colors select-none data-highlighted:bg-hover"
              onClick={onOpenFolder}
            >
              <span className="flex size-4 shrink-0 items-center justify-center text-fg-subtle">
                <IconFolderPlus size={15} stroke={1.7} />
              </span>
              <span className="flex-1">Open folder…</span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
