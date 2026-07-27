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
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";
import { formatClock } from "../../lib/formatClock";
import { useSmoothStreamingText } from "../../lib/useSmoothStreamingText";
import {
  Composer,
  COMPOSER_RADIUS_CLASS,
  COMPOSER_SHELL_CLASS,
  type ComposerDraft,
  createEmptyComposerDraft,
} from "../composer/Composer";
import type { ComposerImage } from "../composer/useComposerImages";
import { InspectGlyph, SkillTokenContent } from "../composer/composerTokens";
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
  /** Required to mount the shared Composer for inline edit-resend. */
  model?: string;
  models?: ModelInfo[];
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
  model = "",
  models = [],
  workspaceId,
  cwd,
  attachments,
  contextChips,
  contextItems,
  skills,
}: MessageBlockProps) {
  const [editing, setEditing] = useState(false);
  const displayContent = useSmoothStreamingText(content, streaming);

  if (messageRole === "user") {
    const hasAttachments = Boolean(attachments?.length);
    const hasText = content.trim().length > 0;
    if (!hasText && !hasAttachments) return null;

    const canEdit = Boolean(editable && onEditResend && model && models.length > 0);
    const showEditor = Boolean(editing && canEdit && onEditResend);
    // Sticky slot is always mounted: editing only swaps slot content. Unmounting
    // sticky and returning a normal-flow editor made the editor appear at the
    // bubble's real document position (often off-screen) while the sticky
    // viewport copy vanished.
    const bubbleBody = (
      <>
        <PromptAttachmentRow {...(attachments ? { attachments } : {})} />
        {hasText ? (
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
        ) : null}
      </>
    );

    return (
      <>
        {/* Sticky slot owns occlusion: opaque canvas plate so scroll-under
            timeline never bleeds through rounded corners. Actions stay outside
            this box (avoids a tall invisible plate). */}
        <div className={cn("peer sticky top-0 z-10 block w-full min-w-0 bg-canvas", COMPOSER_RADIUS_CLASS)}>
          {showEditor && onEditResend ? (
            <InlineEditComposer
              {...(attachments ? { attachments } : {})}
              content={content}
              {...(contextChips ? { contextChips } : {})}
              {...(contextItems ? { contextItems } : {})}
              cwd={cwd}
              messageId={messageId}
              model={model}
              models={models}
              onCancel={() => setEditing(false)}
              onEditResend={onEditResend}
              {...(skills ? { skills } : {})}
              workspaceId={workspaceId}
            />
          ) : (
            <div
              aria-label={canEdit ? "Edit message" : undefined}
              className={cn(
                "block w-full min-w-0 max-h-48 space-y-2 overflow-hidden px-4 py-3 text-left text-sm text-fg leading-relaxed transition-colors hover:border-composer-border-strong",
                COMPOSER_SHELL_CLASS,
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
              {bubbleBody}
            </div>
          )}
        </div>
        {!showEditor ? (
          <div className="!mt-1 flex h-6 max-w-full items-center gap-1 opacity-0 transition-opacity duration-150 hover:opacity-100 focus-within:opacity-100 peer-hover:opacity-100">
            <span className="text-2xs text-fg-faint tabular-nums">{formatClock(createdAt)}</span>
            {checkpointId && onRestoreCheckpoint ? (
              <CheckpointRestoreButton checkpointId={checkpointId} onRestore={onRestoreCheckpoint} />
            ) : null}
            {hasText ? <CopyButton label="Copy message" text={content} /> : null}
            {canEdit ? (
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
        ) : null}
      </>
    );
  }

  return (
    <div className="min-w-0 max-w-full text-sm leading-relaxed">
      {content ? <MarkdownMessage content={displayContent} streaming={streaming} /> : null}
    </div>
  );
});

/** Seeds the shared Composer for edit-resend — no parallel editor UI. */
function InlineEditComposer({
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
  onCancel,
  onEditResend,
}: {
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
  onCancel(): void;
  onEditResend(
    messageId: string,
    message: string,
    attachments?: PromptImageAttachment[],
    contextItems?: ContextItem[],
    skills?: SkillSelection[],
  ): Promise<void>;
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
    dataUrl: `data:${attachment.mimeType};base64,${attachment.data}`,
  }));
}

/** Shared prompt image strip — same size/fit as Composer draft thumbnails. */
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
    <div className={cn("flex flex-wrap gap-2", className)}>
      {attachments.map((attachment, index) => (
        <ImageThumb
          alt={attachment.name ?? `attachment ${index + 1}`}
          className="size-14 rounded-lg border border-hairline bg-canvas object-contain"
          key={`${attachment.name ?? "image"}:${attachment.data.length}:${attachment.data.slice(-24)}`}
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
      className="mr-1 inline-flex max-w-[220px] items-center gap-1 align-[-0.15em] font-medium text-link text-sm"
      style={chip.color ? { color: chip.color } : undefined}
      title={chip.detail ? `${chip.label} — ${chip.detail}` : chip.label}
    >
      {chip.kind === "design-element" ? (
        <InspectGlyph size={12} />
      ) : (
        <ContextKindIcon kind={chip.kind} />
      )}
      <span className="truncate">{chip.label}</span>
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
    case "design-annotation":
      return <IconPencil {...props} />;
    default:
      return <IconFile {...props} />;
  }
}
