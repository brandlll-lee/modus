import { Popover } from "@base-ui/react/popover";
import {
  IconFolder,
  IconGitBranch,
  IconHexagon,
  IconMessage,
} from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import type {
  AgentSessionInfo,
  ContextUsageInfo,
  ModelInfo,
  WorkspaceInfo,
} from "../../../../shared/contracts";
import { TOOLBAR_ICON } from "../../components/ui/ToolbarButton";
import { cn } from "../../lib/cn";
import {
  ContextUsageRing,
  contextUsagePercent,
  formatUsagePercent,
} from "../../lib/contextUsage";
import { lookupModel, modelIdentityLabel } from "../../lib/modelIdentity";

type SessionTitlePopoverProps = {
  session: AgentSessionInfo;
  workspace: WorkspaceInfo | null;
  branch: string | undefined;
  modelId: string;
  models: ModelInfo[];
  contextUsage: ContextUsageInfo | undefined;
};

/**
 * Main-chat chrome: session title pill → read-only summary (branch / path /
 * model / context). All fields are projections of App-owned authority — no
 * second git poll, no guessed labels.
 */
export function SessionTitlePopover({
  session,
  workspace,
  branch,
  modelId,
  models,
  contextUsage,
}: SessionTitlePopoverProps) {
  const [open, setOpen] = useState(false);
  const path = session.cwd || workspace?.rootPath || "";
  const project = workspace?.displayName ?? path;
  const model = lookupModel(models, modelId);
  const modelLabel = model ? modelIdentityLabel(model) : modelId;
  const percent = contextUsagePercent(contextUsage);
  const contextLabel =
    percent === undefined ? "Context unavailable" : `${formatUsagePercent(percent)} context`;

  return (
    <Popover.Root onOpenChange={setOpen} open={open}>
      <Popover.Trigger
        aria-label={session.title}
        className={cn(
          "app-no-drag flex max-w-44 min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-normal text-fg-muted transition-colors hover:bg-hover hover:text-fg-muted",
          open && "bg-active",
        )}
      >
        <span className="min-w-0 flex-1 truncate-fade">{session.title}</span>
        <IconMessage
          className="shrink-0 text-icon-muted"
          size={TOOLBAR_ICON.size}
          stroke={TOOLBAR_ICON.stroke}
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="start" side="bottom" sideOffset={6}>
          <Popover.Popup className="origin-(--transform-origin) w-[min(320px,calc(100vw-24px))] popup-chrome p-3 outline-none">
            <div className="mb-2.5 truncate px-1 text-sm text-fg">{session.title}</div>
            <div className="flex flex-col gap-2.5">
              <SessionMetaRow
                icon={
                  <IconGitBranch size={TOOLBAR_ICON.size} stroke={TOOLBAR_ICON.stroke} />
                }
              >
                <span className="truncate text-sm text-fg">{project}</span>
                <span className="truncate text-2xs text-fg-faint">{branch ?? "No branch"}</span>
              </SessionMetaRow>
              <SessionMetaRow
                icon={<IconFolder size={TOOLBAR_ICON.size} stroke={TOOLBAR_ICON.stroke} />}
              >
                <span className="truncate text-sm text-fg" title={path}>
                  {path || "No workspace"}
                </span>
              </SessionMetaRow>
              <SessionMetaRow
                icon={<IconHexagon size={TOOLBAR_ICON.size} stroke={TOOLBAR_ICON.stroke} />}
              >
                <span className="truncate text-sm text-fg">{modelLabel}</span>
              </SessionMetaRow>
              <SessionMetaRow icon={<ContextUsageRing percent={percent} />}>
                <span className="truncate text-sm text-fg">{contextLabel}</span>
              </SessionMetaRow>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SessionMetaRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 px-1 text-icon-muted">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</div>
    </div>
  );
}
