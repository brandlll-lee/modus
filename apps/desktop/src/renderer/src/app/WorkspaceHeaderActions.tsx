import { Popover } from "@base-ui/react/popover";
import { IconGitBranch, IconLayoutSidebarRight, IconListDetails } from "@tabler/icons-react";
import type { WorkspaceInfo } from "../../../shared/contracts";
import { Button } from "../components/ui/Button";
import { TOOLBAR_ICON, ToolbarButton } from "../components/ui/ToolbarButton";

export function WorkspaceHeaderActions({
  activeWorkspace,
  branch,
  environmentStats,
  inspectorOpen,
  onToggleInspector,
  onOpenReview,
}: {
  activeWorkspace: WorkspaceInfo | null;
  branch: string | undefined;
  environmentStats: { added: number; removed: number };
  inspectorOpen: boolean;
  onToggleInspector(): void;
  onOpenReview(): void;
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
                <div className="flex items-center justify-between gap-3">
                  <span className="flex gap-2 font-mono">
                    <span className="text-success">+{environmentStats.added}</span>
                    <span className="text-danger">-{environmentStats.removed}</span>
                  </span>
                  <Popover.Close
                    render={<Button disabled={!activeWorkspace} onClick={onOpenReview} />}
                  >
                    View changes
                  </Popover.Close>
                </div>
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
