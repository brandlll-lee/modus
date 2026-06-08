import {
  IconBraces,
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconFileCode,
  IconFileDiff,
  IconFileTypeCss,
  IconFileTypeHtml,
  IconFileTypeJs,
  IconFileTypeJsx,
  IconFileTypeRs,
  IconFileTypeSvg,
  IconFileTypeTs,
  IconFileTypeTsx,
  IconGitBranch,
  IconGitCommit,
  IconJson,
  IconMarkdown,
  IconMinus,
  IconPlus,
  IconRefresh,
  IconReportSearch,
  IconRotateClockwise,
  IconTrash,
} from "@tabler/icons-react";
import { AnimatePresence, m } from "motion/react";
import { memo, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { AgentReviewResult, FileChange, GitStatusSummary } from "../../../../shared/contracts";
import { EmptyState, PanelHeader } from "../../components/ui/Panel";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";
import { CommitDialog } from "./CommitDialog";

type DiffPanelProps = {
  cwd?: string | undefined;
  sessionId?: string | undefined;
  workspaceId?: string | undefined;
};

export function DiffPanel({ cwd, sessionId, workspaceId }: DiffPanelProps) {
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | undefined>();
  const [review, setReview] = useState<AgentReviewResult | undefined>();
  const [summaryDiff, setSummaryDiff] = useState("");
  const [selectedDiff, setSelectedDiff] = useState("");
  const [status, setStatus] = useState<GitStatusSummary | undefined>();

  const refreshChanges = useCallback(async (targetCwd: string | undefined): Promise<void> => {
    if (!targetCwd) {
      setChanges([]);
      setSummaryDiff("");
      setSelectedDiff("");
      setStatus(undefined);
      return;
    }

    const [nextChanges, nextSummary, reviews, nextStatus] = await Promise.all([
      window.modus.diff.list(targetCwd),
      window.modus.diff.read({ cwd: targetCwd }),
      window.modus.review.list(targetCwd),
      window.modus.diff.status(targetCwd).catch(() => undefined),
    ]);
    setChanges(nextChanges);
    setSummaryDiff(nextSummary.diff);
    setReview(reviews[0]);
    setStatus(nextStatus);
    setSelectedPath(nextChanges[0]?.path);
  }, []);

  useEffect(() => {
    void refreshChanges(cwd);
  }, [cwd, refreshChanges]);

  useEffect(() => {
    if (!cwd || !selectedPath) {
      setSelectedDiff("");
      return;
    }

    const change = changes.find((item) => item.path === selectedPath);
    void window.modus.diff
      .read({ cwd, path: selectedPath, mode: change?.staged ? "staged" : "unstaged" })
      .then((fileDiff: { diff: string }) => {
        setSelectedDiff(fileDiff.diff);
      });
  }, [changes, cwd, selectedPath]);

  const selectedTotals = useMemo(() => getDiffTotals(selectedDiff), [selectedDiff]);
  const summaryTotals = useMemo(() => getDiffTotals(summaryDiff), [summaryDiff]);
  const groupedChanges = useMemo(
    () => [
      { title: "Staged", items: changes.filter((change) => change.staged) },
      { title: "Changes", items: changes.filter((change) => change.unstaged && !change.untracked) },
      { title: "Untracked", items: changes.filter((change) => change.untracked) },
    ],
    [changes],
  );

  async function runChangeAction(
    action: "stage" | "unstage" | "discard",
    path: string,
  ): Promise<void> {
    if (!cwd) return;
    if (action === "stage") await window.modus.diff.stage({ cwd, path });
    if (action === "unstage") await window.modus.diff.unstage({ cwd, path });
    if (action === "discard") await window.modus.diff.discard({ cwd, path });
    await refreshChanges(cwd);
  }

  async function startReview(): Promise<void> {
    if (!cwd) return;
    setReview(await window.modus.review.start({ cwd, sessionId, workspaceId }));
  }

  const cwdLabel = cwd?.split(/[\\/]/).filter(Boolean).at(-1) ?? "workspace";
  // Stable identity so the memoized launcher only re-renders when cwd actually changes.
  const onCommitRefresh = useCallback(() => refreshChanges(cwd), [cwd, refreshChanges]);

  return (
    <section className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Changes">
        <button
          aria-label="Refresh changes"
          className="flex size-7 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg-subtle disabled:opacity-40"
          disabled={!cwd}
          onClick={() => void refreshChanges(cwd)}
          type="button"
        >
          <IconRefresh size={15} stroke={1.65} />
        </button>
      </PanelHeader>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {cwd ? (
          <>
            {/* Toolbar — branch · counts · stat · Commit or push (对标图1) */}
            <div className="flex h-11 items-center gap-2 border-hairline border-b px-3">
              <Tooltip content={cwd} side="bottom" sideOffset={6}>
                <span className="flex min-w-0 items-center gap-1.5 text-sm text-fg-muted">
                  <IconGitBranch className="shrink-0 text-fg-subtle" size={14} stroke={1.7} />
                  <span className="max-w-[120px] truncate">{status?.branch ?? "detached"}</span>
                </span>
              </Tooltip>
              <span className="flex items-center gap-1.5 font-mono text-xs">
                <span className="text-success">+{summaryTotals.added}</span>
                <span className="text-danger">-{summaryTotals.removed}</span>
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <Tooltip content="Review current diff" side="bottom" sideOffset={6}>
                  <button
                    aria-label="Review current diff"
                    className="flex size-7 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg-subtle"
                    onClick={() => void startReview()}
                    type="button"
                  >
                    <IconReportSearch size={15} stroke={1.65} />
                  </button>
                </Tooltip>
                <CommitLauncher cwd={cwd} onRefresh={onCommitRefresh} status={status} />
              </div>
            </div>

            {review ? (
              <div className="border-hairline-soft border-b px-3 py-2 text-xs text-fg-subtle">
                <div>{review.summary}</div>
                {review.issues.slice(0, 3).map((issue) => (
                  <div className="mt-1 truncate text-fg-faint" key={issue.id}>
                    {issue.severity}: {issue.title}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        {changes.length === 0 ? (
          <EmptyState
            className={cwd ? "min-h-[260px]" : "h-full"}
            hint={cwd ? `No Local Changes in ${cwdLabel}` : "Open a workspace to review changes."}
            icon={<IconFileDiff size={22} stroke={1.4} />}
          />
        ) : (
          <div>
            {groupedChanges.map((group) =>
              group.items.length > 0 ? (
                <div key={group.title}>
                  <div className="px-3 py-1.5 text-2xs uppercase tracking-wide text-fg-faint">
                    {group.title}
                  </div>
                  {group.items.map((change) => {
                    const selected = selectedPath === change.path;
                    const previewLines = selected ? getPreviewLines(selectedDiff) : [];
                    return (
                      <div
                        className="border-hairline-soft border-b"
                        key={`${change.status}:${change.path}`}
                      >
                        <div
                          className={cn(
                            "group flex h-10 w-full items-center gap-2 px-3 text-left text-sm transition-colors",
                            selected
                              ? "bg-chip-faint text-fg"
                              : "text-fg-muted hover:bg-hover hover:text-fg",
                          )}
                        >
                          <button
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            onClick={() => setSelectedPath(selected ? undefined : change.path)}
                            type="button"
                          >
                            {selected ? (
                              <IconChevronDown
                                className="shrink-0 text-fg-faint"
                                size={13}
                                stroke={1.7}
                              />
                            ) : (
                              <IconChevronRight
                                className="shrink-0 text-fg-faint"
                                size={13}
                                stroke={1.7}
                              />
                            )}
                            <FileIcon path={change.path} />
                            <span className="min-w-0 flex-1 truncate">{change.path}</span>
                            <span className="shrink-0 font-mono text-xs text-success">
                              {selected ? `+${selectedTotals.added}` : ""}
                            </span>
                          </button>
                          <Tooltip content="Revert file" side="bottom" sideOffset={6}>
                            <button
                              aria-label={`Revert ${change.path}`}
                              className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-faint opacity-0 transition-all hover:bg-hover hover:text-fg-subtle group-hover:opacity-100"
                              onClick={() => {
                                if (cwd) {
                                  void window.modus.diff
                                    .revert({ cwd, path: change.path })
                                    .then(() => refreshChanges(cwd));
                                }
                              }}
                              type="button"
                            >
                              <IconRotateClockwise size={15} stroke={1.65} />
                            </button>
                          </Tooltip>
                          {change.staged ? (
                            <Tooltip content="Unstage file" side="bottom" sideOffset={6}>
                              <button
                                aria-label={`Unstage ${change.path}`}
                                className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-faint opacity-0 transition-all hover:bg-hover hover:text-fg-subtle group-hover:opacity-100"
                                onClick={() => void runChangeAction("unstage", change.path)}
                                type="button"
                              >
                                <IconMinus size={15} stroke={1.65} />
                              </button>
                            </Tooltip>
                          ) : (
                            <Tooltip content="Stage file" side="bottom" sideOffset={6}>
                              <button
                                aria-label={`Stage ${change.path}`}
                                className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-faint opacity-0 transition-all hover:bg-hover hover:text-fg-subtle group-hover:opacity-100"
                                onClick={() => void runChangeAction("stage", change.path)}
                                type="button"
                              >
                                <IconPlus size={15} stroke={1.65} />
                              </button>
                            </Tooltip>
                          )}
                          <Tooltip
                            content={
                              change.untracked ? "Untracked discard is disabled" : "Discard file"
                            }
                            side="bottom"
                            sideOffset={6}
                          >
                            <button
                              aria-label={`Discard ${change.path}`}
                              className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-faint opacity-0 transition-all hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-30 group-hover:opacity-100"
                              disabled={change.untracked}
                              onClick={() => void runChangeAction("discard", change.path)}
                              type="button"
                            >
                              <IconTrash size={15} stroke={1.65} />
                            </button>
                          </Tooltip>
                        </div>
                        <AnimatePresence initial={false}>
                          {selected ? (
                            <m.div
                              animate={{ height: "auto", opacity: 1 }}
                              className="overflow-hidden"
                              exit={{ height: 0, opacity: 0 }}
                              initial={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                            >
                              <div className="max-h-[520px] overflow-hidden border-success/35 border-l bg-success/10 font-mono text-2xs leading-6">
                                {previewLines.length === 0 ? (
                                  <div className="px-6 py-3 text-fg-faint">No unstaged diff.</div>
                                ) : (
                                  previewLines.map((line) => (
                                    <div
                                      className={cn(
                                        "flex min-w-0",
                                        line.kind === "add" && "bg-success/12 text-fg",
                                        line.kind === "remove" && "bg-danger/18 text-fg",
                                        line.kind === "meta" && "text-fg-faint",
                                      )}
                                      key={line.key}
                                    >
                                      <span className="w-10 shrink-0 select-none px-2 text-right text-fg-faint">
                                        {line.number}
                                      </span>
                                      <span className="min-w-0 flex-1 truncate whitespace-pre px-2">
                                        {line.text}
                                      </span>
                                    </div>
                                  ))
                                )}
                              </div>
                            </m.div>
                          ) : null}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              ) : null,
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Owns the commit dialog's open state in a tiny isolated subtree.
 *
 * Why this exists: the dialog open/close was janky on repos with many changed
 * files. The state used to live in `DiffPanel`, so every open/close re-rendered
 * the entire change list (hundreds of rows + Base UI tooltips) on the same frame
 * as the dialog's enter/exit animation. Hoisting the toggle here means flipping
 * it only re-renders this button + the dialog, never the list. `memo` keeps it
 * still while the user clicks around the list.
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
        className="flex items-center gap-1.5 rounded-md border border-hairline bg-surface px-2.5 py-1 text-xs text-fg transition-colors hover:bg-hover disabled:opacity-40"
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

function FileIcon({ path }: { path: string }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center text-fg-subtle">
      {iconForPath(path)}
    </span>
  );
}

function iconForPath(path: string): ReactNode {
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? path.toLowerCase();
  const ext = name.includes(".") ? name.split(".").at(-1) : "";
  const props = { size: 16, stroke: 1.65 };

  if (name === "package.json" || name === "package-lock.json" || ext === "json") {
    return <IconJson {...props} />;
  }

  if (ext === "md" || ext === "mdx") {
    return <IconMarkdown {...props} />;
  }

  if (ext === "tsx") return <IconFileTypeTsx {...props} />;
  if (ext === "ts") return <IconFileTypeTs {...props} />;
  if (ext === "jsx") return <IconFileTypeJsx {...props} />;
  if (ext === "js" || ext === "mjs" || ext === "cjs") return <IconFileTypeJs {...props} />;
  if (ext === "css") return <IconFileTypeCss {...props} />;
  if (ext === "html") return <IconFileTypeHtml {...props} />;
  if (ext === "svg") return <IconFileTypeSvg {...props} />;
  if (ext === "rs") return <IconFileTypeRs {...props} />;
  if (["toml", "yaml", "yml"].includes(ext ?? "")) return <IconBraces {...props} />;
  if (["lock", "config", "conf"].includes(ext ?? "")) return <IconFileCode {...props} />;

  return <IconFile {...props} />;
}

function getDiffTotals(diff: string): { added: number; removed: number } {
  return diff.split("\n").reduce(
    (total, line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) total.added += 1;
      if (line.startsWith("-") && !line.startsWith("---")) total.removed += 1;
      return total;
    },
    { added: 0, removed: 0 },
  );
}

function getPreviewLines(diff: string): Array<{
  kind: "add" | "remove" | "meta" | "context";
  key: string;
  number: string;
  text: string;
}> {
  let lineNumber = 0;
  return diff
    .split("\n")
    .filter((line) => line && !line.startsWith("diff --git") && !line.startsWith("index "))
    .slice(0, 120)
    .map((line) => {
      if (line.startsWith("@@")) {
        lineNumber = Number(line.match(/\+(\d+)/)?.[1] ?? 0);
        return { key: `meta:${line}`, kind: "meta", number: "", text: line };
      }
      if (line.startsWith("+") && !line.startsWith("+++")) {
        const number = String(lineNumber++);
        return { key: `add:${number}:${line}`, kind: "add", number, text: line };
      }
      if (line.startsWith("-") && !line.startsWith("---")) {
        return { key: `remove:${lineNumber}:${line}`, kind: "remove", number: "", text: line };
      }
      const number = lineNumber ? String(lineNumber++) : "";
      return { key: `context:${number}:${line}`, kind: "context", number, text: line };
    });
}
