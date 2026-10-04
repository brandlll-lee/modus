import { Menu } from "@base-ui/react/menu";
import { IconCheck } from "@tabler/icons-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { GitBranchSummary } from "../../../../shared/contracts";
import { ShinyText } from "../../components/ui/ShinyText";

type BranchSwitcherProps = {
  /** Repo working dir whose branches are listed / checked out. Undefined → disabled. */
  cwd: string | undefined;
  /** Trigger inner content (icon + label + chevron). The host styles its own surface. */
  children: ReactNode;
  /** Tailwind classes for the trigger button so each surface keeps its own look. */
  triggerClassName: string;
  align?: "start" | "end";
  /** Force-disable independent of cwd (e.g. while a parent action is busy). */
  disabled?: boolean;
  /** Surface a failed checkout (uncommitted changes, etc.) to the host UI. */
  onError?: (message: string) => void;
};

export function BranchSwitcher({
  cwd,
  children,
  triggerClassName,
  align = "start",
  disabled = false,
  onError,
}: BranchSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [branchState, setBranchState] = useState<
    { cwd: string; summary: GitBranchSummary } | undefined
  >();
  const [busy, setBusy] = useState<string | undefined>();
  const branches = branchState && branchState.cwd === cwd ? branchState.summary : undefined;

  const refreshBranches = useCallback(
    async (targetCwd: string, active: () => boolean = () => true) => {
      try {
        const summary = await window.modus.git.branches(targetCwd);
        if (active()) setBranchState({ cwd: targetCwd, summary });
      } catch {
        if (active()) setBranchState({ cwd: targetCwd, summary: { local: [], remote: [] } });
      }
    },
    [],
  );

  useEffect(() => {
    if (!open || !cwd) {
      return;
    }
    let active = true;
    void refreshBranches(cwd, () => active);
    return () => {
      active = false;
    };
  }, [open, cwd, refreshBranches]);

  const switchTo = useCallback(
    async (name: string): Promise<void> => {
      if (!cwd) {
        return;
      }
      setBusy(name);
      try {
        await window.modus.git.checkout({ cwd, name });
      } catch (cause) {
        onError?.(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(undefined);
      }
    },
    [cwd, onError],
  );

  const locals = branches?.local ?? [];

  return (
    <Menu.Root onOpenChange={setOpen} open={open}>
      <Menu.Trigger className={triggerClassName} disabled={disabled || !cwd}>
        {children}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align={align} side="bottom" sideOffset={6}>
          <Menu.Popup className="scroll-thin origin-(--transform-origin) max-h-[320px] min-w-[240px] overflow-y-auto popup-chrome p-1">
            {locals.length === 0 ? (
              <div className="px-2.5 py-3 text-center text-2xs text-fg-faint">
                {branches ? "No branches" : "Loading…"}
              </div>
            ) : (
              locals.map((branch) => (
                <Menu.Item
                  className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-fg text-sm outline-none transition-colors select-none data-highlighted:bg-hover"
                  closeOnClick={!branch.current}
                  key={branch.name}
                  onClick={() => {
                    if (branch.current) {
                      return;
                    }
                    void switchTo(branch.name);
                  }}
                  title={branch.worktreePath}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center text-accent">
                    {branch.current ? <IconCheck size={14} stroke={2} /> : null}
                  </span>
                  {busy === branch.name ? (
                    <ShinyText className="min-w-0 flex-1 truncate">{branch.name}</ShinyText>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{branch.name}</span>
                  )}
                  {branch.current ? (
                    <span className="shrink-0 text-2xs text-fg-faint">current</span>
                  ) : branch.worktreePath ? (
                    <span className="shrink-0 text-2xs text-fg-faint">worktree</span>
                  ) : null}
                </Menu.Item>
              ))
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
