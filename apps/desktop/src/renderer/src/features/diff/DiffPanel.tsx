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
  IconLoader2,
  IconMinus,
  IconPlus,
  IconRefresh,
  IconReportSearch,
  IconRotateClockwise,
} from "@tabler/icons-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  DiffReview,
  DiffReviewReady,
  DiffTarget,
  FileChange,
  GitBranchSummary,
  GitChangeEvent,
  GitCommit,
  GitStatusSummary,
  ReviewFile,
} from "../../../../shared/contracts";
import { CollapsibleMotion } from "../../components/ui/CollapsibleMotion";
import { EmptyState } from "../../components/ui/Panel";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";
import { materialIconForFile } from "../files/fileIcons";
import { BranchSwitcher } from "../git/BranchSwitcher";
import { CommitDialog } from "./CommitDialog";
import {
  type ChangeBadge,
  type ChangeScope,
  changeBadge,
  isChangeScope,
  SCOPE_META,
  splitPath,
} from "./changeScopes";
import {
  clearDiffPreviewCache,
  type DiffPreviewRequest,
  FileDiffPreview,
  preloadInlineDiffRenderer,
  prepareDiffPreview,
} from "./FileDiffPreview";
import { buildChangeTree, type FlatChangeTreeRow, flattenChangeTree } from "./fileTree";

type DiffPanelProps = {
  cwd?: string | undefined;
  sessionId?: string | undefined;
  workspaceId?: string | undefined;
};

type LineStat = Pick<ReviewFile, "added" | "removed" | "binary">;

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

const EMPTY_REVIEW: DiffReviewReady = {
  state: "ready",
  files: [],
  totals: { added: 0, removed: 0, fileCount: 0 },
};

function targetForScope(
  scope: ChangeScope,
  sessionId: string | undefined,
  commit: string | undefined,
  base: string | undefined,
): DiffTarget | undefined {
  if (scope === "unstaged" || scope === "staged") return { type: scope };
  if (scope === "commit") return commit ? { type: "commit", commit } : undefined;
  if (scope === "branch") return { type: "branch", ...(base ? { base } : {}) };
  if (scope === "last-turn") return sessionId ? { type: "last-turn", sessionId } : undefined;
  return undefined;
}

export function DiffPanel({ cwd, sessionId, workspaceId }: DiffPanelProps) {
  const [storedScope, setScope] = usePersistentState<string>("modus.changes.scope", "unstaged");
  const scope: ChangeScope = isChangeScope(storedScope) ? storedScope : "unstaged";
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

  const [review, setReview] = useState<DiffReviewReady>(EMPTY_REVIEW);
  const [reviewUnavailable, setReviewUnavailable] = useState<string | undefined>();
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<DiffTarget>({ type: "unstaged" });
  const [status, setStatus] = useState<GitStatusSummary | undefined>();
  const [isRepository, setIsRepository] = useState<boolean | undefined>();
  const [initializingRepository, setInitializingRepository] = useState(false);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [branches, setBranches] = useState<GitBranchSummary>({ local: [], remote: [] });
  const [selectedCommit, setSelectedCommit] = useState<string | undefined>();
  const [selectedBase, setSelectedBase] = useState<string | undefined>();
  const [commitFiles, setCommitFiles] = useState<Record<string, ReviewFile[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
  // Surfaces a failed stage/unstage/discard/revert so it is never a silent no-op.
  const [actionError, setActionError] = useState<string | undefined>();
  const reviewGeneration = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const commitsCwd = useRef<string | undefined>(undefined);
  const commitsRef = useRef<GitCommit[]>([]);
  const branchesCwd = useRef<string | undefined>(undefined);
  const [linkedWorktree, setLinkedWorktree] = useState<
    { rootCwd: string | undefined; cwd: string; branch: string } | undefined
  >();
  const visibleLinkedWorktree =
    normalizePath(linkedWorktree?.rootCwd) === normalizePath(cwd) ? linkedWorktree : undefined;
  const activeCwd = visibleLinkedWorktree?.cwd ?? cwd;

  const reset = useCallback((): void => {
    reviewGeneration.current += 1;
    commitsCwd.current = undefined;
    commitsRef.current = [];
    branchesCwd.current = undefined;
    setReview(EMPTY_REVIEW);
    setReviewUnavailable(undefined);
    setReviewTarget({ type: "unstaged" });
    setStatus(undefined);
    setCommits([]);
    setBranches({ local: [], remote: [] });
    setCommitFiles({});
    setExpanded(new Set());
    setCollapsedDirs(new Set());
    setExpandedCommits(new Set());
    clearDiffPreviewCache();
  }, []);

  const loadStatus = useCallback(async (targetCwd: string): Promise<void> => {
    const next = await window.modus.diff.status(targetCwd).catch(() => undefined);
    setStatus(next);
  }, []);

  const loadCommits = useCallback(async (targetCwd: string): Promise<GitCommit[]> => {
    const next: GitCommit[] = await window.modus.git
      .log({ cwd: targetCwd })
      .catch(() => [] as GitCommit[]);
    commitsCwd.current = targetCwd;
    commitsRef.current = next;
    setCommits(next);
    setExpandedCommits((prev) =>
      pruneExpandedKeys(
        prev,
        next.map((commit) => commit.hash),
      ),
    );
    setCommitFiles((prev) =>
      pruneRecordKeys(
        prev,
        next.map((commit) => commit.hash),
      ),
    );
    return next;
  }, []);

  const loadBranches = useCallback(async (targetCwd: string): Promise<void> => {
    const next = await window.modus.git
      .branches(targetCwd)
      .catch(() => ({ local: [], remote: [] }) as GitBranchSummary);
    branchesCwd.current = targetCwd;
    setBranches(next);
  }, []);

  const loadReview = useCallback(
    async (targetCwd: string): Promise<void> => {
      if (scope === "all-commits") {
        setReview(EMPTY_REVIEW);
        setReviewUnavailable(undefined);
        return;
      }
      let commit = selectedCommit;
      if (scope === "commit" && !commit) {
        const log =
          commitsCwd.current === targetCwd ? commitsRef.current : await loadCommits(targetCwd);
        commit = log[0]?.hash;
      }
      const target = targetForScope(scope, sessionId, commit, selectedBase);
      if (!target) {
        setReview(EMPTY_REVIEW);
        setReviewUnavailable(undefined);
        return;
      }

      const generation = ++reviewGeneration.current;
      setReviewLoading(true);
      setActionError(undefined);
      try {
        const next: DiffReview = await window.modus.diff.review({ cwd: targetCwd, target });
        if (generation !== reviewGeneration.current || next.state === "superseded") return;
        if (next.state === "unavailable") {
          setReview(EMPTY_REVIEW);
          setReviewUnavailable(next.message);
          setReviewTarget(target);
          setExpanded(new Set());
          return;
        }
        clearDiffPreviewCache();
        setReview(next);
        setReviewUnavailable(undefined);
        setExpanded(new Set());
        setReviewTarget(
          target.type === "branch" && next.resolvedBase
            ? { type: "branch", base: next.resolvedBase }
            : target,
        );
      } catch (cause) {
        if (generation === reviewGeneration.current) {
          setActionError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (generation === reviewGeneration.current) setReviewLoading(false);
      }
    },
    [loadCommits, scope, selectedBase, selectedCommit, sessionId],
  );

  const refresh = useCallback(
    async (targetCwd: string | undefined): Promise<void> => {
      if (!targetCwd) {
        setIsRepository(undefined);
        reset();
        return;
      }
      const repository = await window.modus.git.isRepository(targetCwd);
      setIsRepository(repository);
      if (!repository) {
        reset();
        return;
      }
      await Promise.all([
        loadStatus(targetCwd),
        scope === "all-commits" ? loadCommits(targetCwd) : loadReview(targetCwd),
      ]);
    },
    [loadCommits, loadReview, loadStatus, reset, scope],
  );

  useEffect(() => {
    void refresh(activeCwd);
  }, [activeCwd, refresh]);

  useEffect(() => {
    if (!activeCwd || !isRepository) return;
    const idle = window.requestIdleCallback(() => void preloadInlineDiffRenderer(), {
      timeout: 1500,
    });
    return () => window.cancelIdleCallback(idle);
  }, [activeCwd, isRepository]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: selections are repository-scoped and reset when the active checkout changes.
  useEffect(() => {
    setSelectedCommit(undefined);
    setSelectedBase(undefined);
  }, [activeCwd]);

  // Live refresh: watch the repo and refresh on debounced on-disk changes
  // (agent edits, terminal commits, external git ops) — no manual refresh.
  useEffect(() => {
    if (!activeCwd || isRepository === false) return;
    let watchedRoot: string | undefined;
    void window.modus.git.watch(activeCwd).then((root: string | undefined) => {
      watchedRoot = root ?? undefined;
    });
    const off = window.modus.git.onChanged((event: GitChangeEvent) => {
      if (watchedRoot && event.cwd !== watchedRoot) return;
      if (event.kind === "lock") return;
      void loadStatus(activeCwd);
      if (scope === "all-commits") void loadCommits(activeCwd);
      else void loadReview(activeCwd);
      if (scope !== "all-commits" && commitsCwd.current === activeCwd && event.kind !== "working") {
        void loadCommits(activeCwd);
      }
      if (
        branchesCwd.current === activeCwd &&
        ["head", "refs", "remote-refs", "config"].includes(event.kind)
      ) {
        void loadBranches(activeCwd);
      }
    });
    return () => {
      off();
      void window.modus.git.unwatch(activeCwd);
    };
  }, [activeCwd, isRepository, loadBranches, loadCommits, loadReview, loadStatus, scope]);

  const history = scope === "all-commits";
  const scopeFiles = review.files;
  const statsByPath = useMemo(
    () => new Map(review.files.map((file) => [file.path, file])),
    [review.files],
  );

  // Build the tree once per change set — not on every expand/collapse (which
  // only flips a Set in state and would otherwise re-run this in render).
  const changeTree = useMemo(
    () => (treeView && !history ? buildChangeTree(scopeFiles) : []),
    [treeView, history, scopeFiles],
  );
  const treeRows = useMemo(
    () => (treeView && !history ? flattenChangeTree(changeTree, collapsedDirs) : []),
    [changeTree, collapsedDirs, history, treeView],
  );

  const totals = review.totals;
  const count = history ? commits.length : scopeFiles.length;

  const runFileAction = useCallback(
    async (action: "stage" | "unstage" | "discard", path: string): Promise<void> => {
      if (!activeCwd) return;
      setActionError(undefined);
      try {
        if (action === "stage") await window.modus.diff.stage({ cwd: activeCwd, path });
        else if (action === "unstage") await window.modus.diff.unstage({ cwd: activeCwd, path });
        else await window.modus.diff.discardUnstaged({ cwd: activeCwd, path });
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
      const commitReview = await window.modus.diff.review({
        cwd: activeCwd,
        target: { type: "commit", commit: hash },
      });
      if (commitReview.state !== "ready") return;
      setCommitFiles((prev) => ({ ...prev, [hash]: commitReview.files }));
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

  // Panel-scoped Ctrl+R. Bound on the section node (events bubble up
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
          branches={branches}
          commits={commits}
          count={count}
          cwd={activeCwd}
          linkedWorktree={visibleLinkedWorktree}
          onBackToMain={() => setLinkedWorktree(undefined)}
          onError={setActionError}
          onLoadBranches={() => void loadBranches(activeCwd)}
          onLoadCommits={() => void loadCommits(activeCwd)}
          onRefresh={onCommitRefresh}
          onScope={(nextScope) => {
            setActionError(undefined);
            setScope(nextScope);
          }}
          onSelectBase={(base) => {
            setActionError(undefined);
            setSelectedBase(base);
            setScope("branch");
          }}
          onSelectCommit={(commit) => {
            setActionError(undefined);
            setSelectedCommit(commit);
            setScope("commit");
          }}
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
          reviewTurn={review.turn}
          loading={reviewLoading}
          scope={scope}
          selectedBase={selectedBase ?? review.resolvedBase}
          selectedCommit={selectedCommit ?? commits[0]?.hash}
          showStats={!history}
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
            onRefresh={() => void refresh(activeCwd)}
            onReview={() => void startReview(activeCwd, sessionId, workspaceId)}
            onSetLayout={setLayout}
            onToggleWhitespace={() => setIgnoreWhitespace(!ignoreWhitespace)}
          />
        </ReviewToolbar>
      ) : null}

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto py-1" ref={scrollRef}>
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
                ? history
                  ? `No commits in ${cwdLabel}`
                  : (reviewUnavailable ?? `No ${SCOPE_META[scope].noun} changes in ${cwdLabel}`)
                : "Open a workspace to review changes."
            }
            icon={<IconFileDiff size={22} stroke={1.4} />}
          />
        ) : history ? (
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
              sideBySide={sideBySide}
            />
          ))
        ) : treeView ? (
          <VirtualTreeList
            collapsed={collapsedDirs}
            cwd={activeCwd ?? ""}
            expanded={expanded}
            ignoreWhitespace={ignoreWhitespace}
            onDiscard={
              scope === "unstaged" ? (path) => void runFileAction("discard", path) : undefined
            }
            onToggleDir={(path) => setCollapsedDirs((prev) => toggleKey(prev, path))}
            onStage={scope === "unstaged" ? (path) => void runFileAction("stage", path) : undefined}
            onUnstage={
              scope === "staged" ? (path) => void runFileAction("unstage", path) : undefined
            }
            onToggleFile={toggleFile}
            rows={treeRows}
            scrollRef={scrollRef}
            sideBySide={sideBySide}
            statsByPath={statsByPath}
            target={reviewTarget}
          />
        ) : (
          <VirtualChangeList
            cwd={activeCwd ?? ""}
            expanded={expanded}
            files={scopeFiles}
            ignoreWhitespace={ignoreWhitespace}
            onDiscard={
              scope === "unstaged" ? (path) => void runFileAction("discard", path) : undefined
            }
            onStage={scope === "unstaged" ? (path) => void runFileAction("stage", path) : undefined}
            onToggle={toggleFile}
            onUnstage={
              scope === "staged" ? (path) => void runFileAction("unstage", path) : undefined
            }
            scrollRef={scrollRef}
            sideBySide={sideBySide}
            target={reviewTarget}
          />
        )}
      </div>
    </section>
  );
}

function VirtualChangeList({
  files,
  scrollRef,
  cwd,
  expanded,
  onToggle,
  onStage,
  onUnstage,
  onDiscard,
  target,
  sideBySide,
  ignoreWhitespace,
}: {
  files: ReviewFile[];
  scrollRef: RefObject<HTMLDivElement | null>;
  cwd: string;
  expanded: Set<string>;
  onToggle(key: string): void;
  onStage?: ((path: string) => void) | undefined;
  onUnstage?: ((path: string) => void) | undefined;
  onDiscard?: ((path: string) => void) | undefined;
  target: DiffTarget;
  sideBySide: boolean;
  ignoreWhitespace: boolean;
}) {
  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (expanded.has(files[index]?.path ?? "") ? 440 : 40),
    getItemKey: (index) => files[index]?.path ?? index,
    overscan: 6,
  });

  return (
    <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((row) => {
        const change = files[row.index];
        if (!change) return null;
        return (
          <div
            className="absolute top-0 left-0 w-full"
            data-index={row.index}
            key={change.path}
            ref={virtualizer.measureElement}
            style={{ transform: `translateY(${row.start}px)` }}
          >
            <ChangeRow
              change={change}
              cwd={cwd}
              display="full"
              expanded={expanded.has(change.path)}
              ignoreWhitespace={ignoreWhitespace}
              onDiscard={onDiscard}
              onStage={onStage}
              onToggle={onToggle}
              onUnstage={onUnstage}
              rowKey={change.path}
              sideBySide={sideBySide}
              stat={change}
              target={target}
            />
          </div>
        );
      })}
    </div>
  );
}

function VirtualTreeList({
  rows,
  scrollRef,
  collapsed,
  cwd,
  expanded,
  onToggleDir,
  onToggleFile,
  onStage,
  onUnstage,
  onDiscard,
  statsByPath,
  target,
  sideBySide,
  ignoreWhitespace,
}: {
  rows: FlatChangeTreeRow[];
  scrollRef: RefObject<HTMLDivElement | null>;
  collapsed: Set<string>;
  cwd: string;
  expanded: Set<string>;
  onToggleDir(path: string): void;
  onToggleFile(key: string): void;
  onStage?: ((path: string) => void) | undefined;
  onUnstage?: ((path: string) => void) | undefined;
  onDiscard?: ((path: string) => void) | undefined;
  statsByPath: Map<string, LineStat>;
  target: DiffTarget;
  sideBySide: boolean;
  ignoreWhitespace: boolean;
}) {
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      return row?.kind === "file" && expanded.has(row.change.path) ? 440 : 40;
    },
    getItemKey: (index) => {
      const row = rows[index];
      return row?.kind === "dir" ? `dir:${row.path}` : (row?.change.path ?? index);
    },
    overscan: 6,
  });

  return (
    <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => {
        const row = rows[item.index];
        if (!row) return null;
        return (
          <div
            className="absolute top-0 left-0 w-full"
            data-index={item.index}
            key={item.key}
            ref={virtualizer.measureElement}
            style={{ transform: `translateY(${item.start}px)` }}
          >
            {row.kind === "dir" ? (
              <button
                className="group flex h-10 w-full items-center gap-2 pr-3 text-left text-fg-muted text-sm transition-colors hover:bg-hover hover:text-fg"
                onClick={() => onToggleDir(row.path)}
                style={{ paddingLeft: 12 + row.depth * 16 }}
                type="button"
              >
                <span className="flex size-4 shrink-0 items-center justify-center text-fg-faint">
                  {collapsed.has(row.path) ? (
                    <IconChevronRight size={13} stroke={1.7} />
                  ) : (
                    <IconChevronDown size={13} stroke={1.7} />
                  )}
                </span>
                <IconFolderOpen className="toolbar-icon shrink-0" size={18} stroke={1.7} />
                <span className="min-w-0 truncate">{row.name}</span>
              </button>
            ) : (
              <ChangeRow
                change={row.change}
                cwd={cwd}
                depth={row.depth}
                display="name"
                expanded={expanded.has(row.change.path)}
                ignoreWhitespace={ignoreWhitespace}
                onDiscard={onDiscard}
                onStage={onStage}
                onToggle={onToggleFile}
                onUnstage={onUnstage}
                rowKey={row.change.path}
                sideBySide={sideBySide}
                stat={statsByPath.get(row.change.path)}
                target={target}
              />
            )}
          </div>
        );
      })}
    </div>
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
  commits,
  branches,
  selectedCommit,
  selectedBase,
  reviewTurn,
  loading,
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
  onSelectCommit,
  onSelectBase,
  onToggleTree,
  onRefresh,
  onError,
  onLoadBranches,
  onLoadCommits,
  onWorktreeBranch,
  onBackToMain,
  children,
}: {
  scope: ChangeScope;
  commits: GitCommit[];
  branches: GitBranchSummary;
  selectedCommit: string | undefined;
  selectedBase: string | undefined;
  reviewTurn: DiffReviewReady["turn"] | undefined;
  loading: boolean;
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
  onSelectCommit(commit: string): void;
  onSelectBase(base: string): void;
  onToggleTree(): void;
  onRefresh(): void;
  onError(message: string): void;
  onLoadBranches(): void;
  onLoadCommits(): void;
  onWorktreeBranch(path: string, branch: string): void;
  onBackToMain(): void;
  children: ReactNode;
}) {
  const availableBranches = [...branches.local, ...branches.remote].filter((item) => !item.current);
  const selectedCommitLabel = commits.find((item) => item.hash === selectedCommit)?.shortHash;
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
          {loading ? <span className="size-1.5 animate-pulse rounded-full bg-accent" /> : null}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="start" side="bottom" sideOffset={6}>
            <Menu.Popup className="origin-(--transform-origin) min-w-[170px] popup-chrome p-1">
              <MenuChoice checked={scope === "unstaged"} onClick={() => onScope("unstaged")}>
                Unstaged
              </MenuChoice>
              <MenuChoice checked={scope === "staged"} onClick={() => onScope("staged")}>
                Staged
              </MenuChoice>
              <ScopeSubmenu
                label="Commit"
                onOpen={onLoadCommits}
                selected={scope === "commit"}
                value={selectedCommitLabel}
              >
                {commits.length ? (
                  commits.map((commit) => (
                    <MenuChoice
                      checked={scope === "commit" && selectedCommit === commit.hash}
                      key={commit.hash}
                      onClick={() => onSelectCommit(commit.hash)}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="max-w-[280px] truncate">{commit.subject}</span>
                        <span className="font-mono text-2xs text-fg-faint">{commit.shortHash}</span>
                      </span>
                    </MenuChoice>
                  ))
                ) : (
                  <MenuEmpty>No commits</MenuEmpty>
                )}
              </ScopeSubmenu>
              <ScopeSubmenu
                label="Branch"
                onOpen={onLoadBranches}
                selected={scope === "branch"}
                value={selectedBase}
              >
                {availableBranches.length ? (
                  <VirtualBranchChoices
                    branches={availableBranches}
                    onSelect={onSelectBase}
                    selected={scope === "branch" ? selectedBase : undefined}
                  />
                ) : (
                  <MenuEmpty>No other branches</MenuEmpty>
                )}
              </ScopeSubmenu>
              <MenuChoice checked={scope === "last-turn"} onClick={() => onScope("last-turn")}>
                Last Turn
              </MenuChoice>
              <div className="my-1 h-px bg-hairline" />
              <MenuChoice checked={scope === "all-commits"} onClick={() => onScope("all-commits")}>
                All commits
              </MenuChoice>
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
      {scope === "last-turn" && reviewTurn ? (
        <span className="text-2xs text-fg-faint capitalize">{reviewTurn.status}</span>
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

/* ── The "⋯" menu: layout · whitespace · collapse · refresh ─ */

function OverflowMenu({
  layout,
  ignoreWhitespace,
  onSetLayout,
  onToggleWhitespace,
  onCollapseAll,
  onRefresh,
  onReview,
}: {
  layout: "split" | "unified";
  ignoreWhitespace: boolean;
  onSetLayout(layout: "split" | "unified"): void;
  onToggleWhitespace(): void;
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
          <Menu.Popup className="origin-(--transform-origin) min-w-[220px] popup-chrome p-1">
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
                  <Menu.Popup className="origin-(--transform-origin) min-w-[150px] popup-chrome p-1">
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

function MenuEmpty({ children }: { children: ReactNode }) {
  return <div className="px-2.5 py-1.5 text-fg-faint text-xs">{children}</div>;
}

function ScopeSubmenu({
  label,
  selected,
  value,
  onOpen,
  children,
}: {
  label: string;
  selected: boolean;
  value: string | undefined;
  onOpen?(): void;
  children: ReactNode;
}) {
  return (
    <Menu.SubmenuRoot onOpenChange={(open) => open && onOpen?.()}>
      <Menu.SubmenuTrigger className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-fg text-sm outline-none select-none data-highlighted:bg-hover data-popup-open:bg-hover">
        <span className="flex size-4 items-center justify-center text-accent">
          {selected ? <IconCheck size={14} stroke={2} /> : null}
        </span>
        <span className="flex-1">{label}</span>
        {value ? <span className="max-w-24 truncate text-2xs text-fg-faint">{value}</span> : null}
        <IconChevronRight size={13} stroke={1.7} />
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner align="start" side="right" sideOffset={4}>
          <Menu.Popup className="scroll-thin max-h-[360px] min-w-[240px] overflow-y-auto popup-chrome p-1">
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}

function VirtualBranchChoices({
  branches,
  selected,
  onSelect,
}: {
  branches: GitBranchSummary["local"];
  selected: string | undefined;
  onSelect(name: string): void;
}) {
  const [query, setQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? branches.filter((branch) => branch.name.toLowerCase().includes(needle))
      : branches;
  }, [branches, query]);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 34,
    overscan: 8,
  });

  return (
    <div className="w-[360px] max-w-[70vw]">
      <div className="p-1">
        <input
          aria-label="Search branches"
          className="h-8 w-full rounded-md bg-input px-2.5 text-fg text-sm outline-none placeholder:text-fg-faint"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder="Search branches…"
          value={query}
        />
      </div>
      <div className="scroll-thin max-h-[320px] overflow-y-auto" ref={scrollRef}>
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => {
            const branch = filtered[row.index];
            if (!branch) return null;
            return (
              <div
                className="absolute top-0 left-0 w-full"
                data-index={row.index}
                key={`${branch.remote ? "remote" : "local"}:${branch.name}`}
                ref={virtualizer.measureElement}
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <MenuChoice
                  checked={selected === branch.name}
                  onClick={() => onSelect(branch.name)}
                >
                  <span className="truncate">{branch.name}</span>
                </MenuChoice>
              </div>
            );
          })}
        </div>
      </div>
    </div>
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
  onStage,
  onUnstage,
  onDiscard,
  stat,
  target,
  sideBySide,
  ignoreWhitespace,
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
  onStage?: ((path: string) => void) | undefined;
  onUnstage?: ((path: string) => void) | undefined;
  onDiscard?: ((path: string) => void) | undefined;
  stat?: LineStat | undefined;
  target: DiffTarget;
  sideBySide: boolean;
  ignoreWhitespace: boolean;
}) {
  const { dir, name } = splitPath(change.path);
  const badge = changeBadge(change);
  const changedLines = (stat?.added ?? 0) + (stat?.removed ?? 0);
  const [opening, setOpening] = useState(false);
  const previewRequest: DiffPreviewRequest = {
    cwd,
    path: change.path,
    target,
    ...(change.renamedFrom !== undefined ? { originalPath: change.renamedFrom } : {}),
    untracked: Boolean(change.untracked),
    ignoreWhitespace,
  };

  const prepare = (): void => {
    if (expanded || opening || stat?.binary || changedLines > 500) return;
    void prepareDiffPreview(previewRequest);
  };

  const toggle = async (): Promise<void> => {
    if (opening) return;
    if (expanded || stat?.binary || changedLines > 500) {
      onToggle(rowKey);
      return;
    }
    setOpening(true);
    try {
      await prepareDiffPreview(previewRequest);
      onToggle(rowKey);
    } finally {
      setOpening(false);
    }
  };

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
          onClick={() => void toggle()}
          onFocus={prepare}
          onPointerEnter={prepare}
          type="button"
        >
          <span className="flex size-4 shrink-0 items-center justify-center text-fg-faint">
            {opening ? (
              <IconLoader2 className="animate-spin" size={13} stroke={1.7} />
            ) : expanded ? (
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
          {onStage ? (
            <IconBtn label="Stage file" onClick={() => onStage(change.path)}>
              <IconPlus size={13} stroke={1.7} />
            </IconBtn>
          ) : null}
          {onUnstage ? (
            <IconBtn label="Unstage file" onClick={() => onUnstage(change.path)}>
              <IconMinus size={13} stroke={1.7} />
            </IconBtn>
          ) : null}
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
          binary={Boolean(stat?.binary)}
          changedLines={changedLines}
          request={previewRequest}
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
}: {
  commit: GitCommit;
  cwd: string;
  expanded: boolean;
  files: ReviewFile[] | undefined;
  expandedFiles: Set<string>;
  onToggle(): void;
  onToggleFile(key: string): void;
  sideBySide: boolean;
  ignoreWhitespace: boolean;
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
                cwd={cwd}
                depth={1}
                display="full"
                expanded={expandedFiles.has(key)}
                ignoreWhitespace={ignoreWhitespace}
                key={key}
                onToggle={onToggleFile}
                rowKey={key}
                sideBySide={sideBySide}
                stat={file}
                target={{ type: "commit", commit: commit.hash }}
              />
            );
          })
        )}
      </CollapsibleMotion>
    </div>
  );
}

/* ── Tree mode: recursive folder/file rows over the compacted change tree ── */

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
