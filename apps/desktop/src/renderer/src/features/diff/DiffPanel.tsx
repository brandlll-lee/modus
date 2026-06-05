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
  IconFolder,
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
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { AgentReviewResult, FileChange } from "../../../../shared/contracts";
import { EmptyState, PanelHeader } from "../../components/ui/Panel";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";

type DiffPanelProps = {
  cwd?: string | undefined;
  sessionId?: string | undefined;
  workspaceId?: string | undefined;
};

export function DiffPanel({ cwd, sessionId, workspaceId }: DiffPanelProps) {
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | undefined>();
  const [commitMessage, setCommitMessage] = useState("");
  const [review, setReview] = useState<AgentReviewResult | undefined>();
  const [summaryDiff, setSummaryDiff] = useState("");
  const [selectedDiff, setSelectedDiff] = useState("");

  const refreshChanges = useCallback(async (targetCwd: string | undefined): Promise<void> => {
    if (!targetCwd) {
      setChanges([]);
      setSummaryDiff("");
      setSelectedDiff("");
      return;
    }

    const nextChanges = await window.modus.diff.list(targetCwd);
    const nextSummary = await window.modus.diff.read({ cwd: targetCwd });
    const reviews = await window.modus.review.list(targetCwd);
    setChanges(nextChanges);
    setSummaryDiff(nextSummary.diff);
    setReview(reviews[0]);
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
  const hasStagedChanges = useMemo(() => changes.some((change) => change.staged), [changes]);
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

  async function commit(): Promise<void> {
    if (!cwd || !commitMessage.trim() || !hasStagedChanges) return;
    await window.modus.diff.commit({ cwd, message: commitMessage.trim() });
    setCommitMessage("");
    await refreshChanges(cwd);
  }

  async function startReview(): Promise<void> {
    if (!cwd) return;
    setReview(await window.modus.review.start({ cwd, sessionId, workspaceId }));
  }

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
        {changes.length === 0 ? (
          <EmptyState
            className="h-full"
            hint={cwd ? "No Local Changes" : "Open a workspace to review changes."}
            icon={<IconFileDiff size={22} stroke={1.4} />}
          />
        ) : (
          <div>
            <div className="flex h-10 items-center gap-2 border-hairline border-b px-3 text-sm text-fg">
              <IconFolder className="text-fg-subtle" size={15} stroke={1.65} />
              <span>{changes.length} Uncommitted Changes</span>
              <IconChevronDown className="text-fg-faint" size={13} stroke={1.7} />
              <span className="font-mono text-success">+{summaryTotals.added}</span>
              <span className="font-mono text-danger">-{summaryTotals.removed}</span>
              <div className="ml-auto flex items-center gap-1">
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
            <div className="flex gap-1 border-hairline-soft border-b p-2">
              <input
                className="min-w-0 flex-1 rounded-md border border-hairline bg-transparent px-2 text-xs text-fg outline-none placeholder:text-fg-faint"
                onChange={(event) => setCommitMessage(event.target.value)}
                placeholder="Commit message"
                value={commitMessage}
              />
              <button
                className="flex items-center gap-1 rounded-md border border-hairline px-2 text-xs text-fg-subtle transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
                disabled={!commitMessage.trim() || !hasStagedChanges}
                onClick={() => void commit()}
                title={
                  hasStagedChanges ? "Commit staged changes" : "Stage at least one file to commit"
                }
                type="button"
              >
                <IconGitCommit size={14} stroke={1.65} />
                Commit
              </button>
            </div>
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
                              ? "bg-white/[0.025] text-fg"
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
