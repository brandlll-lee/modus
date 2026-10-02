import {
  IconBook2,
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
import { m, useReducedMotion } from "motion/react";
import { memo, useState } from "react";
import type {
  ContextItem,
  MessageContextChip,
  ModelInfo,
  PromptImageAttachment,
  SkillSelection,
} from "../../../../shared/contracts";
import { CopyButton } from "../../components/ui/CopyButton";
import { ImageThumb } from "../../components/ui/ImageViewer";
import { cn } from "../../lib/cn";
import { useClipFade } from "../../lib/useClipFade";
import { Composer } from "../composer/Composer";
import { type ComposerDraft, createEmptyComposerDraft } from "../composer/composerDraft";
import { InspectGlyph, SkillTokenContent } from "../composer/composerTokens";
import type { ComposerImage } from "../composer/useComposerImages";
import { materialIconForFile } from "../files/fileIcons";
import { CheckpointRestoreButton } from "./CheckpointRestoreButton";
import { MarkdownMessage } from "./MarkdownMessage";

type MessageBlockProps = {
  sessionId?: string | undefined;
  messageRole: "assistant" | "user";
  /** Timeline id of this message — the rollback anchor for edit & resend. */
  messageId: string;
  content: string;
  streaming?: boolean;
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
  /** Required to mount the shared Composer for inline edit-resend. */
  model?: string;
  models?: ModelInfo[];
  workspaceId?: string | undefined;
  cwd?: string | undefined;
  /** Open a workspace file in the Files inspector panel. */
  onOpenFile?: ((path: string) => void) | undefined;
  /** User only: images attached to the prompt, rendered as thumbnails. */
  attachments?: PromptImageAttachment[];
  /** User only: context chips attached to the prompt, kept visible after send. */
  contextChips?: MessageContextChip[];
  /** User only: original context items for edit-and-resend. */
  contextItems?: ContextItem[];
  /** User only: selected skills attached to the prompt. */
  skills?: SkillSelection[];
  animateEntry?: boolean;
  onEntryComplete?(): void;
};

export const MessageBlock = memo(function MessageBlock({
  sessionId,
  messageRole,
  messageId,
  content,
  streaming = false,
  checkpointId,
  onRestoreCheckpoint,
  editable = false,
  onEditResend,
  model = "",
  models = [],
  workspaceId,
  cwd,
  onOpenFile,
  attachments,
  contextChips,
  contextItems,
  skills,
  animateEntry = false,
  onEntryComplete,
}: MessageBlockProps) {
  const [editing, setEditing] = useState(false);
  const reduceMotion = useReducedMotion();
  // Pause measurement while the edit composer owns the slot — remounting the
  // clip surface must re-run the observer (active flip), not reuse a stale one.
  const { boxRef, contentRef, clipped } = useClipFade(!editing);

  if (messageRole === "user") {
    const hasAttachments = Boolean(attachments?.length);
    const hasText = content.trim().length > 0;
    const hasInlineTokens = Boolean(contextChips?.length || skills?.length);
    // File/folder chips are omitted from body text (chips + context[] are authority),
    // so chip-only prompts must still render a bubble.
    if (!hasText && !hasAttachments && !hasInlineTokens) return null;

    const canEdit = Boolean(editable && onEditResend && model && models.length > 0);
    const showEditor = Boolean(editing && canEdit && onEditResend);
    const bubbleBody = (
      <>
        {hasText || hasInlineTokens ? (
          <div className="whitespace-pre-wrap wrap-break-word">
            {contextChips
              ?.filter(
                (chip): chip is MessageContextChip => chip != null && typeof chip.kind === "string",
              )
              .map((chip) => (
                <InlineContextToken
                  chip={chip}
                  key={`${chip.kind}:${chip.label}:${chip.detail ?? ""}`}
                />
              ))}
            {(skills ?? []).map((skill) => (
              <InlineSkillToken key={skill.path} name={skill.name} />
            ))}
            {hasText ? content : null}
          </div>
        ) : null}
      </>
    );

    return (
      <m.div
        className="flex w-full min-w-0 justify-end"
        initial={
          animateEntry && !reduceMotion ? { transform: "translateY(20px)", opacity: 0 } : false
        }
        animate={{ transform: "translateY(0px)", opacity: 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
        {...(animateEntry && onEntryComplete ? { onAnimationComplete: onEntryComplete } : {})}
      >
        {showEditor && onEditResend ? (
          <InlineEditComposer
            sessionId={sessionId}
            {...(attachments ? { attachments } : {})}
            content={content}
            {...(contextChips ? { contextChips } : {})}
            {...(contextItems ? { contextItems } : {})}
            cwd={cwd}
            messageId={messageId}
            model={model}
            models={models}
            checkpointId={checkpointId}
            onCancel={() => setEditing(false)}
            onEditResend={onEditResend}
            onRestoreCheckpoint={onRestoreCheckpoint}
            {...(skills ? { skills } : {})}
            workspaceId={workspaceId}
          />
        ) : (
          <div className="group/message flex min-w-0 max-w-[85%] flex-col items-end gap-3">
            <PromptAttachmentRow {...(attachments ? { attachments } : {})} />
            {hasText || hasInlineTokens ? (
              /* biome-ignore lint/a11y: The conditional control renders an editable message. */
              <div
                aria-label={canEdit ? "Edit message" : undefined}
                className={cn(
                  "block w-fit min-w-0 max-w-full rounded-2xl bg-card px-4 py-3 text-left text-md text-fg leading-relaxed transition-colors hover:bg-surface",
                  canEdit && "cursor-pointer",
                )}
                onClick={canEdit ? () => setEditing(true) : undefined}
                onKeyDown={
                  canEdit
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setEditing(true);
                        }
                      }
                    : undefined
                }
                role={canEdit ? "button" : undefined}
                tabIndex={canEdit ? 0 : undefined}
              >
                {/* 3.5 lines at leading-relaxed (1.625em × 3.5 = 5.6875em): 3
                clear lines + a half-line peek for the bottom dissolve.
                Mask MUST live on this clipped viewport — on the tall inner
                content the gradient is sized to the full text height, so
                the visible window stays opaque. */}
                <div
                  className={cn("max-h-[5.6875em] overflow-hidden", clipped && "clip-fade")}
                  ref={boxRef}
                >
                  <div className="space-y-2" ref={contentRef}>
                    {bubbleBody}
                  </div>
                </div>
              </div>
            ) : canEdit ? (
              <button
                aria-label="Edit message"
                className="rounded-md p-1 text-fg-muted opacity-0 transition-opacity hover:text-fg focus-visible:opacity-100 group-hover/message:opacity-100"
                onClick={() => setEditing(true)}
                type="button"
              >
                <IconPencil size={16} stroke={1.5} />
              </button>
            ) : null}
          </div>
        )}
      </m.div>
    );
  }

  return (
    <div className="min-w-0 max-w-full text-md leading-relaxed">
      {content ? (
        <MarkdownMessage
          content={content}
          cwd={cwd}
          onOpenFile={onOpenFile}
          streaming={streaming}
        />
      ) : null}
    </div>
  );
});

/** Seeds the shared Composer for edit-resend — no parallel editor UI. */
function InlineEditComposer({
  sessionId,
  messageId,
  content,
  attachments,
  contextChips,
  contextItems,
  skills,
  model,
  models,
  cwd,
  workspaceId,
  checkpointId,
  onCancel,
  onEditResend,
  onRestoreCheckpoint,
}: {
  sessionId?: string | undefined;
  messageId: string;
  content: string;
  attachments?: PromptImageAttachment[];
  contextChips?: MessageContextChip[];
  contextItems?: ContextItem[];
  skills?: SkillSelection[];
  model: string;
  models: ModelInfo[];
  cwd: string | undefined;
  workspaceId: string | undefined;
  checkpointId: string | undefined;
  onCancel(): void;
  onEditResend(
    messageId: string,
    message: string,
    attachments?: PromptImageAttachment[],
    contextItems?: ContextItem[],
    skills?: SkillSelection[],
  ): Promise<void>;
  onRestoreCheckpoint: ((checkpointId: string) => Promise<void> | void) | undefined;
}) {
  const [draft, setDraft] = useState<ComposerDraft>(() => ({
    ...createEmptyComposerDraft(),
    value: content,
    images: attachmentsToComposerImages(attachments),
    selectedSkills: skills ?? [],
  }));
  const [editContextItems, setEditContextItems] = useState<ContextItem[]>(
    () => contextItems ?? contextItemsFromChips(contextChips ?? [], workspaceId),
  );

  return (
    <Composer
      sessionId={sessionId}
      trailingActions={
        <>
          <CopyButton label="Copy message" text={draft.value} />
          {checkpointId && onRestoreCheckpoint ? (
            <CheckpointRestoreButton checkpointId={checkpointId} onRestore={onRestoreCheckpoint} />
          ) : null}
        </>
      }
      canSubmit={Boolean(model)}
      contextItems={editContextItems}
      cwd={cwd}
      draft={draft}
      model={model}
      models={models}
      onCancel={onCancel}
      onContextChange={setEditContextItems}
      onDraftChange={setDraft}
      onModelChange={() => undefined}
      onSubmit={(message, nextContext, _delivery, nextAttachments, nextSkills) =>
        onEditResend(messageId, message, nextAttachments, nextContext, nextSkills)
      }
      workspaceId={workspaceId}
    />
  );
}

function attachmentsToComposerImages(
  attachments: PromptImageAttachment[] | undefined,
): ComposerImage[] {
  if (!attachments?.length) {
    return [];
  }
  return attachments.map((attachment, index) => ({
    id: `edit-att-${index}-${attachment.name ?? "image"}`,
    name: attachment.name ?? `image-${index + 1}`,
    mimeType: attachment.mimeType,
    path: attachment.path,
    dataUrl: `data:${attachment.mimeType};base64,${attachment.data}`,
  }));
}

function PromptAttachmentRow({
  attachments,
  className,
}: {
  attachments?: PromptImageAttachment[];
  className?: string;
}) {
  if (!attachments?.length) {
    return null;
  }
  return (
    <div className={cn("flex max-w-full flex-wrap justify-end gap-[12px]", className)}>
      {attachments.map((attachment, index) => (
        <ImageThumb
          alt={attachment.name ?? `attachment ${index + 1}`}
          className="size-[100px] max-w-full rounded-[8px] border border-hairline bg-canvas object-cover"
          // biome-ignore lint/suspicious/noArrayIndexKey: Sent attachments retain their order for the lifetime of the message.
          key={`${attachment.name ?? "image"}:${attachment.data.length}:${index}`}
          src={`data:${attachment.mimeType};base64,${attachment.data}`}
          title={attachment.name}
        />
      ))}
    </div>
  );
}

function contextItemsFromChips(
  chips: MessageContextChip[],
  workspaceId: string | undefined,
): ContextItem[] {
  return chips.flatMap((chip): ContextItem[] => {
    if (chip == null || typeof chip.kind !== "string") {
      return [];
    }
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
    if (chip.kind === "search" && chip.label.startsWith("search:")) {
      return [{ type: "search", query: chip.label.slice("search:".length) }];
    }
    return [];
  });
}

function InlineContextToken({ chip }: { chip: MessageContextChip }) {
  const fileIcon =
    chip.kind === "file" || chip.kind === "excerpt" ? materialIconForFile(chip.label) : undefined;
  return (
    <span
      className="mr-1 inline-flex max-w-[260px] items-center gap-1 align-[-0.15em] font-medium text-link text-sm"
      style={chip.color ? { color: chip.color } : undefined}
      title={chip.detail ? `${chip.label} — ${chip.detail}` : chip.label}
    >
      {chip.kind === "design-element" ? (
        <InspectGlyph size={12} />
      ) : fileIcon ? (
        <img alt="" className="size-3 shrink-0" draggable={false} src={fileIcon} />
      ) : (
        <ContextKindIcon kind={chip.kind} />
      )}
      <span className="truncate">{chip.label}</span>
      {chip.detail ? (
        <span className="shrink-0 font-normal text-fg-muted">{chip.detail}</span>
      ) : null}
    </span>
  );
}

function InlineSkillToken({ name }: { name: string }) {
  return (
    <span className="mr-1 inline-flex font-medium text-sm" title={name}>
      <SkillTokenContent skill={{ name, path: name }} />
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
    case "design-annotation":
      return <IconPencil {...props} />;
    default:
      return <IconFile {...props} />;
  }
}
