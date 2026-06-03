import { Tabs } from "@base-ui/react/tabs";
import {
  IconDots,
  IconGitBranch,
  IconLayoutSidebarRight,
  IconPlus,
  IconShieldCheck,
  IconShieldX,
  IconTerminal2,
  IconTrash,
  IconVersions,
} from "@tabler/icons-react";
import { m } from "motion/react";
import { type PointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { SecurityState } from "../../../../preload/types";
import type { WorkspaceInfo, WorktreeInfo } from "../../../../shared/contracts";
import { EmptyState, PanelHeader } from "../../components/ui/Panel";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";
import { DiffPanel } from "../diff/DiffPanel";
import { TerminalPanel } from "../terminal/TerminalPanel";

type InspectorProps = {
  activeWorkspace: WorkspaceInfo | null;
  securityState: SecurityState | null;
  open: boolean;
  width: number;
  onOpenChange(open: boolean): void;
  onWidthChange(width: number): void;
};

const INSPECTOR_MIN_WIDTH = 320;
const INSPECTOR_MAX_WIDTH = 720;
const INSPECTOR_COLLAPSED_WIDTH = 0;
const INSPECTOR_TRANSITION = { duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const;

const TABS = [
  { value: "changes", label: "Changes", icon: <IconGitBranch size={15} stroke={1.65} /> },
  { value: "terminal", label: "Terminal", icon: <IconTerminal2 size={15} stroke={1.65} /> },
  { value: "worktrees", label: "Worktrees", icon: <IconVersions size={15} stroke={1.65} /> },
  { value: "security", label: "Security", icon: <IconShieldCheck size={15} stroke={1.65} /> },
];

export function Inspector({
  activeWorkspace,
  securityState,
  open,
  width,
  onOpenChange,
  onWidthChange,
}: InspectorProps) {
  const dragStartRef = useRef<{ x: number; width: number } | null>(null);
  const [contentVisible, setContentVisible] = useState(open);
  const panelWidth = open ? width : INSPECTOR_COLLAPSED_WIDTH;

  useEffect(() => {
    if (!open) {
      setContentVisible(false);
    }
  }, [open]);

  function startResize(event: PointerEvent<HTMLButtonElement>): void {
    event.preventDefault();
    if (!open) {
      onOpenChange(true);
      onWidthChange(INSPECTOR_MIN_WIDTH);
    }

    dragStartRef.current = { x: event.clientX, width: open ? width : INSPECTOR_MIN_WIDTH };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resize(event: PointerEvent<HTMLButtonElement>): void {
    if (!dragStartRef.current) {
      return;
    }

    const nextWidth = dragStartRef.current.width + dragStartRef.current.x - event.clientX;
    onWidthChange(Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, nextWidth)));
  }

  function stopResize(): void {
    if (!dragStartRef.current) {
      return;
    }

    dragStartRef.current = null;
    if (width < INSPECTOR_MIN_WIDTH + 24) {
      onOpenChange(false);
    }
  }

  return (
    <m.aside
      animate={{ width: panelWidth }}
      className={cn(
        "relative flex min-w-0 shrink-0 flex-col overflow-hidden bg-panel",
        open && "border-hairline-strong border-l",
      )}
      initial={false}
      onAnimationComplete={() => {
        if (open) {
          setContentVisible(true);
        }
      }}
      transition={INSPECTOR_TRANSITION}
    >
      {open ? (
        <>
          <button
            aria-label="Resize right panel"
            className="app-no-drag absolute top-0 bottom-0 left-0 z-20 w-1 cursor-col-resize hover:bg-white/8"
            onPointerDown={startResize}
            onPointerMove={resize}
            onPointerCancel={stopResize}
            onPointerUp={stopResize}
            type="button"
          />
          {contentVisible ? (
            <m.div
              animate={{ opacity: 1 }}
              className="flex min-h-0 shrink-0 flex-col"
              initial={{ opacity: 0 }}
              style={{ width }}
              transition={{ duration: 0.08, ease: "linear" }}
            >
              <Tabs.Root className="flex min-h-0 flex-1 flex-col" defaultValue="changes">
                <div className="flex h-9 shrink-0 items-center border-hairline border-b px-2">
                  <Tabs.List className="relative flex min-w-0 flex-1 items-center gap-0.5">
                    {TABS.map((tab) => (
                      <Tooltip content={tab.label} key={tab.value} side="bottom" sideOffset={6}>
                        <Tabs.Tab
                          aria-label={tab.label}
                          className={cn(
                            "relative z-10 flex size-7 items-center justify-center rounded-md text-sm font-normal transition-colors outline-none",
                            "text-fg-subtle hover:bg-hover hover:text-fg-muted data-selected:text-fg",
                          )}
                          value={tab.value}
                        >
                          {tab.icon}
                        </Tabs.Tab>
                      </Tooltip>
                    ))}
                    <Tabs.Indicator className="absolute top-1/2 left-0 z-0 h-7 w-(--active-tab-width) -translate-y-1/2 translate-x-(--active-tab-left) rounded-md bg-active transition-all duration-200 ease-out-quint" />
                  </Tabs.List>
                  <div className="ml-1 flex shrink-0 items-center gap-0.5">
                    <InspectorIconButton label="More">
                      <IconDots size={15} stroke={1.65} />
                    </InspectorIconButton>
                    <InspectorIconButton
                      label="Collapse right panel"
                      onClick={() => onOpenChange(false)}
                    >
                      <IconLayoutSidebarRight size={15} stroke={1.65} />
                    </InspectorIconButton>
                  </div>
                </div>

                <Tabs.Panel className="min-h-0 flex-1 outline-none" value="changes">
                  <DiffPanel cwd={activeWorkspace?.rootPath} />
                </Tabs.Panel>
                <Tabs.Panel className="min-h-0 flex-1 outline-none" value="terminal">
                  <TerminalPanel
                    cwd={activeWorkspace?.rootPath}
                    workspaceId={activeWorkspace?.id}
                  />
                </Tabs.Panel>
                <Tabs.Panel className="min-h-0 flex-1 outline-none" value="worktrees">
                  <WorktreesPanel cwd={activeWorkspace?.rootPath} />
                </Tabs.Panel>
                <Tabs.Panel
                  className="scroll-thin min-h-0 flex-1 overflow-y-auto outline-none"
                  value="security"
                >
                  <SecurityPanel securityState={securityState} />
                </Tabs.Panel>
              </Tabs.Root>
            </m.div>
          ) : null}
        </>
      ) : null}
    </m.aside>
  );
}

function InspectorIconButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <Tooltip content={label} side="bottom">
      <button
        aria-label={label}
        className="flex size-7 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg-subtle"
        onClick={onClick}
        type="button"
      >
        {children}
      </button>
    </Tooltip>
  );
}

function WorktreesPanel({ cwd }: { cwd?: string | undefined }) {
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (target: string | undefined): Promise<void> => {
    if (!target) {
      setWorktrees([]);
      return;
    }
    try {
      setWorktrees(await window.modus.worktree.list(target));
    } catch {
      setWorktrees([]);
    }
  }, []);

  useEffect(() => {
    void refresh(cwd);
  }, [cwd, refresh]);

  async function createWorktree(): Promise<void> {
    if (!cwd) {
      return;
    }
    setBusy(true);
    try {
      await window.modus.worktree.create({ cwd, taskId: `task-${Date.now().toString(36)}` });
      await refresh(cwd);
    } finally {
      setBusy(false);
    }
  }

  async function removeWorktree(path: string): Promise<void> {
    if (!cwd) {
      return;
    }
    await window.modus.worktree.delete({ cwd, path });
    await refresh(cwd);
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Worktrees">
        <button
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-subtle transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
          disabled={!cwd || busy}
          onClick={() => void createWorktree()}
          type="button"
        >
          <IconPlus size={15} stroke={1.65} /> New
        </button>
      </PanelHeader>
      <div className="scroll-thin flex-1 space-y-1.5 overflow-y-auto p-3">
        {worktrees.length === 0 ? (
          <EmptyState
            hint={
              cwd ? "No worktrees yet. Create one to isolate an agent task." : "Open a workspace."
            }
            icon={<IconVersions size={22} stroke={1.5} />}
          />
        ) : (
          worktrees.map((worktree) => (
            <div
              className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-hover"
              key={worktree.path}
            >
              <IconGitBranch className="shrink-0 text-fg-subtle" size={15} stroke={1.6} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-fg">{worktree.branch}</div>
                <div className="truncate font-mono text-2xs text-fg-faint">{worktree.path}</div>
              </div>
              <span className="shrink-0 font-mono text-2xs text-fg-faint">
                {worktree.head.slice(0, 7)}
              </span>
              <button
                aria-label="Delete worktree"
                className="shrink-0 rounded-md p-1 text-fg-faint opacity-0 transition-all hover:text-danger group-hover:opacity-100"
                onClick={() => void removeWorktree(worktree.path)}
                type="button"
              >
                <IconTrash size={14} stroke={1.6} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SecurityPanel({ securityState }: { securityState: SecurityState | null }) {
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Security" />
      <div className="space-y-0.5 px-2 py-1">
        {securityState ? (
          Object.entries(securityState).map(([key, value]) => (
            <div
              className="flex items-center justify-between rounded-lg px-2.5 py-2 transition-colors hover:bg-hover"
              key={key}
            >
              <span className="font-mono text-xs text-fg-muted">{key}</span>
              <span
                className={cn(
                  "flex items-center gap-1.5 text-2xs",
                  value ? "text-fg-subtle" : "text-danger",
                )}
              >
                {value ? (
                  <IconShieldCheck size={15} stroke={1.6} />
                ) : (
                  <IconShieldX size={15} stroke={1.6} />
                )}
                {value ? "enforced" : "off"}
              </span>
            </div>
          ))
        ) : (
          <div className="px-2.5 py-2 text-sm text-fg-subtle">Loading preload IPC state…</div>
        )}
      </div>
    </div>
  );
}
