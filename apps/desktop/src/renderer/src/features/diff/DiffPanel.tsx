import { Menu } from "@base-ui/react/menu";
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconDots,
  IconFileDiff,
  IconFolderOpen,
  IconGitBranch,
  IconGitCommit,
  IconList,
  IconListTree,
  IconRefresh,
  IconReportSearch,
  IconRotateClockwise,
} from "@tabler/icons-react";
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FileChange,
  FileChangeStat,
  GitChangeEvent,
  GitCommit,
  GitStatusSummary,
} from "../../../../shared/contracts";
import { triggerFindInActiveDiff } from "../../components/code/DiffViewer";
import { CollapsibleMotion } from "../../components/ui/CollapsibleMotion";
import { EmptyState } from "../../components/ui/Panel";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";
import { materialIconForFile } from "../files/fileIcons";
import { BranchSwitcher } from "../git/BranchSwitcher";
import { CommitDialog } from "./CommitDialog";
import {
  CHANGE_SCOPES,
  type ChangeBadge,
  type ChangeScope,
  changeBadge,
  filterByScope,
  SCOPE_META,
  splitPath,
} from "./changeScopes";
import { FileDiffPreview } from "./FileDiffPreview";
import { buildChangeTree, type ChangeTreeNode } from "./fileTree";

type DiffPanelProps = {
  cwd?: string | undefined;
  sessionId?: string | undefined;
  workspaceId?: string | undefined;
};

type LineStat = { added: number; removed: number };

/** Sticky string/boolean preference shared across sessions. */
function usePersistentState<T extends string | boolean>(
  key: string,
  fallback: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return (typeof fallback === "boolean" ? raw === "true" : raw) as T;
  });
  const set = useCallback(
    (next: T) => {
      localStorage.setItem(key, String(next));
      setValue(next);
    },
    [key],
  );
  return [value, set];
}

export function DiffPanel({ cwd, sessionId, workspaceId }: DiffPanelProps) {
  const [scope, setScope] = usePersistentState<ChangeScope>("modus.changes.scope", "uncommitted");
  const [layout, setLayout] = usePersistentState<"split" | "unified">(
    "modus.changes.layout",
    "unified",
  );
  const [treeView, setTreeView] = usePersistentState<boolean>("modus.changes.treeView", false);
  const [ignoreWhitespace, setIgnoreWhitespace] = usePersistentState<boolean>(
    "modus.diff.ignoreWhitespace",
    false,
  );
  const sideBySide = layout === "split";

  const [changes, setChanges] = useState<FileChange[]>([]);
  const [statsByPath, setStatsByPath] = useState<Map<string, LineStat>>(new Map());
  const [status, setStatus] = useState<GitStatusSummary | undefined>();
  const [isRepository, setIsRepository] = useState<boolean | undefined>();
  const [initializingRepository, setInitializingRepository] = useState(false);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [commitFiles, setCommitFiles] = useState<Record<string, FileChange[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
  // Surfaces a failed stage/unstage/discard/revert so it is never a silent no-op.
  const [actionError, setActionError] = useState<string | undefined>();
  const [refreshToken, setRefreshToken] = useState(0);
  const [linkedWorktree, setLinkedWorktree] = useState<
    { rootCwd: string | undefined; cwd: string; branch: string } | undefined
  >();
  const visibleLinkedWorktree =
    normalizePath(linkedWorktree?.rootCwd) === normalizePath(cwd) ? linkedWorktree : undefined;
  const activeCwd = visibleLinkedWorktree?.cwd ?? cwd;

  const refresh = useCallback(async (targetCwd: string | undefined): Promise<void> => {
    if (!targetCwd) {
      setChanges([]);
      setStatsByPath(new Map());
      setStatus(undefined);
      setIsRepository(undefined);
      setCommits([]);
      setCommitFiles({});
      setExpanded(new Set());
      setExpandedCommits(new Set());
      return;
    }
    const repository = await window.modus.git.isRepository(targetCwd);
    setIsRepository(repository);
    if (!repository) {
      setChanges([]);
      setStatsByPath(new Map());
      setStatus(undefined);
      setCommits([]);
      setCommitFiles({});
      setExpanded(new Set());
      setExpandedCommits(new Set());
      return;
    }
    const [list, stats, st, log] = await Promise.all([
      window.modus.diff.list(targetCwd),
      window.modus.diff.stats(targetCwd),
      window.modus.diff.status(targetCwd).catch(() => undefined),
      window.modus.git.log({ cwd: targetCwd }).catch(() => [] as GitCommit[]),
    ]);
    setExpanded((prev) =>
      pruneExpandedKeys(
        prev,
        list.map((change: FileChange) => change.path),
      ),
    );
    setExpandedCommits((prev) =>
      pruneExpandedKeys(
        prev,
        log.map((commit: GitCommit) => commit.hash),
      ),
    );
    setCommitFiles((prev) =>
      pruneRecordKeys(
        prev,
        log.map((commit: GitCommit) => commit.hash),
      ),
    );
    setChanges(list);
    setStatsByPath(
      new Map(
        stats.files.map((f: FileChangeStat) => [f.path, { added: f.added, removed: f.removed }]),
      ),
    );
    setStatus(st);
    setCommits(log);
    setRefreshToken((token) => token + 1);
  }, []);

  useEffect(() => {
    void refresh(activeCwd);
  }, [activeCwd, refresh]);

  // Live refresh: watch the repo and refresh on debounced on-disk changes
  // (agent edits, terminal commits, external git ops) — no manual refresh.
  useEffect(() => {
    if (!activeCwd || isRepository === false) return;
    let watchedRoot: string | undefined;
    void window.modus.git.watch(activeCwd).then((root: string | undefined) => {
      watchedRoot = root ?? undefined;
    });
    const off = window.modus.git.onChanged((event: GitChangeEvent) => {
      if (!watchedRoot || event.cwd === watchedRoot) {
        void refresh(activeCwd);
      }
    });
    return () => {
      off();
      void window.modus.git.unwatch(activeCwd);
    };
  }, [activeCwd, isRepository, refresh]);

  const meta = SCOPE_META[scope];
  const scopeFiles = useMemo(
    () => (meta.commitHistory ? [] : filterByScope(changes, scope)),
    [changes, scope, meta.commitHistory],
  );

  // Build the tree once per change set — not on every expand/collapse (which
  // only flips a Set in state and would otherwise re-run this in render).
  const changeTree = useMemo(
    () => (treeView && !meta.commitHistory ? buildChangeTree(scopeFiles) : []),
    [treeView, meta.commitHistory, scopeFiles],
  );

  const totals = useMemo(
    () =>
      scopeFiles.reduce(
        (acc, change) => {
          const stat = statsByPath.get(change.path);
          return {
            added: acc.added + (stat?.added ?? 0),
            removed: acc.removed + (stat?.removed ?? 0),
          };
        },
        { added: 0, removed: 0 },
      ),
    [scopeFiles, statsByPath],
  );

  const count = meta.commitHistory ? commits.length : scopeFiles.length;

  const discardChange = useCallback(
    async (path: string): Promise<void> => {
      if (!activeCwd) return;
      setActionError(undefined);
      try {
        await window.modus.diff.discard({ cwd: activeCwd, path });
      } catch (cause) {
        setActionError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        await refresh(activeCwd);
      }
    },
    [activeCwd, refresh],
  );

  async function toggleCommit(hash: string): Promise<void> {
    setExpandedCommits((prev) => toggleKey(prev, hash));
    if (!activeCwd || commitFiles[hash]) return;
    setActionError(undefined);
    try {
      const files = await window.modus.diff.commitChanges({ cwd: activeCwd, commit: hash });
      setCommitFiles((prev) => ({ ...prev, [hash]: files }));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
      setExpandedCommits((prev) => {
        const next = new Set(prev);
        next.delete(hash);
        return next;
      });
    }
  }

  const toggleFile = useCallback((key: string) => {
    setExpanded((prev) => toggleKey(prev, key));
  }, []);

  const cwdLabel = activeCwd?.split(/[\\/]/).filter(Boolean).at(-1) ?? "workspace";
  const onCommitRefresh = useCallback(() => refresh(activeCwd), [activeCwd, refresh]);

  async function initializeRepository(): Promise<void> {
    if (!activeCwd) return;
    setActionError(undefined);
    setInitializingRepository(true);
    try {
      await window.modus.git.init(activeCwd);
      await refresh(activeCwd);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInitializingRepository(false);
    }
  }

  // Panel-scoped Ctrl+R / Ctrl+F. Bound on the section node (events bubble up
  // from the focused child), so it only fires when the user is inside the
  // Changes panel — never hijacks the keys globally.
  const sectionRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    const handler = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "r") {
        event.preventDefault();
        void refresh(activeCwd);
      } else if (key === "f" && triggerFindInActiveDiff()) {
        event.preventDefault();
      }
    };
    node.addEventListener("keydown", handler);
    return () => node.removeEventListener("keydown", handler);
  }, [activeCwd, refresh]);

  return (
    <section className="flex h-full min-h-0 flex-col" ref={sectionRef}>
      {activeCwd && isRepository ? (
        <ReviewToolbar
          added={totals.added}
          branch={status?.branch}
          count={count}
          cwd={activeCwd}
          linkedWorktree={visibleLinkedWorktree}
          onBackToMain={() => setLinkedWorktree(undefined)}
          onError={setActionError}
          onRefresh={onCommitRefresh}
          onScope={setScope}
          onToggleTree={() => setTreeView(!treeView)}
          onWorktreeBranch={(worktreeCwd, branch) => {
            setActionError(undefined);
            setLinkedWorktree(
              normalizePath(worktreeCwd) === normalizePath(cwd)
                ? undefined
                : { rootCwd: cwd, cwd: worktreeCwd, branch },
            );
          }}
          removed={totals.removed}
          scope={scope}
          showStats={!meta.commitHistory}
          status={status}
          treeView={treeView}
        >
          <OverflowMenu
            ignoreWhitespace={ignoreWhitespace}
            layout={layout}
            onCollapseAll={() => {
              setExpanded(new Set());
              setExpandedCommits(new Set());
            }}
            onFind={() => triggerFindInActiveDiff()}
            onRefresh={() => void refresh(activeCwd)}
            onReview={() => void startReview(activeCwd, sessionId, workspaceId)}
            onSetLayout={setLayout}
            onToggleWhitespace={() => setIgnoreWhitespace(!ignoreWhitespace)}
          />
        </ReviewToolbar>
      ) : null}

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto py-1">
        {actionError ? (
          <button
            className="mb-1.5 flex w-full items-start gap-2 rounded-lg bg-danger/8 px-3 py-2 text-left text-danger text-xs"
            onClick={() => setActionError(undefined)}
            title="Dismiss"
            type="button"
          >
            <IconAlertTriangle className="mt-0.5 shrink-0" size={13} stroke={1.8} />
            <span className="min-w-0 flex-1 wrap-break-word">{actionError}</span>
          </button>
        ) : null}

        {status?.mergeInProgress ? (
          <div className="mb-1.5 flex items-start gap-2 rounded-lg bg-danger/8 px-3 py-2 text-danger text-xs">
            <IconAlertTriangle className="mt-0.5 shrink-0" size={13} stroke={1.8} />
            <span className="min-w-0 flex-1 wrap-break-word">
              Merge in progress
              {status.conflictFiles.length
                ? `: ${status.conflictFiles.slice(0, 4).join(", ")}${status.conflictFiles.length > 4 ? `, +${status.conflictFiles.length - 4}` : ""}`
                : ". Commit or abort before applying another worktree."}
            </span>
          </div>
        ) : null}

        {activeCwd && isRepository === false ? (
          <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-3 px-6 text-center">
            <IconGitBranch className="text-fg-faint" size={22} stroke={1.4} />
            <span className="text-fg-subtle text-xs">Use Git to track changes</span>
            <button
              className="rounded-md border-hairline px-3 py-1.5 text-fg text-xs transition-colors hover:bg-hover disabled:opacity-50"
              disabled={initializingRepository}
              onClick={() => void initializeRepository()}
              type="button"
            >
              {initializingRepository ? "Initializing..." : "Initialize Repository"}
            </button>
          </div>
        ) : count === 0 ? (
          <EmptyState
            className={activeCwd ? "min-h-[220px]" : "h-full"}
            hint={
              activeCwd
                ? meta.commitHistory
                  ? `No commits in ${cwdLabel}`
                  : `No ${meta.noun} Changes in ${cwdLabel}`
                : "Open a workspace to review changes."
            }
            icon={<IconFileDiff size={22} stroke={1.4} />}
          />
        ) : meta.commitHistory ? (
          commits.map((commit) => (
            <CommitRow
              commit={commit}
              cwd={activeCwd ?? ""}
              expanded={expandedCommits.has(commit.hash)}
              expandedFiles={expanded}
              files={commitFiles[commit.hash]}
              ignoreWhitespace={ignoreWhitespace}
              key={commit.hash}
              onToggle={() => void toggleCommit(commit.hash)}
              onToggleFile={toggleFile}
              refreshToken={refreshToken}
              sideBySide={sideBySide}
            />
          ))
        ) : treeView ? (
          <TreeRows
            cwd={activeCwd ?? ""}
            depth={0}
            expanded={expanded}
            ignoreWhitespace={ignoreWhitespace}
            nodes={changeTree}
            onDiscard={discardChange}
            onToggleFile={toggleFile}
            refreshToken={refreshToken}
            sideBySide={sideBySide}
            statsByPath={statsByPath}
          />
        ) : (
          scopeFiles.map((change) => (
            <ChangeRow
              change={change}
              cwd={activeCwd ?? ""}
              display="full"
              expanded={expanded.has(change.path)}
              ignoreWhitespace={ignoreWhitespace}
              key={`${change.status}:${change.path}`}
              onDiscard={discardChange}
              onToggle={toggleFile}
              refreshToken={refreshToken}
              rowKey={change.path}
              sideBySide={sideBySide}
              stat={statsByPath.get(change.path)}
            />
          ))
        )}
      </div>
    </section>
  );
}

async function startReview(
  cwd: string | undefined,
  sessionId: string | undefined,
  workspaceId: string | undefined,
): Promise<void> {
  if (!cwd) return;
  await window.modus.review.start({ cwd, sessionId, workspaceId });
}

export function toggleKey(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function pruneExpandedKeys(set: Set<string>, validKeys: Iterable<string>): Set<string> {
  const valid = new Set(validKeys);
  const next = new Set([...set].filter((key) => valid.has(key)));
  return next.size === set.size ? set : next;
}

export function pruneRecordKeys<T>(record: Record<string, T>, validKeys: Iterable<string>) {
  const valid = new Set(validKeys);
  const next = Object.fromEntries(Object.entries(record).filter(([key]) => valid.has(key)));
  return Object.keys(next).length === Object.keys(record).length ? record : next;
}

function normalizePath(path: string | undefined): string {
  return (path ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function ReviewToolbar({
  scope,
  count,
  added,
  removed,
  showStats,
  branch,
  cwd,
  status,
  treeView,
  linkedWorktree,
  onScope,
  onToggleTree,
  onRefresh,
  onError,
  onWorktreeBranch,
  onBackToMain,
  children,
}: {
  scope: ChangeScope;
  count: number;
  added: number;
  removed: number;
  showStats: boolean;
  branch: string | undefined;
  cwd: string;
  status: GitStatusSummary | undefined;
  treeView: boolean;
  linkedWorktree: { cwd: string; branch: string } | undefined;
  onScope(scope: ChangeScope): void;
  onToggleTree(): void;
  onRefresh(): void;
  onError(message: string): void;
  onWorktreeBranch(path: string, branch: string): void;
  onBackToMain(): void;
  children: ReactNode;
}) {
  return (
    <div
      aria-label="Git review toolbar"
      className="toolbar-row flex shrink-0 items-center gap-2 border-hairline-soft border-b px-3"
      role="toolbar"
    >
      <Menu.Root>
        <Menu.Trigger className="flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-fg text-sm outline-none transition-colors hover:bg-hover data-popup-open:bg-hover">
          <span>{SCOPE_META[scope].label}</span>
          <span className="rounded-full bg-chip px-1.5 py-px text-2xs text-fg-muted tabular-nums">
            {count}
          </span>
          <IconChevronDown className="text-fg-faint" size={13} stroke={1.8} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="start" side="bottom" sideOffset={6}>
            <Menu.Popup className="origin-(--transform-origin) min-w-[170px] rounded-lg border border-hairline bg-elevated p-1 shadow-popup">
              {CHANGE_SCOPES.map((value) => (
                <MenuChoice checked={scope === value} key={value} onClick={() => onScope(value)}>
                  {SCOPE_META[value].label}
                </MenuChoice>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {showStats && (added > 0 || removed > 0) ? (
        <span className="flex items-center gap-1.5 font-mono text-xs tabular-nums">
          <span className="text-success">+{added}</span>
          <span className="text-danger">-{removed}</span>
        </span>
      ) : null}
      <BranchSwitcher
        cwd={cwd}
        onAfterSwitch={onRefresh}
        onError={onError}
        onWorktreeBranch={onWorktreeBranch}
        triggerClassName="ml-1 flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm outline-none transition-colors hover:bg-hover data-popup-open:bg-hover"
      >
        <IconGitBranch className="toolbar-icon shrink-0" size={16} stroke={1.7} />
        <span className="max-w-[150px] truncate text-fg">{branch ?? "detached"}</span>
        <IconChevronDown className="toolbar-icon shrink-0" size={14} stroke={1.8} />
      </BranchSwitcher>
      {linkedWorktree ? (
        <span className="flex min-w-0 items-center gap-1 rounded-full bg-chip px-2 py-1 text-fg-subtle text-xs">
          <span className="min-w-0 max-w-[180px] truncate">worktree: {linkedWorktree.branch}</span>
          <button
            className="rounded-full px-1 text-fg-muted transition-colors hover:bg-hover hover:text-fg"
            onClick={onBackToMain}
            type="button"
          >
            Back
          </button>
        </span>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Tooltip content={treeView ? "View as list" : "View as tree"} side="bottom" sideOffset={6}>
          <button
            aria-label={treeView ? "View as list" : "View as tree"}
            aria-pressed={treeView}
            className="toolbar-icon-button flex items-center justify-center rounded-md transition-colors hover:bg-hover"
            onClick={onToggleTree}
            type="button"
          >
            {treeView ? (
              <IconListTree size={18} stroke={1.7} />
            ) : (
              <IconList size={18} stroke={1.7} />
            )}
          </button>
        </Tooltip>
        <CommitLauncher cwd={cwd} onRefresh={onRefresh} status={status} />
        <Tooltip content="Refresh changes" side="bottom" sideOffset={6}>
          <button
            aria-label="Refresh changes"
            className="toolbar-icon-button flex items-center justify-center rounded-md transition-colors hover:bg-hover"
            onClick={onRefresh}
            type="button"
          >
            <IconRefresh size={18} stroke={1.7} />
          </button>
        </Tooltip>
        {children}
      </div>
    </div>
  );
}

/**
 * Owns the commit dialog open state in an isolated, memoized subtree so toggling
 * it never re-renders the (potentially large) change list.
 */
const CommitLauncher = memo(function CommitLauncher({
  cwd,
  status,
  onRefresh,
}: {
  cwd: string | undefined;
  status: GitStatusSummary | undefined;
  onRefresh(): void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const ahead = status?.ahead ?? 0;
  return (
    <>
      <button
        className="flex h-8 items-center gap-1.5 rounded-md border border-hairline bg-surface px-2.5 text-fg text-sm transition-colors hover:bg-hover disabled:opacity-40"
        disabled={!cwd}
        onClick={() => setOpen(true)}
        type="button"
      >
        <IconGitCommit className="toolbar-icon" size={17} stroke={1.7} />
        Commit or push{ahead ? ` ${ahead}` : ""}
      </button>
      <CommitDialog
        cwd={cwd}
        onOpenChange={setOpen}
        onRefresh={onRefresh}
        open={open}
        status={status}
      />
    </>
  );
});

/* ── The "⋯" menu (Figure 5): layout · whitespace · find · collapse · refresh ─ */

function OverflowMenu({
  layout,
  ignoreWhitespace,
  onSetLayout,
  onToggleWhitespace,
  onFind,
  onCollapseAll,
  onRefresh,
  onReview,
}: {
  layout: "split" | "unified";
  ignoreWhitespace: boolean;
  onSetLayout(layout: "split" | "unified"): void;
  onToggleWhitespace(): void;
  onFind(): void;
  onCollapseAll(): void;
  onRefresh(): void;
  onReview(): void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Changes options"
        className="flex size-6 items-center justify-center rounded-md text-fg-faint outline-none transition-colors hover:bg-hover hover:text-fg-subtle data-popup-open:bg-hover"
      >
        <IconDots size={16} stroke={1.8} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" side="bottom" sideOffset={6}>
          <Menu.Popup className="origin-(--transform-origin) min-w-[220px] rounded-lg border border-hairline bg-elevated p-1 shadow-popup">
            <Menu.SubmenuRoot>
              <Menu.SubmenuTrigger className="flex cursor-default items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-fg text-sm outline-none select-none data-highlighted:bg-hover data-popup-open:bg-hover">
                Layout
                <span className="flex items-center gap-1 text-fg-faint text-xs">
                  {layout === "split" ? "Split" : "Unified"}
                  <IconChevronRight size={13} stroke={1.7} />
                </span>
              </Menu.SubmenuTrigger>
              <Menu.Portal>
                <Menu.Positioner align="start" side="right" sideOffset={4}>
                  <Menu.Popup className="origin-(--transform-origin) min-w-[150px] rounded-lg border border-hairline bg-elevated p-1 shadow-popup">
                    <MenuChoice
                      checked={layout === "unified"}
                      onClick={() => onSetLayout("unified")}
                    >
                      Unified
                    </MenuChoice>
                    <MenuChoice checked={layout === "split"} onClick={() => onSetLayout("split")}>
                      Split
                    </MenuChoice>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.SubmenuRoot>

            <Menu.Item
              className="flex cursor-default items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-fg text-sm outline-none select-none data-highlighted:bg-hover"
              closeOnClick={false}
              onClick={onToggleWhitespace}
            >
              Ignore Whitespace
              <span
                className={cn(
                  "flex h-4 w-7 items-center rounded-full p-0.5 transition-colors",
                  ignoreWhitespace ? "bg-accent" : "bg-chip-strong",
                )}
              >
                <span
                  className={cn(
                    "size-3 rounded-full bg-white transition-transform",
                    ignoreWhitespace && "translate-x-3",
                  )}
                />
              </span>
            </Menu.Item>

            <div className="my-1 h-px bg-hairline" />

            <MenuAction onClick={onFind} shortcut="Ctrl+F">
              Find in Diff
            </MenuAction>
            <MenuAction onClick={onCollapseAll}>Collapse All</MenuAction>
            <MenuAction onClick={onRefresh} shortcut="Ctrl+R">
              Refresh Changes
            </MenuAction>

            <div className="my-1 h-px bg-hairline" />

            <MenuAction icon={<IconReportSearch size={15} stroke={1.7} />} onClick={onReview}>
              Review with Agent
            </MenuAction>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function MenuAction({
  children,
  onClick,
  shortcut,
  icon,
}: {
  children: ReactNode;
  onClick(): void;
  shortcut?: string;
  icon?: ReactNode;
}) {
  return (
    <Menu.Item
      className="flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 text-fg text-sm outline-none select-none data-highlighted:bg-hover"
      onClick={onClick}
    >
      {icon ? <span className="flex size-4 items-center justify-center">{icon}</span> : null}
      <span className="flex-1">{children}</span>
      {shortcut ? <span className="text-2xs text-fg-faint">{shortcut}</span> : null}
    </Menu.Item>
  );
}

function MenuChoice({
  children,
  checked,
  onClick,
}: {
  children: ReactNode;
  checked: boolean;
  onClick(): void;
}) {
  return (
    <Menu.Item
      className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-fg text-sm outline-none select-none data-highlighted:bg-hover"
      onClick={onClick}
    >
      <span className="flex size-4 items-center justify-center text-accent">
        {checked ? <IconCheck size={14} stroke={2} /> : null}
      </span>
      {children}
    </Menu.Item>
  );
}

/* ── File row: icon · path · badge/±  · hover copy + discard ── */

const ChangeRow = memo(function ChangeRow({
  change,
  cwd,
  display,
  depth = 0,
  expanded,
  rowKey,
  onToggle,
  onDiscard,
  stat,
  commit,
  sideBySide,
  ignoreWhitespace,
  refreshToken,
}: {
  change: FileChange;
  cwd: string;
  /** "full" shows the dimmed dir prefix; "name" shows only the file name (tree mode). */
  display: "full" | "name";
  depth?: number;
  expanded: boolean;
  /** Stable expand key: the path, or `${hash}:${path}` under a commit. */
  rowKey: string;
  onToggle(key: string): void;
  /** Discard a working-tree change. Absent for commit-history rows (read-only). */
  onDiscard?: (path: string) => void;
  stat?: LineStat | undefined;
  commit?: string | undefined;
  sideBySide: boolean;
  ignoreWhitespace: boolean;
  refreshToken: number;
}) {
  const { dir, name } = splitPath(change.path);
  const badge = changeBadge(change);

  return (
    <div className="border-hairline-soft border-b">
      <div
        className={cn(
          "group/row flex h-10 w-full items-center gap-2 pr-3 text-left text-sm transition-colors",
          expanded ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
        )}
        style={{ paddingLeft: 12 + depth * 16 }}
      >
        <button
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => onToggle(rowKey)}
          type="button"
        >
          <span className="flex size-4 shrink-0 items-center justify-center text-fg-faint">
            {expanded ? (
              <IconChevronDown size={13} stroke={1.7} />
            ) : (
              <IconChevronRight size={13} stroke={1.7} />
            )}
          </span>
          <ChangeFileIcon path={change.path} />
          <span className="min-w-0 flex-1 truncate">
            {display === "full" && dir ? <span className="text-fg-faint">{dir}</span> : null}
            <span>{name}</span>
          </span>
          <ChangeMeta badge={badge} stat={stat} />
        </button>

        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
          <IconBtn
            label="Copy path"
            onClick={() => void navigator.clipboard.writeText(change.path)}
          >
            <IconCopy size={13} stroke={1.7} />
          </IconBtn>
          {onDiscard ? (
            <Tooltip
              content={change.untracked ? "New file — delete manually" : "Discard changes"}
              side="bottom"
              sideOffset={6}
            >
              <span>
                <IconBtn
                  disabled={Boolean(change.untracked)}
                  label="Discard changes"
                  onClick={() => onDiscard(change.path)}
                >
                  <IconRotateClockwise size={13} stroke={1.7} />
                </IconBtn>
              </span>
            </Tooltip>
          ) : null}
        </span>
      </div>
      {expanded ? (
        <FileDiffPreview
          change={change}
          commit={commit}
          cwd={cwd}
          ignoreWhitespace={ignoreWhitespace}
          refreshToken={refreshToken}
          sideBySide={sideBySide}
        />
      ) : null}
    </div>
  );
});

function ChangeFileIcon({ path }: { path: string }) {
  const iconUrl = materialIconForFile(path);
  return iconUrl ? (
    <img alt="" className="size-[18px] shrink-0" draggable={false} src={iconUrl} />
  ) : (
    <IconFileDiff className="toolbar-icon shrink-0" size={18} stroke={1.7} />
  );
}

/** Right-aligned per-row badge: change-type tag and/or ± line counts. */
function ChangeMeta({ badge, stat }: { badge: ChangeBadge; stat?: LineStat | undefined }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {badge === "new" ? (
        <span className="text-2xs text-success">New</span>
      ) : badge === "deleted" ? (
        <span className="text-2xs text-danger">Deleted</span>
      ) : badge === "renamed" ? (
        <span className="text-2xs text-fg-faint">Renamed</span>
      ) : badge === "copied" ? (
        <span className="text-2xs text-fg-faint">Copied</span>
      ) : null}
      {stat && (stat.added > 0 || stat.removed > 0) ? (
        <span className="flex items-center gap-1 font-mono text-xs">
          {stat.added > 0 ? <span className="text-success">+{stat.added}</span> : null}
          {stat.removed > 0 ? <span className="text-danger">-{stat.removed}</span> : null}
        </span>
      ) : null}
    </span>
  );
}

/* ── Commit row (All commits scope): subject · hash · author · relative date ── */

function CommitRow({
  commit,
  cwd,
  expanded,
  files,
  expandedFiles,
  onToggle,
  onToggleFile,
  sideBySide,
  ignoreWhitespace,
  refreshToken,
}: {
  commit: GitCommit;
  cwd: string;
  expanded: boolean;
  files: FileChange[] | undefined;
  expandedFiles: Set<string>;
  onToggle(): void;
  onToggleFile(key: string): void;
  sideBySide: boolean;
  ignoreWhitespace: boolean;
  refreshToken: number;
}) {
  return (
    <div className="border-hairline-soft border-b">
      <button
        className={cn(
          "flex h-11 w-full items-center gap-2 px-3 text-left text-sm transition-colors",
          expanded ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
        )}
        onClick={onToggle}
        type="button"
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-fg-faint">
          {expanded ? (
            <IconChevronDown size={13} stroke={1.7} />
          ) : (
            <IconChevronRight size={13} stroke={1.7} />
          )}
        </span>
        <span className="flex size-4 shrink-0 items-center justify-center text-fg-subtle">
          <IconGitCommit size={15} stroke={1.7} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-fg">{commit.subject}</span>
          <span className="truncate text-2xs text-fg-faint">
            {commit.author} · {commit.relativeDate}
          </span>
        </span>
        <span className="shrink-0 font-mono text-2xs text-fg-faint">{commit.shortHash}</span>
      </button>
      <CollapsibleMotion open={expanded} preset="default">
        {files === undefined ? (
          <div className="px-6 py-3 text-fg-faint text-xs">Loading files…</div>
        ) : files.length === 0 ? (
          <div className="px-6 py-3 text-fg-faint text-xs">No files changed.</div>
        ) : (
          files.map((file) => {
            const key = `${commit.hash}:${file.path}`;
            return (
              <ChangeRow
                change={file}
                commit={commit.hash}
                cwd={cwd}
                depth={1}
                display="full"
                expanded={expandedFiles.has(key)}
                ignoreWhitespace={ignoreWhitespace}
                key={key}
                onToggle={onToggleFile}
                refreshToken={refreshToken}
                rowKey={key}
                sideBySide={sideBySide}
              />
            );
          })
        )}
      </CollapsibleMotion>
    </div>
  );
}

/* ── Tree mode: recursive folder/file rows over the compacted change tree ── */

function TreeRows({
  nodes,
  cwd,
  depth,
  expanded,
  onToggleFile,
  onDiscard,
  statsByPath,
  sideBySide,
  ignoreWhitespace,
  refreshToken,
}: {
  nodes: ChangeTreeNode[];
  cwd: string;
  depth: number;
  expanded: Set<string>;
  onToggleFile(key: string): void;
  onDiscard(path: string): void;
  statsByPath: Map<string, LineStat>;
  sideBySide: boolean;
  ignoreWhitespace: boolean;
  refreshToken: number;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === "dir" ? (
          <TreeFolder
            cwd={cwd}
            depth={depth}
            expanded={expanded}
            ignoreWhitespace={ignoreWhitespace}
            key={`dir:${node.path}`}
            node={node}
            onDiscard={onDiscard}
            onToggleFile={onToggleFile}
            refreshToken={refreshToken}
            sideBySide={sideBySide}
            statsByPath={statsByPath}
          />
        ) : (
          <ChangeRow
            change={node.change}
            cwd={cwd}
            depth={depth}
            display="name"
            expanded={expanded.has(node.change.path)}
            ignoreWhitespace={ignoreWhitespace}
            key={`${node.change.status}:${node.change.path}`}
            onDiscard={onDiscard}
            onToggle={onToggleFile}
            refreshToken={refreshToken}
            rowKey={node.change.path}
            sideBySide={sideBySide}
            stat={statsByPath.get(node.change.path)}
          />
        ),
      )}
    </>
  );
}

function TreeFolder({
  node,
  cwd,
  depth,
  expanded,
  onToggleFile,
  onDiscard,
  statsByPath,
  sideBySide,
  ignoreWhitespace,
  refreshToken,
}: {
  node: Extract<ChangeTreeNode, { kind: "dir" }>;
  cwd: string;
  depth: number;
  expanded: Set<string>;
  onToggleFile(key: string): void;
  onDiscard(path: string): void;
  statsByPath: Map<string, LineStat>;
  sideBySide: boolean;
  ignoreWhitespace: boolean;
  refreshToken: number;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        className="group flex h-9 w-full items-center gap-2 pr-3 text-left text-fg-muted text-sm transition-colors hover:bg-hover hover:text-fg"
        onClick={() => setOpen((value) => !value)}
        style={{ paddingLeft: 12 + depth * 16 }}
        type="button"
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-fg-faint">
          {open ? (
            <IconChevronDown size={13} stroke={1.7} />
          ) : (
            <IconChevronRight size={13} stroke={1.7} />
          )}
        </span>
        <IconFolderOpen className="toolbar-icon shrink-0" size={18} stroke={1.7} />
        <span className="min-w-0 truncate">{node.name}</span>
      </button>
      <CollapsibleMotion open={open} preset="default">
        <TreeRows
          cwd={cwd}
          depth={depth + 1}
          expanded={expanded}
          ignoreWhitespace={ignoreWhitespace}
          nodes={node.children}
          onDiscard={onDiscard}
          onToggleFile={onToggleFile}
          refreshToken={refreshToken}
          sideBySide={sideBySide}
          statsByPath={statsByPath}
        />
      </CollapsibleMotion>
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: ReactNode;
  label: string;
  onClick(): void;
  disabled?: boolean;
}) {
  return (
    <button
      aria-label={label}
      className="toolbar-icon-button flex size-6 items-center justify-center rounded-md transition-colors hover:bg-active disabled:cursor-not-allowed disabled:opacity-30"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      type="button"
    >
      {children}
    </button>
  );
}
