import {
  IconBook2,
  IconCube,
  IconFile,
  IconFolder,
  IconGitBranch,
  IconLayoutList,
  IconMessage2,
  IconPencil,
  IconSearch,
  IconTerminal2,
  IconWorld,
} from "@tabler/icons-react";
import { m } from "motion/react";
import { type KeyboardEvent, memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  ContextItem,
  MessageContextChip,
  PromptImageAttachment,
  SkillSelection,
} from "../../../../shared/contracts";
import { CopyButton } from "../../components/ui/CopyButton";
import { ImageThumb } from "../../components/ui/ImageViewer";
import { ShinyText } from "../../components/ui/ShinyText";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";
import { formatClock } from "../../lib/formatClock";
import { useSmoothStreamingText } from "../../lib/useSmoothStreamingText";
import { ContextMentionMenu } from "../composer/ContextMentionMenu";
import { ContextToken } from "../composer/ContextToken";
import { SlashMenu } from "../composer/SlashMenu";
import { type MentionRow, useComposerMentions } from "../composer/useComposerMentions";
import { type SlashItem, useComposerSlash } from "../composer/useComposerSlash";
import { CheckpointRestoreButton } from "./CheckpointRestoreButton";
import { MarkdownMessage } from "./MarkdownMessage";

type MessageBlockProps = {
  messageRole: "assistant" | "user";
  /** Timeline id of this message — the rollback anchor for edit & resend. */
  messageId: string;
  content: string;
  streaming?: boolean;
  /** Epoch ms — user send time. */
  createdAt?: number;
  /** User only: pre-run snapshot this message can roll the files back to. */
  checkpointId?: string;
  onRestoreCheckpoint?(checkpointId: string): Promise<void> | void;
  /** User only: this message anchors a rollback point and can be edited. */
  editable?: boolean;
  /** Rolls the session back to this message, then resends the edited text. */
  onEditResend?(
    messageId: string,
    message: string,
    attachments?: PromptImageAttachment[],
    contextItems?: ContextItem[],
    skills?: SkillSelection[],
  ): Promise<void>;
  workspaceId?: string | undefined;
  cwd?: string | undefined;
  /** User only: images attached to the prompt, rendered as thumbnails. */
  attachments?: PromptImageAttachment[];
  /** User only: context chips attached to the prompt, kept visible after send. */
  contextChips?: MessageContextChip[];
  /** User only: original context items for edit-and-resend. */
  contextItems?: ContextItem[];
  /** User only: selected skills attached to the prompt. */
  skills?: SkillSelection[];
};

export const MessageBlock = memo(function MessageBlock({
  messageRole,
  messageId,
  content,
  streaming = false,
  createdAt,
  checkpointId,
  onRestoreCheckpoint,
  editable = false,
  onEditResend,
  workspaceId,
  cwd,
  attachments,
  contextChips,
  contextItems,
  skills,
}: MessageBlockProps) {
  const [editing, setEditing] = useState(false);
  // Smoothly reveal assistant text like a typewriter, decoupled from bursty
  // provider chunks. User messages are already complete, so this is a no-op.
  const displayContent = useSmoothStreamingText(content, streaming);

  if (messageRole === "user") {
    if (!content.trim()) return null;

    if (editing && onEditResend) {
      const editableContextItems =
        contextItems ?? contextItemsFromChips(contextChips ?? [], workspaceId);
      return (
        <UserMessageEditor
          {...(attachments ? { attachments } : {})}
          canRestoreFiles={Boolean(checkpointId)}
          cwd={cwd}
          initialContextItems={editableContextItems}
          initialSkills={skills ?? []}
          initialText={content}
          onCancel={() => setEditing(false)}
          onSend={(text, nextContextItems, nextSkills) =>
            onEditResend(messageId, text, attachments, nextContextItems, nextSkills)
          }
          workspaceId={workspaceId}
        />
      );
    }

    return (
      <div className="group flex min-w-0 max-w-full flex-col items-end gap-1">
        <div className="min-w-0 max-w-[78%] rounded-xl border border-hairline-soft bg-surface/95 px-4 py-2.5 text-sm text-fg leading-relaxed shadow-composer">
          {attachments && attachments.length > 0 ? (
            <div className="mb-2 flex flex-wrap justify-end gap-1.5">
              {attachments.map((attachment, index) => (
                <ImageThumb
                  alt={attachment.name ?? `attachment ${index + 1}`}
                  className="max-h-44 max-w-full rounded-lg border border-hairline object-contain"
                  key={`${attachment.name ?? "image"}:${attachment.data.length}:${attachment.data.slice(-24)}`}
                  src={`data:${attachment.mimeType};base64,${attachment.data}`}
                  title={attachment.name}
                />
              ))}
            </div>
          ) : null}
          <div className="whitespace-pre-wrap wrap-break-word">
            {contextChips?.map((chip) => (
              <InlineContextToken
                chip={chip}
                key={`${chip.kind}:${chip.label}:${chip.detail ?? ""}`}
              />
            ))}
            {(skills ?? []).map((skill) => (
              <InlineSkillToken key={skill.path} name={skill.name} />
            ))}
            {content}
          </div>
        </div>
        <div className="flex h-6 max-w-full items-center gap-1 pr-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <span className="text-2xs text-fg-faint tabular-nums">{formatClock(createdAt)}</span>
          {checkpointId && onRestoreCheckpoint ? (
            <CheckpointRestoreButton checkpointId={checkpointId} onRestore={onRestoreCheckpoint} />
          ) : null}
          <CopyButton label="Copy message" text={content} />
          {editable && onEditResend ? (
            <Tooltip content="Edit" side="top" sideOffset={6}>
              <button
                aria-label="Edit message"
                className="flex size-6 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg-muted"
                onClick={() => setEditing(true)}
                type="button"
              >
                <IconPencil size={13} stroke={1.8} />
              </button>
            </Tooltip>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full text-sm leading-relaxed">
      {content ? <MarkdownMessage content={displayContent} streaming={streaming} /> : null}
    </div>
  );
});

type UserMessageEditorProps = {
  initialText: string;
  initialContextItems: ContextItem[];
  initialSkills: SkillSelection[];
  workspaceId: string | undefined;
  cwd: string | undefined;
  /** Original attachments, kept read-only and resent with the edited text. */
  attachments?: PromptImageAttachment[];
  /** A pre-run snapshot exists, so sending also restores workspace files. */
  canRestoreFiles: boolean;
  onCancel(): void;
  onSend(text: string, contextItems: ContextItem[], skills: SkillSelection[]): Promise<void>;
};

/**
 * In-place editor for a previously sent user message (Cursor-style edit &
 * resend). Replaces the bubble with a full-width composer-like field; Send
 * rolls the session back to this point and re-prompts with the edited text,
 * Cancel (or Esc) returns to the read-only bubble. While the rollback is in
 * flight the editor locks and shows an inline loading label; failures surface inline and
 * keep the draft so the action can be retried.
 */
function UserMessageEditor({
  initialText,
  initialContextItems,
  initialSkills,
  workspaceId,
  cwd,
  attachments,
  canRestoreFiles,
  onCancel,
  onSend,
}: UserMessageEditorProps) {
  const [draft, setDraft] = useState(initialText);
  const [contextItems, setContextItems] = useState<ContextItem[]>(initialContextItems);
  const [selectedSkills, setSelectedSkills] = useState<SkillSelection[]>(initialSkills);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const {
    activeIndex,
    isOpen,
    mention,
    rows: mentionRows,
    setActiveIndex,
    moveActive,
    openCategory,
    backToRoot,
    atCategoryRoot,
    expandMore,
  } = useComposerMentions({ cwd, value: draft, workspaceId });
  const slash = useComposerSlash({ cwd, value: draft });
  const hasText = draft.trim().length > 0;
  const hasSelectedSkills = selectedSkills.length > 0;
  const hasInlineTokens = contextItems.length > 0 || hasSelectedSkills;

  // Composer-style autosize: grow with content up to a cap, then scroll.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  });

  // Focus with the caret at the end, like Cursor's message editor.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  const canSend = (hasText || hasSelectedSkills) && !sending;

  async function send(): Promise<void> {
    if (!canSend) {
      return;
    }
    setSending(true);
    setError(undefined);
    try {
      // On success this block unmounts (the timeline reloads truncated
      // events), so the loading label holds until the rolled-back view replaces it.
      await onSend(draft.trim() || "Use the selected skill(s).", contextItems, selectedSkills);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSending(false);
    }
  }

  function selectSlashItem(item: SlashItem): void {
    if (item.kind === "skill") {
      setSelectedSkills((current) =>
        current.some((skill) => skill.path === item.skill.path)
          ? current
          : [...current, { name: item.skill.name, path: item.skill.path }],
      );
      setDraft("");
      return;
    }
    setDraft(item.command.prefix);
  }

  function addContextItem(item: ContextItem): void {
    const key = contextItemKey(item);
    setContextItems((current) =>
      current.some((existing) => contextItemKey(existing) === key) ? current : [...current, item],
    );
    if (mention) {
      setDraft(
        `${draft.slice(0, mention.start)}${draft.slice(mention.start).replace(/@[^\s]*$/, "")}`,
      );
    }
  }

  function selectMentionRow(row: MentionRow): void {
    if (row.row === "nav") {
      openCategory(row.target);
    } else if (row.row === "add") {
      addContextItem(row.item);
    } else if (row.row === "more") {
      expandMore();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (slash.isOpen && event.key === "ArrowDown") {
      event.preventDefault();
      slash.setActiveIndex((index) => (index + 1) % slash.items.length);
      return;
    }
    if (slash.isOpen && event.key === "ArrowUp") {
      event.preventDefault();
      slash.setActiveIndex((index) => (index - 1 + slash.items.length) % slash.items.length);
      return;
    }
    if (slash.isOpen && event.key === "Escape") {
      event.preventDefault();
      setDraft("");
      return;
    }
    if (slash.isOpen && (event.key === "Enter" || event.key === "Tab")) {
      const item = slash.items[slash.activeIndex];
      if (item) {
        event.preventDefault();
        selectSlashItem(item);
        return;
      }
    }

    if (!draft && event.key === "Backspace") {
      if (selectedSkills.length > 0) {
        event.preventDefault();
        setSelectedSkills((current) => current.slice(0, -1));
        return;
      }
      const lastContextItem = contextItems.at(-1);
      if (lastContextItem) {
        event.preventDefault();
        const key = contextItemKey(lastContextItem);
        setContextItems((current) => current.filter((item) => contextItemKey(item) !== key));
        return;
      }
    }

    if (isOpen && event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
      return;
    }
    if (isOpen && event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (isOpen && atCategoryRoot && event.key === "Backspace") {
      event.preventDefault();
      backToRoot();
      return;
    }
    if (isOpen && event.key === "Escape") {
      event.preventDefault();
      setDraft((current) => (mention ? current.slice(0, mention.start) : current));
      return;
    }
    if (isOpen && (event.key === "Enter" || event.key === "Tab")) {
      const row = mentionRows[activeIndex];
      if (row && row.row !== "header") {
        event.preventDefault();
        selectMentionRow(row);
        return;
      }
    }

    if (event.key === "Escape" && !sending) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <m.div
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "rounded-[14px] border border-composer-border bg-surface px-4 pt-3 pb-2.5 shadow-composer-edge",
        "transition-[border-color,box-shadow] duration-150",
        !sending && "focus-within:border-focus-ring focus-within:shadow-composer-focus",
      )}
      initial={{ opacity: 0, scale: 0.99 }}
      transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
    >
      {attachments && attachments.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((attachment, index) => (
            <ImageThumb
              alt={attachment.name ?? `attachment ${index + 1}`}
              className="size-12 rounded-lg border border-hairline object-cover"
              key={`${attachment.name ?? "image"}:${attachment.data.length}:${attachment.data.slice(-24)}`}
              src={`data:${attachment.mimeType};base64,${attachment.data}`}
              title={attachment.name}
            />
          ))}
        </div>
      ) : null}
      <div className="relative">
        <div
          className={cn(
            "flex flex-wrap items-start gap-x-1 gap-y-1",
            hasInlineTokens ? "min-h-7" : "",
          )}
        >
          {contextItems.map((item) => (
            <ContextToken
              item={item}
              key={contextItemKey(item)}
              onRemove={() => {
                const key = contextItemKey(item);
                setContextItems((current) =>
                  current.filter((other) => contextItemKey(other) !== key),
                );
              }}
            />
          ))}
          {selectedSkills.map((skill) => (
            <span
              className="inline-flex h-6 items-center gap-1.5 font-medium text-focus-ring text-sm"
              key={skill.path}
            >
              <IconCube size={15} stroke={1.8} />
              <span>{skill.name}</span>
            </span>
          ))}
          <textarea
            aria-label="Edit message"
            className="scroll-thin block min-h-7 min-w-[180px] flex-1 resize-none overflow-y-auto bg-transparent text-sm text-fg leading-relaxed outline-none disabled:opacity-60"
            disabled={sending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            ref={textareaRef}
            rows={1}
            value={draft}
          />
        </div>
        <ContextMentionMenu
          activeIndex={activeIndex}
          onHover={setActiveIndex}
          onSelect={selectMentionRow}
          rows={isOpen ? mentionRows : []}
        />
        {slash.isOpen ? (
          <SlashMenu
            activeIndex={slash.activeIndex}
            items={slash.items}
            onSelect={selectSlashItem}
          />
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-2xs",
            error ? "text-danger" : "text-fg-faint",
          )}
          title={error}
        >
          {error ??
            (canRestoreFiles
              ? "Sending restores workspace files and removes the messages after this point."
              : "Sending removes the messages after this point.")}
        </span>
        <button
          className="flex h-7 shrink-0 items-center rounded-full border border-hairline bg-transparent px-3.5 text-xs text-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          disabled={sending}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-fg px-4 text-xs font-medium text-canvas transition-colors hover:bg-fg-muted active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-chip-strong disabled:text-fg-faint"
          disabled={!canSend}
          onClick={() => void send()}
          type="button"
        >
          {sending ? <ShinyText className="text-canvas">Sending…</ShinyText> : "Send"}
        </button>
      </div>
    </m.div>
  );
}

function contextItemKey(item: ContextItem): string {
  if (item.type === "file" || item.type === "folder") {
    return `${item.type}:${item.path}`;
  }
  if (item.type === "doc") {
    return `doc:${item.docId}`;
  }
  if (item.type === "terminal") {
    return `terminal:${item.terminalId}:${item.range?.fromLine ?? ""}:${item.range?.toLine ?? ""}`;
  }
  if (item.type === "git-diff") {
    return `git-diff:${item.mode}:${item.base ?? ""}`;
  }
  if (item.type === "recent-changes") {
    return `recent-changes:${item.limit ?? ""}`;
  }
  if (item.type === "search") {
    return `search:${item.query}`;
  }
  if (item.type === "design-element") {
    return `design-element:${item.element.id}`;
  }
  return item.type;
}

function contextItemsFromChips(
  chips: MessageContextChip[],
  workspaceId: string | undefined,
): ContextItem[] {
  return chips.flatMap((chip): ContextItem[] => {
    if (chip.kind === "git-diff") {
      return [{ type: "git-diff", mode: chip.label === "Branch" ? "branch" : "working-state" }];
    }
    if (chip.kind === "browser") {
      return [{ type: "browser", ...(workspaceId ? { workspaceId } : {}) }];
    }
    if (chip.kind === "project-summary") {
      return [{ type: "project-summary" }];
    }
    if (chip.kind === "recent-changes") {
      return [{ type: "recent-changes" }];
    }
    if (chip.kind === "rules") {
      return [{ type: "rules" }];
    }
    if (chip.kind === "search" && chip.label.startsWith("search:")) {
      return [{ type: "search", query: chip.label.slice("search:".length) }];
    }
    return [];
  });
}

function InlineContextToken({ chip }: { chip: MessageContextChip }) {
  return (
    <span
      className="mr-1 inline-flex max-w-[220px] items-center gap-1 align-[-0.15em] font-medium text-focus-ring text-sm"
      title={chip.detail ? `${chip.label} — ${chip.detail}` : chip.label}
    >
      {chip.kind === "design-element" ? <InspectGlyph /> : <ContextKindIcon kind={chip.kind} />}
      <span className="truncate">{chip.label}</span>
    </span>
  );
}

function InlineSkillToken({ name }: { name: string }) {
  return (
    <span
      className="mr-1 inline-flex max-w-[220px] items-center gap-1 align-[-0.15em] font-medium text-focus-ring text-sm"
      title={name}
    >
      <IconCube className="size-3.5 shrink-0" stroke={1.8} />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** Muted leading icon for non-design context kinds. */
function ContextKindIcon({ kind }: { kind: MessageContextChip["kind"] }) {
  const props = { className: "size-3 shrink-0", stroke: 1.8 } as const;
  switch (kind) {
    case "folder":
      return <IconFolder {...props} />;
    case "doc":
    case "rules":
      return <IconBook2 {...props} />;
    case "terminal":
      return <IconTerminal2 {...props} />;
    case "browser":
      return <IconWorld {...props} />;
    case "past-chat":
      return <IconMessage2 {...props} />;
    case "git-diff":
    case "recent-changes":
      return <IconGitBranch {...props} />;
    case "project-summary":
      return <IconLayoutList {...props} />;
    case "search":
      return <IconSearch {...props} />;
    default:
      return <IconFile {...props} />;
  }
}

/** Pointer-in-frame inspect glyph — identical to the composer token + popover. */
function InspectGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="size-3 shrink-0"
      fill="none"
      height="12"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
      width="12"
    >
      <path d="M5 3a2 2 0 0 0-2 2" />
      <path d="M19 3a2 2 0 0 1 2 2" />
      <path d="M5 21a2 2 0 0 1-2-2" />
      <path d="M9 3h1" />
      <path d="M9 21h2" />
      <path d="M14 3h1" />
      <path d="M3 9v1" />
      <path d="M21 9v2" />
      <path d="M3 14v1" />
      <path d="m12 12 4 10 1.7-4.3L22 16Z" />
    </svg>
  );
}
