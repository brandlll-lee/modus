import { Menu } from "@base-ui/react/menu";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconDeviceDesktop,
  IconDots,
  IconFileDiff,
  IconFolder,
  IconGitCommit,
  IconGitPullRequest,
  IconList,
  IconListTree,
  IconMinus,
  IconRefresh,
  IconReportSearch,
  IconRotateClockwise,
} from "@tabler/icons-react";
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FileChange,
  FileChangeStat,
  GitCommit,
  GitStatusSummary,
} from "../../../../shared/contracts";
import { triggerFindInActiveDiff } from "../../components/code/DiffViewer";
import { CollapsibleMotion } from "../../components/ui/CollapsibleMotion";
import { EmptyState, PanelHeader } from "../../components/ui/Panel";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";
import { CommitDialog } from "./CommitDialog";
import {
  CHANGE_SCOPES,
  type ChangeBadge,
  type ChangeScope,
  changeBadge,
  filterByScope,
  SCOPE_META,
  type StageState,
  splitPath,
  stageState,
} from "./changeScopes";
import { FileDiffPreview } from "./FileDiffPreview";
import { iconForPath } from "./fileIcon";
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
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [commitFiles, setCommitFiles] = useState<Record<string, FileChange[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(async (targetCwd: string | undefined): Promise<void> => {
    if (!targetCwd) {
      setChanges([]);
      setStatsByPath(new Map());
      setStatus(undefined);
      setCommits([]);
      setCommitFiles({});
      return;
    }
    const [list, stats, st, log] = await Promise.all([
      window.modus.diff.list(targetCwd),
      window.modus.diff.stats(targetCwd),
      window.modus.diff.status(targetCwd).catch(() => undefined),
      window.modus.git.log({ cwd: targetCwd }).catch(() => [] as GitCommit[]),
    ]);
    setChanges(list);
    setStatsByPath(
      new Map(
        stats.files.map((f: FileChangeStat) => [f.path, { added: f.added, removed: f.removed }]),
      ),
    );
    setStatus(st);
    setCommits(log);
    setCommitFiles({});
    setRefreshToken((token) => token + 1);
  }, []);

  useEffect(() => {
    void refresh(cwd);
  }, [cwd, refresh]);

  const meta = SCOPE_META[scope];
  const scopeFiles = useMemo(
    () => (meta.commitHistory ? [] : filterByScope(changes, scope)),
    [changes, scope, meta.commitHistory],
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

  const stageAllState: StageState = useMemo(() => {
    if (scopeFiles.length === 0) return "unstaged";
    const states = scopeFiles.map(stageState);
    if (states.every((s) => s === "staged")) return "staged";
    if (states.every((s) => s === "unstaged")) return "unstaged";
    return "partial";
  }, [scopeFiles]);

  const count = meta.commitHistory ? commits.length : scopeFiles.length;

  async function runChangeAction(
    action: "stage" | "unstage" | "discard",
    path: string,
  ): Promise<void> {
    if (!cwd) return;
    if (action === "stage") await window.modus.diff.stage({ cwd, path });
    if (action === "unstage") await window.modus.diff.unstage({ cwd, path });
    if (action === "discard") await window.modus.diff.discard({ cwd, path });
    await refresh(cwd);
  }

  async function toggleStageAll(): Promise<void> {
    if (!cwd || scopeFiles.length === 0) return;
    const shouldStage = stageAllState !== "staged";
    await Promise.all(
      scopeFiles.map((change) =>
        shouldStage
          ? window.modus.diff.stage({ cwd, path: change.path })
          : window.modus.diff.unstage({ cwd, path: change.path }),
      ),
    );
    await refresh(cwd);
  }

  async function revertAll(): Promise<void> {
    if (!cwd) return;
    // Revert only tracked files; untracked have nothing in HEAD to restore to.
    const revertable = scopeFiles.filter((change) => !change.untracked);
    await Promise.all(
      revertable.map((change) => window.modus.diff.discard({ cwd, path: change.path })),
    );
    await refresh(cwd);
  }

  async function toggleCommit(hash: string): Promise<void> {
    setExpandedCommits((prev) => toggleKey(prev, hash));
    if (!cwd || commitFiles[hash]) return;
    const files = await window.modus.diff.commitChanges({ cwd, commit: hash });
    setCommitFiles((prev) => ({ ...prev, [hash]: files }));
  }

  const toggleFile = useCallback((key: string) => {
    setExpanded((prev) => toggleKey(prev, key));
  }, []);

  const cwdLabel = cwd?.split(/[\\/]/).filter(Boolean).at(-1) ?? "workspace";
  const onCommitRefresh = useCallback(() => refresh(cwd), [cwd, refresh]);

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
        void refresh(cwd);
      } else if (key === "f" && triggerFindInActiveDiff()) {
        event.preventDefault();
      }
    };
    node.addEventListener("keydown", handler);
    return () => node.removeEventListener("keydown", handler);
  }, [cwd, refresh]);

  return (
    <section className="flex h-full min-h-0 flex-col" ref={sectionRef}>
      <PanelHeader title="Changes">
        <button
          aria-label="Refresh changes"
          className="flex size-7 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg-subtle disabled:opacity-40"
          disabled={!cwd}
          onClick={() => void refresh(cwd)}
          type="button"
        >
          <IconRefresh size={15} stroke={1.65} />
        </button>
      </PanelHeader>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {cwd ? (
          <>
            <ComparisonBar
              branch={status?.branch}
              cwd={cwd}
              onRefresh={onCommitRefresh}
              onToggleTree={() => setTreeView(!treeView)}
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
                onRefresh={() => void refresh(cwd)}
                onReview={() => void startReview(cwd, sessionId, workspaceId)}
                onSetLayout={setLayout}
                onToggleWhitespace={() => setIgnoreWhitespace(!ignoreWhitespace)}
              />
            </ComparisonBar>

            <SummaryRow
              added={totals.added}
              count={count}
              noun={meta.noun}
              onRevertAll={() => void revertAll()}
              onScope={setScope}
              onToggleStageAll={() => void toggleStageAll()}
              removed={totals.removed}
              scope={scope}
              showStaging={!meta.commitHistory}
              showStats={!meta.commitHistory}
              stageAllState={stageAllState}
            />
          </>
        ) : null}

        {count === 0 ? (
          <EmptyState
            className={cwd ? "min-h-[220px]" : "h-full"}
            hint={
              cwd
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
              cwd={cwd ?? ""}
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
            cwd={cwd ?? ""}
            depth={0}
            expanded={expanded}
            ignoreWhitespace={ignoreWhitespace}
            nodes={buildChangeTree(scopeFiles)}
            onAction={runChangeAction}
            onToggleFile={toggleFile}
            refreshToken={refreshToken}
            sideBySide={sideBySide}
            statsByPath={statsByPath}
          />
        ) : (
          scopeFiles.map((change) => (
            <ChangeRow
              change={change}
              cwd={cwd ?? ""}
              display="full"
              expanded={expanded.has(change.path)}
              ignoreWhitespace={ignoreWhitespace}
              key={`${change.status}:${change.path}`}
              onAction={runChangeAction}
              onToggle={() => toggleFile(change.path)}
              refreshToken={refreshToken}
              sideBySide={sideBySide}
              stageable
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

function toggleKey(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/* ── Row 1: comparison context (≡ list/tree · Local {branch}) + commit + ⋯ ── */

function ComparisonBar({
  branch,
  cwd,
  status,
  treeView,
  onToggleTree,
  onRefresh,
  children,
}: {
  branch: string | undefined;
  cwd: string;
  status: GitStatusSummary | undefined;
  treeView: boolean;
  onToggleTree(): void;
  onRefresh(): void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-10 items-center gap-2 border-hairline border-b px-2.5">
      <Tooltip content={treeView ? "View as list" : "View as tree"} side="bottom" sideOffset={6}>
        <button
          aria-label={treeView ? "View as list" : "View as tree"}
          aria-pressed={treeView}
          className="flex size-6 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg-subtle"
          onClick={onToggleTree}
          type="button"
        >
          {treeView ? <IconListTree size={15} stroke={1.7} /> : <IconList size={15} stroke={1.7} />}
        </button>
      </Tooltip>
      <SourceMenu branch={branch} cwd={cwd} />
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <CommitLauncher cwd={cwd} onRefresh={onRefresh} status={status} />
        {children}
      </div>
    </div>
  );
}

/**
 * The comparison-source switcher (Cursor's "Local main" control). Opens a menu
 * to switch between local changes and pull requests. PR review needs a forge
 * provider Modus doesn't integrate yet, so that path is shown disabled-with-
 * reason rather than faked — the Local source is the live, working option.
 */
function SourceMenu({ branch, cwd }: { branch: string | undefined; cwd: string }) {
  const label = branch ?? "detached";
  return (
    <Menu.Root>
      <Menu.Trigger
        className="flex min-w-0 items-center gap-1.5 rounded-md py-0.5 pr-1.5 pl-0.5 text-sm outline-none transition-colors hover:bg-hover data-popup-open:bg-hover"
        title={`Switch between local changes and PRs — ${cwd}`}
      >
        <span className="flex items-center gap-1 rounded-md bg-chip px-1.5 py-0.5 text-fg-subtle">
          <IconDeviceDesktop size={13} stroke={1.7} />
          <span className="text-xs">Local</span>
        </span>
        <span className="max-w-[120px] truncate text-fg-muted">{label}</span>
        <IconChevronDown className="shrink-0 text-fg-faint" size={12} stroke={1.8} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="start" side="bottom" sideOffset={6}>
          <Menu.Popup className="origin-(--transform-origin) min-w-[240px] rounded-lg border border-hairline bg-elevated p-1 shadow-popup">
            <Menu.Item className="flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 text-fg text-sm outline-none select-none data-highlighted:bg-hover">
              <IconDeviceDesktop className="shrink-0 text-fg-subtle" size={15} stroke={1.7} />
              <span className="flex-1 truncate">
                Local <span className="font-medium">{label}</span>
              </span>
              <IconCheck className="shrink-0 text-accent" size={14} stroke={2} />
            </Menu.Item>
            <Menu.Item
              className="flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 text-fg-faint text-sm outline-none select-none data-disabled:opacity-100"
              disabled
            >
              <IconGitPullRequest className="shrink-0" size={15} stroke={1.7} />
              <span className="flex-1">Pull Requests</span>
              <span className="text-2xs text-fg-faint">soon</span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
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
        className="flex items-center gap-1.5 rounded-md border border-hairline bg-surface px-2.5 py-1 text-fg text-xs transition-colors hover:bg-hover disabled:opacity-40"
        disabled={!cwd}
        onClick={() => setOpen(true)}
        type="button"
      >
        <IconGitCommit size={14} stroke={1.7} />
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

/* ── Row 2: "{N} {Noun} Changes ⌄ +X -Y" + revert-all + stage-all checkbox ── */

function SummaryRow({
  scope,
  noun,
  count,
  added,
  removed,
  showStats,
  showStaging,
  stageAllState,
  onScope,
  onRevertAll,
  onToggleStageAll,
}: {
  scope: ChangeScope;
  noun: string;
  count: number;
  added: number;
  removed: number;
  showStats: boolean;
  showStaging: boolean;
  stageAllState: StageState;
  onScope(scope: ChangeScope): void;
  onRevertAll(): void;
  onToggleStageAll(): void;
}) {
  const label = noun === "Commit" ? (count === 1 ? "Commit" : "Commits") : `${noun} Changes`;
  return (
    <div className="flex h-8 items-center gap-2 px-2.5">
      <Menu.Root>
        <Menu.Trigger className="flex items-center gap-1 rounded-md px-1 py-0.5 text-fg text-sm outline-none transition-colors hover:bg-hover data-popup-open:bg-hover">
          <span className="font-medium tabular-nums">{count}</span>
          <span>{label}</span>
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
        <span className="flex items-center gap-1.5 font-mono text-xs">
          <span className="text-success">+{added}</span>
          <span className="text-danger">-{removed}</span>
        </span>
      ) : null}

      {showStaging ? (
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Tooltip content="Revert all changes" side="bottom" sideOffset={6}>
            <button
              aria-label="Revert all changes"
              className="flex size-6 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg-subtle disabled:opacity-30"
              disabled={count === 0}
              onClick={onRevertAll}
              type="button"
            >
              <IconRotateClockwise size={14} stroke={1.7} />
            </button>
          </Tooltip>
          <Tooltip
            content={stageAllState === "staged" ? "Unstage all" : "Stage all"}
            side="bottom"
            sideOffset={6}
          >
            <span>
              <StageCheckbox
                disabled={count === 0}
                onToggle={onToggleStageAll}
                state={stageAllState}
              />
            </span>
          </Tooltip>
        </div>
      ) : null}
    </div>
  );
}

/** Tri-state staging control: checked (all staged) · dash (partial) · empty. */
function StageCheckbox({
  state,
  onToggle,
  disabled,
}: {
  state: StageState;
  onToggle(): void;
  disabled?: boolean;
}) {
  return (
    <button
      aria-label="Stage"
      aria-pressed={state === "staged" ? true : state === "partial" ? "mixed" : false}
      className={cn(
        "flex size-[15px] items-center justify-center rounded-[4px] border transition-colors disabled:opacity-30",
        state === "unstaged"
          ? "border-hairline-strong text-transparent hover:border-fg-faint"
          : "border-accent bg-accent text-white",
      )}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      type="button"
    >
      {state === "staged" ? (
        <IconCheck size={11} stroke={2.6} />
      ) : state === "partial" ? (
        <IconMinus size={11} stroke={2.6} />
      ) : null}
    </button>
  );
}

/* ── File row (Figure 2/6): icon · path · badge/±  ·hover copy + revert ── */

type RunChangeAction = (action: "stage" | "unstage" | "discard", path: string) => Promise<void>;

function ChangeRow({
  change,
  cwd,
  display,
  depth = 0,
  expanded,
  onToggle,
  onAction,
  stat,
  stageable,
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
  onToggle(): void;
  onAction?: RunChangeAction;
  stat?: LineStat | undefined;
  stageable: boolean;
  commit?: string | undefined;
  sideBySide: boolean;
  ignoreWhitespace: boolean;
  refreshToken: number;
}) {
  const { dir, name } = splitPath(change.path);
  const badge = changeBadge(change);
  const state = stageState(change);

  return (
    <div className="border-hairline-soft border-b">
      <div
        className={cn(
          "group flex h-8 w-full items-center gap-1.5 pr-2 text-left text-sm transition-colors",
          expanded ? "bg-chip-faint text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
        )}
        style={{ paddingLeft: 10 + depth * 14 }}
      >
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
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
            {iconForPath(change.path)}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {display === "full" && dir ? <span className="text-fg-faint">{dir}</span> : null}
            <span>{name}</span>
          </span>
          <ChangeMeta badge={badge} stat={stat} />
        </button>

        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <IconBtn
            label="Copy path"
            onClick={() => void navigator.clipboard.writeText(change.path)}
          >
            <IconCopy size={13} stroke={1.7} />
          </IconBtn>
          {stageable && onAction ? (
            <Tooltip
              content={change.untracked ? "New file — delete manually" : "Revert file"}
              side="bottom"
              sideOffset={6}
            >
              <span>
                <IconBtn
                  disabled={Boolean(change.untracked)}
                  label="Revert file"
                  onClick={() => void onAction("discard", change.path)}
                >
                  <IconRotateClockwise size={13} stroke={1.7} />
                </IconBtn>
              </span>
            </Tooltip>
          ) : null}
        </span>

        {stageable && onAction ? (
          <StageCheckbox
            onToggle={() => void onAction(state === "staged" ? "unstage" : "stage", change.path)}
            state={state}
          />
        ) : null}
      </div>
      <CollapsibleMotion open={expanded} preset="default">
        <FileDiffPreview
          change={change}
          commit={commit}
          cwd={cwd}
          ignoreWhitespace={ignoreWhitespace}
          refreshToken={refreshToken}
          sideBySide={sideBySide}
        />
      </CollapsibleMotion>
    </div>
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
          "flex h-11 w-full items-center gap-2 px-2.5 text-left text-sm transition-colors",
          expanded ? "bg-chip-faint text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
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
                onToggle={() => onToggleFile(key)}
                refreshToken={refreshToken}
                sideBySide={sideBySide}
                stageable={false}
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
  onAction,
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
  onAction: RunChangeAction;
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
            onAction={onAction}
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
            onAction={onAction}
            onToggle={() => onToggleFile(node.change.path)}
            refreshToken={refreshToken}
            sideBySide={sideBySide}
            stageable
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
  onAction,
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
  onAction: RunChangeAction;
  statsByPath: Map<string, LineStat>;
  sideBySide: boolean;
  ignoreWhitespace: boolean;
  refreshToken: number;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        className="group flex h-8 w-full items-center gap-1.5 pr-2 text-left text-fg-muted text-sm transition-colors hover:bg-hover hover:text-fg"
        onClick={() => setOpen((value) => !value)}
        style={{ paddingLeft: 10 + depth * 14 }}
        type="button"
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-fg-faint">
          {open ? (
            <IconChevronDown size={13} stroke={1.7} />
          ) : (
            <IconChevronRight size={13} stroke={1.7} />
          )}
        </span>
        <IconFolder className="shrink-0 text-fg-subtle" size={15} stroke={1.6} />
        <span className="min-w-0 truncate">{node.name}</span>
      </button>
      <CollapsibleMotion open={open} preset="default">
        <TreeRows
          cwd={cwd}
          depth={depth + 1}
          expanded={expanded}
          ignoreWhitespace={ignoreWhitespace}
          nodes={node.children}
          onAction={onAction}
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
      className="flex size-6 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-active hover:text-fg-subtle disabled:cursor-not-allowed disabled:opacity-30"
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
