import {
  IconArrowUp,
  IconListCheck,
  IconPlayerStopFilled,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { AnimatePresence, m } from "motion/react";
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";
import type {
  AgentMode,
  ContextItem,
  ContextUsageInfo,
  ModelInfo,
  PromptDelivery,
  PromptImageAttachment,
  SkillSelection,
} from "../../../../shared/contracts";
import { ImageThumb } from "../../components/ui/ImageViewer";
import { ShineBorder } from "../../components/ui/ShineBorder";
import { ToolbarButton } from "../../components/ui/ToolbarButton";
import { cn } from "../../lib/cn";
import { ContextUsageRing, contextUsagePercent, formatUsagePercent } from "../../lib/contextUsage";
import { ContextMentionMenu } from "./ContextMentionMenu";
import { ContextUsageIndicator } from "./ContextUsageIndicator";
import {
  type ComposerDraft,
  type ComposerDraftUpdate,
  createEmptyComposerDraft,
  messageFromParts,
  resolveDraftUpdate,
} from "./composerDraft";
import { contextItemKey } from "./composerTokens";
import { MentionEditor, type MentionEditorHandle, type MentionEditorPart } from "./MentionEditor";
import { ModelSelect } from "./ModelSelect";
import { SlashMenu } from "./SlashMenu";
import { type ComposerImageUpdate, useComposerImages } from "./useComposerImages";
import { type MentionRow, useComposerMentions } from "./useComposerMentions";
import { type SlashActionItem, type SlashItem, useComposerSlash } from "./useComposerSlash";

const COMPOSER_PLACEHOLDER = "Ask anything";

type ComposerProps = {
  sessionId?: string | undefined;
  model: string;
  models: ModelInfo[];
  contextItems: ContextItem[];
  contextUsage?: ContextUsageInfo;
  workspaceId: string | undefined;
  cwd: string | undefined;
  canSubmit: boolean;
  isRunning?: boolean;
  footer?: ReactNode;
  trailingActions?: ReactNode;
  onModelChange(model: string): void;
  onModelConfigChange?(model: string, thinkingVariant: string): Promise<void> | void;
  onContextChange(items: ContextItem[]): void;
  onSubmit(
    message: string,
    context: ContextItem[],
    delivery?: PromptDelivery,
    attachments?: PromptImageAttachment[],
    skills?: SkillSelection[],
    mode?: AgentMode,
  ): void | Promise<void>;
  onCompact?(): Promise<void>;
  onAbort?(): void;
  /**
   * When set, this instance is an inline edit-resend surface (same chrome as
   * the dock). Esc / the X control cancel; dock-only mode/model chrome is omitted.
   */
  onCancel?(): void;
  /** Controlled composer mode (build/plan); falls back to internal state. */
  mode?: AgentMode;
  onModeChange?(mode: AgentMode): void;
  /** Optional per-session draft, owned by the caller when the composer can unmount. */
  draft?: ComposerDraft;
  onDraftChange?(update: ComposerDraftUpdate): void;
};

export function Composer({
  sessionId,
  model,
  models,
  contextItems,
  contextUsage,
  workspaceId,
  cwd,
  canSubmit,
  footer,
  trailingActions,
  isRunning = false,
  onAbort,
  onModelChange,
  onModelConfigChange,
  onContextChange,
  onCompact,
  onSubmit,
  onCancel,
  mode: controlledMode,
  onModeChange,
  draft,
  onDraftChange,
}: ComposerProps) {
  const isInlineEdit = Boolean(onCancel);
  const [uncontrolledDraft, setUncontrolledDraft] =
    useState<ComposerDraft>(createEmptyComposerDraft);
  const activeDraft = draft ?? uncontrolledDraft;
  const [dragging, setDragging] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [internalMode, setInternalMode] = useState<AgentMode>("build");
  const mode = controlledMode ?? internalMode;
  const setDraft = useCallback(
    (update: ComposerDraftUpdate): void => {
      if (onDraftChange) {
        onDraftChange(update);
      } else {
        setUncontrolledDraft(update);
      }
    },
    [onDraftChange],
  );
  const setValue = useCallback(
    (update: string | ((current: string) => string)): void => {
      setDraft((current) => ({ ...current, value: resolveDraftUpdate(update, current.value) }));
    },
    [setDraft],
  );
  const setSelectedSkills = useCallback(
    (update: SkillSelection[] | ((current: SkillSelection[]) => SkillSelection[])): void => {
      setDraft((current) => ({
        ...current,
        selectedSkills: resolveDraftUpdate(update, current.selectedSkills),
      }));
    },
    [setDraft],
  );
  const setImages = useCallback(
    (update: ComposerImageUpdate): void => {
      setDraft((current) => ({ ...current, images: resolveDraftUpdate(update, current.images) }));
    },
    [setDraft],
  );
  const setMode = (next: AgentMode): void => {
    onModeChange?.(next);
    if (controlledMode === undefined) {
      setInternalMode(next);
    }
  };
  const editorRef = useRef<MentionEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addFiles, clearImages, images, removeImage, toAttachments, updateImage } =
    useComposerImages({
      images: activeDraft.images,
      onImagesChange: setImages,
    });
  const value = activeDraft.value;
  const selectedSkills = activeDraft.selectedSkills;
  const [textBeforeCaret, setTextBeforeCaret] = useState(value);
  const hasText = value.trim().length > 0;
  const hasImages = images.length > 0;
  const hasSelectedSkills = selectedSkills.length > 0;
  const hasInlineTokens = contextItems.length > 0 || hasSelectedSkills;
  const hasContent = hasText || hasImages || contextItems.length > 0 || hasSelectedSkills;
  const currentModel = models.find((item) => item.id === model);
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
  } = useComposerMentions({
    cwd,
    value: textBeforeCaret,
    workspaceId,
  });
  const usagePercent = contextUsagePercent(contextUsage);
  const usageLabel =
    usagePercent === undefined ? "" : ` (${formatUsagePercent(usagePercent)} full)`;
  const slashActions: SlashActionItem[] = onCompact
    ? [
        {
          kind: "action",
          key: "action:compact",
          name: "Compact",
          description: `Compact this chat's context${usageLabel}`,
          disabled: isRunning,
          leading: <ContextUsageRing percent={usagePercent} />,
          run: onCompact,
        },
      ]
    : [];
  const slash = useComposerSlash({ actions: slashActions, cwd, sessionId, value: textBeforeCaret });

  function send(delivery: PromptDelivery = isRunning ? "follow-up" : "normal"): void {
    if (!hasContent || !canSubmit || submitting || !currentModel?.available) {
      return;
    }
    // Providers reject empty text blocks, so image-only sends get a stub line.
    const message = hasText
      ? messageFromParts(activeDraft.parts, value.trim())
      : hasSelectedSkills
        ? "Use the selected skill(s)."
        : hasImages
          ? "See the attached image(s)."
          : "Use the selected context.";
    const attachments = toAttachments();
    const payload = {
      message,
      contextItems,
      delivery,
      attachments: attachments.length > 0 ? attachments : undefined,
      skills: selectedSkills.length > 0 ? selectedSkills : undefined,
      mode,
    } as const;

    if (isInlineEdit) {
      setSubmitError(undefined);
      setSubmitting(true);
      void Promise.resolve(
        onSubmit(
          payload.message,
          payload.contextItems,
          payload.delivery,
          payload.attachments,
          payload.skills,
          payload.mode,
        ),
      )
        .then(() => {
          // Success unmounts this surface via timeline reload — skip clear flash.
        })
        .catch((cause: unknown) => {
          setSubmitError(cause instanceof Error ? cause.message : String(cause));
          setSubmitting(false);
        });
      return;
    }

    setSubmitError(undefined);
    setSubmitting(true);
    void Promise.resolve()
      .then(() =>
        onSubmit(
          payload.message,
          payload.contextItems,
          payload.delivery,
          payload.attachments,
          payload.skills,
          payload.mode,
        ),
      )
      .then(() => {
        setValue("");
        clearImages();
        setSelectedSkills([]);
        onContextChange([]);
        editorRef.current?.clear();
      })
      .catch((cause: unknown) => {
        setSubmitError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setSubmitting(false));
  }

  function selectSlashItem(item: SlashItem): void {
    if (item.kind === "action") {
      if (item.disabled) return;
      editorRef.current?.deleteBeforeCaret((slash.query?.length ?? 0) + 1);
      setSubmitError(undefined);
      void item
        .run()
        .catch((cause: unknown) =>
          setSubmitError(cause instanceof Error ? cause.message : String(cause)),
        );
      return;
    }
    if (item.kind === "skill") {
      if (selectedSkills.some((skill) => skill.path === item.skill.path)) {
        editorRef.current?.deleteBeforeCaret((slash.query?.length ?? 0) + 1);
        return;
      }
      editorRef.current?.insertSkillToken(
        { name: item.skill.name, path: item.skill.path },
        (slash.query?.length ?? 0) + 1,
      );
      return;
    }
    // Commands seed the composer with their instruction prefix to keep typing.
    editorRef.current?.insertText(item.command.prefix, (slash.query?.length ?? 0) + 1);
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>): void {
    const files = [...event.clipboardData.items]
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length > 0) {
      event.preventDefault();
      void addFiles(files);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    setDragging(false);
    if (event.dataTransfer.files.length > 0) {
      event.preventDefault();
      void addFiles(event.dataTransfer.files);
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    if ([...event.dataTransfer.items].some((item) => item.kind === "file")) {
      event.preventDefault();
      setDragging(true);
    }
  }

  function addContextItem(item: ContextItem): void {
    const key = contextItemKey(item);
    if (!contextItems.some((existing) => contextItemKey(existing) === key)) {
      editorRef.current?.insertContextToken(item, mention ? mention.query.length + 1 : 0);
      return;
    }
    if (mention) {
      editorRef.current?.deleteBeforeCaret(mention.query.length + 1);
    }
  }

  /** Route an @-menu row: drill into a category, add an item, or expand "more". */
  function selectMentionRow(row: MentionRow): void {
    if (row.row === "nav") {
      openCategory(row.target);
    } else if (row.row === "add") {
      addContextItem(row.item);
    } else if (row.row === "more") {
      expandMore();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    // Shift+Tab rotates the composer mode (build ⇄ plan), mirroring Cursor.
    if (event.key === "Tab" && event.shiftKey && !slash.isOpen && !isOpen) {
      event.preventDefault();
      setMode(mode === "plan" ? "build" : "plan");
      return;
    }

    if (slash.isOpen && event.key === "ArrowDown") {
      event.preventDefault();
      slash.setActiveIndex((index) => (index + 1) % slash.items.length);
      return;
    }

    if (!value && event.key === "Backspace") {
      if (selectedSkills.length > 0) {
        event.preventDefault();
        setSelectedSkills((current) => current.slice(0, -1));
        return;
      }
      const lastContextItem = contextItems.at(-1);
      if (lastContextItem) {
        event.preventDefault();
        const key = contextItemKey(lastContextItem);
        onContextChange(contextItems.filter((item) => contextItemKey(item) !== key));
        return;
      }
    }

    if (slash.isOpen && event.key === "ArrowUp") {
      event.preventDefault();
      slash.setActiveIndex((index) => (index - 1 + slash.items.length) % slash.items.length);
      return;
    }

    if (slash.isOpen && event.key === "Escape") {
      event.preventDefault();
      editorRef.current?.deleteBeforeCaret((slash.query?.length ?? 0) + 1);
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

    // Backspace at a category's empty query pops back to the root @ menu.
    if (isOpen && atCategoryRoot && event.key === "Backspace") {
      event.preventDefault();
      backToRoot();
      return;
    }

    if (isOpen && event.key === "Escape") {
      event.preventDefault();
      editorRef.current?.deleteBeforeCaret(mention ? mention.query.length + 1 : 0);
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

    if (event.key === "Escape" && onCancel && !submitting) {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key === "Escape" && isRunning && onAbort) {
      event.preventDefault();
      onAbort();
      return;
    }

    if (
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "g" &&
      isRunning &&
      onAbort
    ) {
      event.preventDefault();
      onAbort();
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(event.ctrlKey && isRunning ? "steer" : undefined);
    }
  }

  function handleEditorChange(
    text: string,
    items: ContextItem[],
    skills: SkillSelection[],
    nextTextBeforeCaret: string,
    parts: MentionEditorPart[],
  ): void {
    setDraft((current) => ({ ...current, value: text, selectedSkills: skills, parts }));
    onContextChange(items);
    setTextBeforeCaret(nextTextBeforeCaret);
  }

  return (
    <div className="relative flex flex-col items-stretch gap-3">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag-drop is a pointer-only enhancement; keyboard users attach images via paste in the editor. */}
      <div
        className={cn(
          "relative border border-composer-border bg-surface shadow-composer-edge transition-[border-color] duration-150",
          "rounded-[20px]",
          Boolean(footer) && "z-10",
          // No focus glow: only text focus or drag nudges the border one notch brighter.
          !isRunning && "focus-within:border-composer-border-strong",
          dragging && "border-composer-border-strong",
          submitting && "pointer-events-none opacity-60",
        )}
        onDragLeave={() => setDragging(false)}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isRunning ? <ShineBorder /> : null}
        <div
          className="relative"
          onCompositionEnd={() => setIsComposing(false)}
          onCompositionStart={() => setIsComposing(true)}
        >
          {!hasText && !hasInlineTokens && !isComposing ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 px-4 pt-3 text-md font-light text-fg-placeholder leading-normal"
            >
              {COMPOSER_PLACEHOLDER}
            </div>
          ) : null}
          {/* One typing line + airy pad (top/bottom) — not a multi-line empty runway. */}
          <MentionEditor
            className="min-h-[68px] px-4 pt-4 pb-2 text-md font-normal text-fg leading-normal"
            contextItems={contextItems}
            onChange={handleEditorChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            parts={activeDraft.parts}
            ref={editorRef}
            skills={selectedSkills}
            value={value}
          />
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

        {images.length > 0 ? (
          <div className="flex flex-wrap gap-2 px-3 pt-1.5">
            {images.map((image) => (
              <div className="group/image relative" key={image.id}>
                <ImageThumb
                  alt={image.name}
                  className="size-14 rounded-lg border border-hairline bg-canvas object-contain"
                  onSaveEdited={(dataUrl) => updateImage(image.id, dataUrl)}
                  src={image.dataUrl}
                  title={image.name}
                />
                <button
                  aria-label={`Remove ${image.name}`}
                  className="absolute -top-1.5 -right-1.5 flex size-4.5 items-center justify-center rounded-full border border-hairline bg-elevated text-fg-faint opacity-0 transition-opacity hover:text-fg group-hover/image:opacity-100"
                  onClick={() => removeImage(image.id)}
                  type="button"
                >
                  <IconX size={11} stroke={2.2} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {/* @container: controls collapse their labels to icons as the composer
          narrows (responsive to the composer's own width, not the viewport). */}
        <div className="@container flex items-center gap-2 px-3 pt-1.5 pb-2.5">
          <ToolbarButton label="Attach files" onClick={() => fileInputRef.current?.click()}>
            <IconPlus size={17} stroke={1.8} />
          </ToolbarButton>
          <input
            accept="image/*"
            className="hidden"
            multiple
            onChange={(event) => {
              if (event.target.files?.length) {
                void addFiles(event.target.files);
              }
              event.target.value = "";
            }}
            ref={fileInputRef}
            type="file"
          />

          {!isInlineEdit && mode === "plan" ? (
            <PlanModePill onExit={() => setMode("build")} />
          ) : null}

          <div className="flex-1" />

          {!isInlineEdit ? (
            <ModelSelect
              model={model}
              models={models}
              onModelChange={onModelChange}
              {...(onModelConfigChange ? { onModelConfigChange } : {})}
            />
          ) : null}

          {submitError ? (
            <span className="min-w-0 truncate text-2xs text-danger" title={submitError}>
              {submitError}
            </span>
          ) : null}

          {!isInlineEdit ? (
            <ContextUsageIndicator
              {...(currentModel?.contextWindow
                ? { contextWindow: currentModel.contextWindow }
                : {})}
              {...(contextUsage ? { usage: contextUsage } : {})}
            />
          ) : null}

          {trailingActions}

          {onCancel ? (
            <ToolbarButton label="Cancel" onClick={onCancel} disabled={submitting}>
              <IconX size={16} stroke={1.8} />
            </ToolbarButton>
          ) : null}

          {/* Stop while running; otherwise the send button is always shown. */}
          <AnimatePresence initial={false} mode="popLayout">
            {isRunning && onAbort ? (
              <m.button
                animate={{ opacity: 1, scale: 1 }}
                aria-label="Stop"
                className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-fg text-canvas shadow-composer transition-colors hover:bg-fg-muted active:scale-[0.94]"
                exit={{ opacity: 0 }}
                initial={{ opacity: 0, scale: 0.96 }}
                key="stop"
                onClick={onAbort}
                transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
                type="button"
              >
                <IconPlayerStopFilled size={11} />
              </m.button>
            ) : (
              <m.button
                animate={{ opacity: 1 }}
                aria-label="Send"
                className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-fg text-canvas transition-colors hover:bg-fg-muted active:scale-[0.94] disabled:bg-chip-strong disabled:text-fg-faint"
                disabled={!hasContent || !canSubmit || submitting || !currentModel?.available}
                exit={{ opacity: 0 }}
                initial={{ opacity: 0 }}
                key="send"
                onClick={() => send()}
                transition={{ duration: 0.08, ease: "linear" }}
                type="button"
              >
                <IconArrowUp size={14} stroke={2.4} />
              </m.button>
            )}
          </AnimatePresence>
        </div>
      </div>
      {footer ? <div className="px-2">{footer}</div> : null}
    </div>
  );
}

function PlanModePill({ onExit }: { onExit: () => void }) {
  // Cursor-style mode pill: a compact accent token that shows Plan Mode is
  // active, with an inline dismiss. Shift+Tab also toggles it (see handleKeyDown).
  return (
    <span
      className="app-no-drag inline-flex h-[26px] shrink-0 items-center gap-1 rounded-md border border-accent/30 bg-accent/10 pr-1 pl-1.5 text-accent"
      title="Plan Mode — research read-only and draft a plan (Shift+Tab to toggle)"
    >
      <IconListCheck size={14} stroke={1.9} />
      <span className="font-medium text-[12px]">Plan</span>
      <button
        aria-label="Exit Plan Mode"
        className="flex size-4 items-center justify-center rounded-sm text-accent/70 transition-colors hover:bg-accent/15 hover:text-accent"
        onClick={onExit}
        type="button"
      >
        <IconX size={12} stroke={2} />
      </button>
    </span>
  );
}
