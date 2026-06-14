import {
  IconBook2,
  IconFile,
  IconFolder,
  IconGitBranch,
  IconLayoutList,
  IconLoader2,
  IconPencil,
  IconSearch,
  IconTerminal2,
  IconWorld,
} from "@tabler/icons-react";
import { m } from "motion/react";
import { type KeyboardEvent, memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MessageContextChip, PromptImageAttachment } from "../../../../shared/contracts";
import { CopyButton } from "../../components/ui/CopyButton";
import { ImageThumb } from "../../components/ui/ImageViewer";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";
import { formatClock } from "../../lib/formatClock";
import { useSmoothStreamingText } from "../../lib/useSmoothStreamingText";
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
  /** Assistant only: present on the last message of a turn → shows one footer. */
  actions?: { content: string; createdAt?: number };
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
  ): Promise<void>;
  /** User only: images attached to the prompt, rendered as thumbnails. */
  attachments?: PromptImageAttachment[];
  /** User only: context chips attached to the prompt, kept visible after send. */
  contextChips?: MessageContextChip[];
};

export const MessageBlock = memo(function MessageBlock({
  messageRole,
  messageId,
  content,
  streaming = false,
  createdAt,
  actions,
  checkpointId,
  onRestoreCheckpoint,
  editable = false,
  onEditResend,
  attachments,
  contextChips,
}: MessageBlockProps) {
  const [editing, setEditing] = useState(false);
  // Smoothly reveal assistant text like a typewriter, decoupled from bursty
  // provider chunks. User messages are already complete, so this is a no-op.
  const displayContent = useSmoothStreamingText(content, streaming);

  if (messageRole === "user") {
    if (!content.trim()) return null;

    if (editing && onEditResend) {
      return (
        <UserMessageEditor
          {...(attachments ? { attachments } : {})}
          canRestoreFiles={Boolean(checkpointId)}
          initialText={content}
          onCancel={() => setEditing(false)}
          onSend={(text) => onEditResend(messageId, text, attachments)}
        />
      );
    }

    return (
      <div className="group flex min-w-0 max-w-full flex-col items-end gap-1">
        <div className="min-w-0 max-w-[78%] rounded-xl border border-hairline bg-surface/95 px-4 py-2.5 text-sm text-fg leading-relaxed shadow-composer">
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
          {contextChips && contextChips.length > 0 ? (
            <div className="mb-2 flex flex-wrap justify-end gap-1.5">
              {contextChips.map((chip) => (
                <ContextChip chip={chip} key={`${chip.kind}:${chip.label}:${chip.detail ?? ""}`} />
              ))}
            </div>
          ) : null}
          <div className="whitespace-pre-wrap">{content}</div>
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
    <div className="group min-w-0 max-w-full text-sm leading-relaxed">
      {content ? <MarkdownMessage content={displayContent} streaming={streaming} /> : null}
      {actions ? (
        <div className="mt-1.5 flex h-6 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <CopyButton label="Copy response" text={actions.content} />
          <span className="text-2xs text-fg-faint tabular-nums">
            {formatClock(actions.createdAt)}
          </span>
        </div>
      ) : null}
    </div>
  );
});

type UserMessageEditorProps = {
  initialText: string;
  /** Original attachments, kept read-only and resent with the edited text. */
  attachments?: PromptImageAttachment[];
  /** A pre-run snapshot exists, so sending also restores workspace files. */
  canRestoreFiles: boolean;
  onCancel(): void;
  onSend(text: string): Promise<void>;
};

/**
 * In-place editor for a previously sent user message (Cursor-style edit &
 * resend). Replaces the bubble with a full-width composer-like field; Send
 * rolls the session back to this point and re-prompts with the edited text,
 * Cancel (or Esc) returns to the read-only bubble. While the rollback is in
 * flight the editor locks and shows a spinner; failures surface inline and
 * keep the draft so the action can be retried.
 */
function UserMessageEditor({
  initialText,
  attachments,
  canRestoreFiles,
  onCancel,
  onSend,
}: UserMessageEditorProps) {
  const [draft, setDraft] = useState(initialText);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const canSend = draft.trim().length > 0 && !sending;

  async function send(): Promise<void> {
    if (!canSend) {
      return;
    }
    setSending(true);
    setError(undefined);
    try {
      // On success this block unmounts (the timeline reloads truncated
      // events), so the spinner holds until the rolled-back view replaces it.
      await onSend(draft.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
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
      <textarea
        aria-label="Edit message"
        className="scroll-thin block max-h-[300px] w-full resize-none overflow-y-auto bg-transparent text-sm text-fg leading-relaxed outline-none disabled:opacity-60"
        disabled={sending}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        ref={textareaRef}
        rows={1}
        value={draft}
      />
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
          {sending ? <IconLoader2 className="animate-spin" size={12} stroke={2.2} /> : null}
          Send
        </button>
      </div>
    </m.div>
  );
}

/**
 * Read-only chip echoing one context item attached to a sent user message
 * (Cursor parity — the chips stay in the bubble after sending). Design-element
 * chips get the brand-token inspect glyph + brand text to match their composer
 * token; every other kind uses a muted icon + label. All colors are Modus theme
 * tokens, so the row reads correctly in light and dark mode.
 */
function ContextChip({ chip }: { chip: MessageContextChip }) {
  const isDesign = chip.kind === "design-element";
  return (
    <span
      className={cn(
        "flex max-w-full items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-2xs",
        isDesign
          ? "border-focus-ring/30 bg-focus-ring-soft/10 text-focus-ring"
          : "border-hairline bg-chip text-fg-muted",
      )}
      title={chip.detail ? `${chip.label} — ${chip.detail}` : chip.label}
    >
      {isDesign ? <InspectGlyph /> : <ContextKindIcon kind={chip.kind} />}
      <span className="truncate font-medium">{chip.label}</span>
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
