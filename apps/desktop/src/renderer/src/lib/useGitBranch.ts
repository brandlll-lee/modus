import { useEffect, useState } from "react";
import type { GitBranchSummary, GitChangeEvent } from "../../../shared/contracts";

/**
 * Live current-branch name for a workspace, read from the same authoritative
 * branch listing the branch switcher uses (`git.branches().current`) — never
 * inferred, and never via the heavyweight working-tree status. One source of
 * truth means the top-bar label can never disagree with the switcher's
 * checkmark. The value is dropped the instant `cwd` changes, so a freshly
 * selected workspace never briefly shows the previous one's branch while the
 * read is in flight. Subscribes to the debounced repo watcher, so a checkout or
 * commit elsewhere repaints the label without a manual refresh. Returns
 * `undefined` when there is no repo or HEAD is detached.
 */
export function useGitBranch(cwd: string | undefined): string | undefined {
  const [branch, setBranch] = useState<string | undefined>();

  useEffect(() => {
    // Clear the prior workspace's branch up front: the label must reflect the
    // current cwd, never lag on stale state across a switch.
    setBranch(undefined);
    if (!cwd) {
      return;
    }
    let active = true;
    const load = (): void => {
      void window.modus.git
        .branches(cwd)
        .then((summary: GitBranchSummary) => {
          if (active) setBranch(summary.current);
        })
        .catch(() => {
          if (active) setBranch(undefined);
        });
    };
    load();

    let watchedRoot: string | undefined;
    void window.modus.git.watch(cwd).then((root: string | undefined) => {
      watchedRoot = root ?? undefined;
    });
    const off = window.modus.git.onChanged((event: GitChangeEvent) => {
      if (!watchedRoot || event.cwd === watchedRoot) {
        load();
      }
    });

    return () => {
      active = false;
      off();
      void window.modus.git.unwatch(cwd);
    };
  }, [cwd]);

  return branch;
}
