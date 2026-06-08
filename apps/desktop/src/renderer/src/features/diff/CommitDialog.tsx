import { Dialog } from "@base-ui/react/dialog";
import { Popover } from "@base-ui/react/popover";
import {
  IconArrowDown,
  IconCheck,
  IconChevronDown,
  IconCloudUpload,
  IconGitBranch,
  IconGitCommit,
  IconLoader2,
  IconPlus,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GitBranch, GitBranchSummary, GitStatusSummary } from "../../../../shared/contracts";
import { cn } from "../../lib/cn";

type CommitAction = "commit" | "commit-and-push" | "push";
type DialogAction = CommitAction | "pull" | "fetch";

type CommitDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  cwd: string | undefined;
  status: GitStatusSummary | undefined;
  /** Re-fetch panel state after a successful git action (commit/push/checkout/pull/fetch). */
  onRefresh(): void | Promise<void>;
};

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/**
 * Centered commit/push modal with a full branch switcher.
 *
 * Header carries a live branch picker (switch / create) + diff stat; the body
 * is the commit message + "include unstaged" toggle; the footer stacks every
 * git action: Commit / Commit and push / Push, then Pull / Fetch. Each action
 * calls the real `diff.commitOrPush` / `git.*` IPC.
 *
 * Perf: the backdrop is a plain translucent layer (no `backdrop-filter: blur`,
 * which forces a full-screen GPU re-raster of the busy app behind it on every
 * open frame and was the source of the open-animation jank).
 */
export function CommitDialog({ open, onOpenChange, cwd, status, onRefresh }: CommitDialogProps) {
  const [message, setMessage] = useState("");
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [busy, setBusy] = useState<DialogAction | undefined>();
  const [error, setError] = useState<string | undefined>();
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [branches, setBranches] = useState<GitBranchSummary | undefined>();
  const [branchQuery, setBranchQuery] = useState("");
  const [branchBusy, setBranchBusy] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");

  // Reset transient state every time the dialog opens.
  useEffect(() => {
    if (open) {
      setMessage("");
      setError(undefined);
      setBusy(undefined);
      setIncludeUnstaged(true);
      setBranchPickerOpen(false);
      setBranchQuery("");
      setCreating(false);
      setNewBranchName("");
    }
  }, [open]);

  const refreshBranches = useCallback(async (): Promise<void> => {
    if (!cwd) {
      setBranches(undefined);
      return;
    }
    try {
      setBranches(await window.modus.git.branches(cwd));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [cwd]);

  // Branch list is fetched lazily — only when the picker is actually opened.
  useEffect(() => {
    if (branchPickerOpen) {
      void refreshBranches();
    }
  }, [branchPickerOpen, refreshBranches]);

  const stagedCount = status?.stagedCount ?? 0;
  const unstagedCount = status?.unstagedCount ?? 0;
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const hasUpstream = status?.hasUpstream ?? false;
  const hasRemote = status?.hasRemote ?? false;
  // With nothing staged, you must include unstaged changes to have anything to commit.
  const willCommitSomething = includeUnstaged ? stagedCount + unstagedCount > 0 : stagedCount > 0;
  const canCommit = message.trim().length > 0 && willCommitSomething && !busy;
  // Push alone is meaningful when there are local commits ahead, or no upstream yet.
  const canPushOnly = !busy && (ahead > 0 || !hasUpstream) && hasRemote;

  const filteredLocal = useMemo(
    () => filterBranches(branches?.local ?? [], branchQuery),
    [branches?.local, branchQuery],
  );
  const filteredRemote = useMemo(
    () => filterBranches(branches?.remote ?? [], branchQuery),
    [branches?.remote, branchQuery],
  );

  async function run(action: CommitAction): Promise<void> {
    if (!cwd) return;
    setBusy(action);
    setError(undefined);
    try {
      await window.modus.diff.commitOrPush({
        cwd,
        ...(action === "push" ? {} : { message: message.trim() }),
        stageAll: includeUnstaged,
        commit: action !== "push",
        push: action !== "commit",
      });
      await onRefresh();
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(undefined);
    }
  }

  async function runSync(action: "pull" | "fetch"): Promise<void> {
    if (!cwd) return;
    setBusy(action);
    setError(undefined);
    try {
      if (action === "pull") {
        await window.modus.git.pull(cwd);
      } else {
        await window.modus.git.fetch(cwd);
      }
      await Promise.all([onRefresh(), refreshBranches()]);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(undefined);
    }
  }

  async function switchBranch(branch: GitBranch): Promise<void> {
    if (!cwd || busy || branchBusy || branch.current) return;
    setBranchBusy(branch.name);
    setError(undefined);
    try {
      await window.modus.git.checkout({ cwd, name: branch.name, remote: branch.remote });
      setBranchPickerOpen(false);
      await Promise.all([onRefresh(), refreshBranches()]);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBranchBusy(undefined);
    }
  }

  async function submitCreateBranch(): Promise<void> {
    const name = newBranchName.trim();
    if (!cwd || !name || branchBusy) return;
    setBranchBusy("\u0000create");
    setError(undefined);
    try {
      await window.modus.git.createBranch({ cwd, name });
      setCreating(false);
      setNewBranchName("");
      setBranchPickerOpen(false);
      await Promise.all([onRefresh(), refreshBranches()]);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBranchBusy(undefined);
    }
  }

  function onMessageKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // Ctrl/Cmd+Enter → Commit (matches the reference shortcut hint).
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canCommit) {
      event.preventDefault();
      void run("commit");
    }
  }

  const branchListEmpty = filteredLocal.length === 0 && filteredRemote.length === 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn(
            "fixed inset-0 z-50 bg-black/50 transition-opacity duration-150 ease-out-quint",
            "data-ending-style:opacity-0 data-starting-style:opacity-0",
          )}
        />
        <Dialog.Popup
          className={cn(
            "-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 w-[min(440px,calc(100vw-2rem))]",
            "origin-center overflow-hidden rounded-xl border border-hairline bg-elevated shadow-popup outline-none",
            "transition-[transform,opacity] duration-150 ease-out-quint",
            "data-ending-style:scale-[0.97] data-ending-style:opacity-0",
            "data-starting-style:scale-[0.97] data-starting-style:opacity-0",
          )}
          initialFocus={messageRef}
        >
          {/* Header: branch switcher + diff stat */}
          <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2">
            <Popover.Root open={branchPickerOpen} onOpenChange={setBranchPickerOpen}>
              <Popover.Trigger
                className={cn(
                  "flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-fg-muted",
                  "transition-colors hover:bg-hover hover:text-fg data-popup-open:bg-hover",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
                disabled={!cwd}
                type="button"
              >
                <IconGitBranch className="shrink-0 text-fg-subtle" size={14} stroke={1.7} />
                <span className="max-w-[180px] truncate font-medium">
                  {status?.branch ?? "detached"}
                </span>
                <IconChevronDown className="shrink-0 text-fg-faint" size={13} stroke={1.7} />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner align="start" className="z-70" side="bottom" sideOffset={6}>
                  <Popover.Popup
                    className={cn(
                      "origin-(--transform-origin) flex w-[300px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden",
                      "rounded-lg border border-hairline bg-elevated shadow-popup outline-none",
                      "transition-[transform,opacity] duration-100 ease-out-quint",
                      "data-ending-style:scale-[0.98] data-ending-style:opacity-0",
                      "data-starting-style:scale-[0.98] data-starting-style:opacity-0",
                    )}
                  >
                    {/* Filter */}
                    <div className="flex items-center gap-1.5 border-hairline-soft border-b px-2.5 py-2">
                      <IconSearch className="shrink-0 text-fg-faint" size={13} stroke={1.8} />
                      <input
                        className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint"
                        onChange={(event) => setBranchQuery(event.target.value)}
                        placeholder="Filter branches…"
                        value={branchQuery}
                      />
                    </div>

                    {/* Branch list */}
                    <div className="scroll-thin max-h-[280px] min-h-0 flex-1 overflow-y-auto p-1">
                      {branchListEmpty ? (
                        <div className="px-2.5 py-6 text-center text-xs text-fg-faint">
                          {branches ? "No matching branches" : "Loading branches…"}
                        </div>
                      ) : (
                        <>
                          {filteredLocal.length > 0 ? (
                            <BranchSection title="Local">
                              {filteredLocal.map((branch) => (
                                <BranchRow
                                  branch={branch}
                                  busy={branchBusy === branch.name}
                                  disabled={Boolean(branchBusy)}
                                  key={`local:${branch.name}`}
                                  onSelect={() => void switchBranch(branch)}
                                />
                              ))}
                            </BranchSection>
                          ) : null}
                          {filteredRemote.length > 0 ? (
                            <BranchSection title="Remote">
                              {filteredRemote.map((branch) => (
                                <BranchRow
                                  branch={branch}
                                  busy={branchBusy === branch.name}
                                  disabled={Boolean(branchBusy)}
                                  key={`remote:${branch.name}`}
                                  onSelect={() => void switchBranch(branch)}
                                />
                              ))}
                            </BranchSection>
                          ) : null}
                        </>
                      )}
                    </div>

                    {/* Create new branch */}
                    <div className="border-hairline-soft border-t p-1">
                      {creating ? (
                        <div className="flex items-center gap-1.5 px-1.5 py-1">
                          <IconGitBranch
                            className="shrink-0 text-fg-subtle"
                            size={14}
                            stroke={1.7}
                          />
                          <input
                            // biome-ignore lint/a11y/noAutofocus: focus the field the user just revealed
                            autoFocus
                            className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint"
                            onChange={(event) => setNewBranchName(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void submitCreateBranch();
                              } else if (event.key === "Escape") {
                                event.preventDefault();
                                setCreating(false);
                                setNewBranchName("");
                              }
                            }}
                            placeholder="new-branch-name"
                            value={newBranchName}
                          />
                          <button
                            className="flex size-6 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
                            disabled={!newBranchName.trim() || Boolean(branchBusy)}
                            onClick={() => void submitCreateBranch()}
                            type="button"
                          >
                            {branchBusy === "\u0000create" ? (
                              <IconLoader2 className="animate-spin" size={14} stroke={1.8} />
                            ) : (
                              <IconCheck size={14} stroke={2} />
                            )}
                          </button>
                        </div>
                      ) : (
                        <button
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                          onClick={() => setCreating(true)}
                          type="button"
                        >
                          <span className="flex w-4 shrink-0 justify-center">
                            <IconPlus size={14} stroke={1.8} />
                          </span>
                          Create new branch…
                        </button>
                      )}
                    </div>
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>

            <div className="flex shrink-0 items-center gap-2 font-mono text-xs">
              <span className="text-success">+{status?.added ?? 0}</span>
              <span className="text-danger">-{status?.removed ?? 0}</span>
            </div>
          </div>

          <Dialog.Title className="sr-only">Commit or push changes</Dialog.Title>

          {/* Commit message */}
          <div className="px-4">
            <textarea
              className={cn(
                "scroll-thin h-24 w-full resize-none rounded-lg border border-hairline bg-canvas px-3 py-2.5",
                "text-sm text-fg leading-relaxed outline-none transition-colors placeholder:text-fg-faint",
                "focus:border-hairline-strong",
              )}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={onMessageKeyDown}
              placeholder="Commit message (leave blank to generate)…"
              ref={messageRef}
              value={message}
            />
          </div>

          {/* Include unstaged toggle */}
          <button
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-fg-muted transition-colors hover:text-fg"
            onClick={() => setIncludeUnstaged((value) => !value)}
            type="button"
          >
            <span
              className={cn(
                "flex size-4 items-center justify-center rounded border transition-colors",
                includeUnstaged
                  ? "border-accent bg-accent text-on-accent"
                  : "border-hairline-strong bg-transparent",
              )}
            >
              {includeUnstaged ? <IconCheck size={12} stroke={2.5} /> : null}
            </span>
            <span>Include unstaged changes</span>
            <span className="ml-auto font-mono text-2xs text-fg-faint">
              {stagedCount + (includeUnstaged ? unstagedCount : 0)} files
            </span>
          </button>

          {error ? (
            <div className="mx-4 mb-2 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-md border border-danger/30 bg-danger/8 px-2.5 py-2 text-xs text-danger">
              {error}
            </div>
          ) : null}

          {/* Commit / push actions */}
          <div className="border-hairline-soft border-t">
            <ActionRow
              busy={busy === "commit"}
              disabled={!canCommit}
              icon={<IconGitCommit size={16} stroke={1.7} />}
              label="Commit"
              onClick={() => void run("commit")}
              shortcut="Ctrl+⏎"
            />
            <ActionRow
              busy={busy === "commit-and-push"}
              disabled={!canCommit || !hasRemote}
              icon={<IconCloudUpload size={16} stroke={1.7} />}
              label="Commit and push"
              onClick={() => void run("commit-and-push")}
            />
            <ActionRow
              busy={busy === "push"}
              disabled={!canPushOnly}
              icon={<IconCloudUpload size={16} stroke={1.7} />}
              label={ahead > 0 ? `Push (${ahead})` : "Push"}
              onClick={() => void run("push")}
            />
          </div>

          {/* Sync actions */}
          <div className="border-hairline-soft border-t">
            <ActionRow
              busy={busy === "pull"}
              disabled={Boolean(busy) || !hasUpstream}
              icon={<IconArrowDown size={16} stroke={1.7} />}
              label={behind > 0 ? `Pull (${behind})` : "Pull"}
              onClick={() => void runSync("pull")}
            />
            <ActionRow
              busy={busy === "fetch"}
              disabled={Boolean(busy) || !hasRemote}
              icon={<IconRefresh size={16} stroke={1.7} />}
              label="Fetch"
              onClick={() => void runSync("fetch")}
            />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function filterBranches(list: GitBranch[], query: string): GitBranch[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return list;
  return list.filter((branch) => branch.name.toLowerCase().includes(trimmed));
}

function BranchSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-0.5">
      <div className="px-2.5 py-1 text-2xs uppercase tracking-wide text-fg-faint">{title}</div>
      {children}
    </div>
  );
}

function BranchRow({
  branch,
  busy,
  disabled,
  onSelect,
}: {
  branch: GitBranch;
  busy: boolean;
  disabled: boolean;
  onSelect(): void;
}) {
  return (
    <button
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        branch.current
          ? "text-fg"
          : "text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-50",
      )}
      disabled={disabled || branch.current}
      onClick={onSelect}
      type="button"
    >
      <span className="flex w-4 shrink-0 justify-center text-fg-subtle">
        {busy ? (
          <IconLoader2 className="animate-spin" size={13} stroke={1.8} />
        ) : branch.current ? (
          <IconCheck size={13} stroke={2} />
        ) : (
          <IconGitBranch
            className="opacity-0 transition-opacity group-hover:opacity-60"
            size={13}
            stroke={1.6}
          />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{branch.name}</span>
      {branch.current ? <span className="shrink-0 text-2xs text-fg-faint">current</span> : null}
    </button>
  );
}

function ActionRow({
  icon,
  label,
  shortcut,
  disabled,
  busy,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  busy?: boolean;
  onClick(): void;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors",
        disabled
          ? "cursor-not-allowed text-fg-faint"
          : "text-fg-muted hover:bg-hover hover:text-fg",
      )}
      disabled={disabled || busy}
      onClick={onClick}
      type="button"
    >
      <span
        className={cn("flex size-4 items-center justify-center", !disabled && "text-fg-subtle")}
      >
        {busy ? <IconLoader2 className="animate-spin" size={16} stroke={1.7} /> : icon}
      </span>
      <span className="flex-1">{label}</span>
      {shortcut ? <span className="font-mono text-2xs text-fg-faint">{shortcut}</span> : null}
    </button>
  );
}
