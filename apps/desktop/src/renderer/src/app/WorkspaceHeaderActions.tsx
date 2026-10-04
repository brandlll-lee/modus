import { Popover } from "@base-ui/react/popover";
import { IconGitBranch, IconLayoutSidebarRight, IconListDetails } from "@tabler/icons-react";
import type { WorkspaceInfo } from "../../../shared/contracts";
import { TOOLBAR_ICON, ToolbarButton } from "../components/ui/ToolbarButton";

export function WorkspaceHeaderActions({
  activeWorkspace,
  branch,
  inspectorOpen,
  onToggleInspector,
}: {
  activeWorkspace: WorkspaceInfo | null;
  branch: string | undefined;
  inspectorOpen: boolean;
  onToggleInspector(): void;
}) {
  return (
    <div className="app-no-drag flex h-8 items-center gap-1">
      <Popover.Root>
        <Popover.Trigger render={<ToolbarButton label="Environment" />}>
          <IconListDetails {...TOOLBAR_ICON} />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner align="end" sideOffset={8}>
            <Popover.Popup className="popup-chrome w-72 p-4">
              <h2 className="mb-4 text-sm font-medium">Environment</h2>
              <div className="space-y-3 text-sm text-fg-muted">
                <p className="truncate">{activeWorkspace?.displayName ?? "No workspace"}</p>
                <p className="flex items-center gap-2">
                  <IconGitBranch size={15} />
                  {branch ?? "No branch"}
                </p>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <ToolbarButton
        active={inspectorOpen}
        label={inspectorOpen ? "Hide right sidebar" : "Show right sidebar"}
        onClick={onToggleInspector}
      >
        <IconLayoutSidebarRight {...TOOLBAR_ICON} />
      </ToolbarButton>
    </div>
  );
}
