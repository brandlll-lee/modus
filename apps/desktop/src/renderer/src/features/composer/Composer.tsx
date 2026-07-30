import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import { Slider } from "@base-ui/react/slider";
import {
  IconAdjustmentsHorizontal,
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconListCheck,
  IconPlayerStopFilled,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { AnimatePresence, m } from "motion/react";
import {
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
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
  ThinkingOption,
} from "../../../../shared/contracts";
import { ImageThumb } from "../../components/ui/ImageViewer";
import { ShineBorder } from "../../components/ui/ShineBorder";
import { cn } from "../../lib/cn";
import {
  ContextUsageRing,
  contextUsagePercent,
  formatUsagePercent,
} from "../../lib/contextUsage";
import {
  modelThinkingOptions,
  selectedThinkingLabel,
  selectedThinkingOption,
} from "../../lib/modelThinking";
import { ProviderLogo } from "../settings/ProviderLogo";
import { ContextMentionMenu } from "./ContextMentionMenu";
import { contextItemKey } from "./composerTokens";
import { MentionEditor, type MentionEditorHandle, type MentionEditorPart } from "./MentionEditor";
import { SlashMenu } from "./SlashMenu";
import {
  type ComposerImage,
  type ComposerImageUpdate,
  useComposerImages,
} from "./useComposerImages";
import { type MentionRow, useComposerMentions } from "./useComposerMentions";
import { type SlashItem, useComposerSlash } from "./useComposerSlash";

const COMPOSER_PLACEHOLDER = "What will you build with Modus?";

/** Shared with read-only user bubbles — single radius/chrome truth for the prompt shell. */
export const COMPOSER_RADIUS_CLASS = "rounded-[12px]";
export const COMPOSER_SHELL_CLASS = cn(
  "border border-composer-border bg-surface shadow-composer-edge",
  COMPOSER_RADIUS_CLASS,
);

type ComposerProps = {
  model: string;
  models: ModelInfo[];
  contextItems: ContextItem[];
  contextUsage?: ContextUsageInfo;
  workspaceId: string | undefined;
  cwd: string | undefined;
  canSubmit: boolean;
  isRunning?: boolean;
  footer?: ReactNode;
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

export type ComposerDraft = {
  value: string;
  images: ComposerImage[];
  selectedSkills: SkillSelection[];
  parts?: MentionEditorPart[] | undefined;
};

export type ComposerDraftUpdate = ComposerDraft | ((current: ComposerDraft) => ComposerDraft);

export function createEmptyComposerDraft(): ComposerDraft {
  return { value: "", images: [], selectedSkills: [] };
}

function inlinePartLabel(part: MentionEditorPart): string | undefined {
  if (part.type === "context") {
    // Design marks keep a short in-flow label. Every other context kind is shown
    // via chips; the model payload travels on `context[]` IPC — omit from body.
    // Returning undefined used to become the literal "[context]" placeholder.
    if (part.item.type === "design-element") {
      return (
        part.item.element.componentName || part.item.element.tagName || part.item.element.label
      );
    }
    if (part.item.type === "design-annotation") {
      return part.item.annotation.label;
    }
    return "";
  }
  if (part.type === "skill") {
    return `skill:${part.skill.name}`;
  }
  return undefined;
}

export function messageFromParts(parts: MentionEditorPart[] | undefined, fallback: string): string {
  if (!parts || parts.length === 0) {
    return fallback;
  }
  return parts
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }
      const label = inlinePartLabel(part);
      if (label === "") {
        return "";
      }
      return `[${label ?? "context"}]`;
    })
    .join("")
    .replace(/\u00a0/g, " ")
    .trim();
}

function resolveUpdate<T>(update: T | ((current: T) => T), current: T): T {
  return typeof update === "function" ? (update as (value: T) => T)(current) : update;
}

export function Composer({
  model,
  models,
  contextItems,
  contextUsage,
  workspaceId,
  cwd,
  canSubmit,
  footer,
  isRunning = false,
  onAbort,
  onModelChange,
  onModelConfigChange,
  onContextChange,
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
      setDraft((current) => ({ ...current, value: resolveUpdate(update, current.value) }));
    },
    [setDraft],
  );
  const setSelectedSkills = useCallback(
    (update: SkillSelection[] | ((current: SkillSelection[]) => SkillSelection[])): void => {
      setDraft((current) => ({
        ...current,
        selectedSkills: resolveUpdate(update, current.selectedSkills),
      }));
    },
    [setDraft],
  );
  const setImages = useCallback(
    (update: ComposerImageUpdate): void => {
      setDraft((current) => ({ ...current, images: resolveUpdate(update, current.images) }));
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
  const currentModel = models.find((item) => item.id === model) ?? models[0];
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
  const slash = useComposerSlash({ cwd, value: textBeforeCaret });

  function send(delivery: PromptDelivery = isRunning ? "follow-up" : "normal"): void {
    if (!hasContent || !canSubmit || submitting || models.length === 0 || !model) {
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

    onSubmit(
      payload.message,
      payload.contextItems,
      payload.delivery,
      payload.attachments,
      payload.skills,
      payload.mode,
    );
    setValue("");
    clearImages();
    setSelectedSkills([]);
    onContextChange([]);
    editorRef.current?.clear();
  }

  function selectSlashItem(item: SlashItem): void {
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
    <div className={cn("relative flex flex-col items-stretch", footer ? "pb-12" : undefined)}>
      {footer ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 top-12 bottom-0 z-0 bg-composer-tray shadow-composer",
            COMPOSER_RADIUS_CLASS,
          )}
        />
      ) : null}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag-drop is a pointer-only enhancement; keyboard users attach images via paste in the editor. */}
      <div
        className={cn(
          "relative border border-composer-border bg-surface shadow-composer-edge transition-[border-color] duration-150",
          COMPOSER_RADIUS_CLASS,
          footer && "z-10",
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
            className="min-h-[calc(1lh+1.25rem)] px-4 pt-3 pb-2 text-md font-normal text-fg leading-normal"
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
          <button
            aria-label="Attach files"
            className="app-no-drag flex size-[26px] shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-hover hover:text-fg-muted"
            onClick={() => fileInputRef.current?.click()}
            title="Attach files"
            type="button"
          >
            <IconPlus size={17} stroke={1.8} />
          </button>
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

          {!isInlineEdit ? (
            <>
              {mode === "plan" ? <PlanModePill onExit={() => setMode("build")} /> : null}
              <ModelSelect
                model={model}
                models={models}
                onModelChange={onModelChange}
                {...(onModelConfigChange ? { onModelConfigChange } : {})}
              />
            </>
          ) : null}

          <div className="flex-1" />

          {isInlineEdit && submitError ? (
            <span className="min-w-0 truncate text-2xs text-danger" title={submitError}>
              {submitError}
            </span>
          ) : null}

          {!isInlineEdit ? (
            <ContextUsageIndicator
              {...(currentModel?.contextWindow ? { contextWindow: currentModel.contextWindow } : {})}
              {...(contextUsage ? { usage: contextUsage } : {})}
            />
          ) : null}

          {onCancel ? (
            <button
              aria-label="Cancel"
              className="flex size-[26px] shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-hover hover:text-fg-muted"
              disabled={submitting}
              onClick={onCancel}
              type="button"
            >
              <IconX size={16} stroke={1.8} />
            </button>
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
                disabled={!hasContent || !canSubmit || submitting || models.length === 0 || !model}
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
      {footer ? <div className="absolute inset-x-0 bottom-2 z-20 px-5">{footer}</div> : null}
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

function ModelSelect({
  model,
  models,
  onModelChange,
  onModelConfigChange,
}: {
  model: string;
  models: ModelInfo[];
  onModelChange(model: string): void;
  onModelConfigChange?(model: string, thinkingVariant: string): Promise<void> | void;
}) {
  const current = models.find((item) => item.id === model) ?? models[0];
  const thinkingOptions = current ? modelThinkingOptions(current) : [];
  const thinkingSelection = current ? selectedThinkingOption(current) : undefined;
  const effortAvailable = Boolean(
    current?.supportsThinking && (current.thinkingBudget || thinkingOptions.length > 0),
  );
  const discreteEffortOptions = current?.thinkingBudget ? [] : thinkingOptions;
  const effortLabel = effortAvailable && current ? selectedThinkingLabel(current) : "Not supported";
  const sliderLabel = current?.thinkingBudget ? "Custom budget" : effortLabel;
  const [budgetDraft, setBudgetDraft] = useState("");
  useEffect(() => {
    if (!current?.id) {
      setBudgetDraft("");
      return;
    }
    setBudgetDraft(
      current.thinkingLevel !== "off" && current.thinkingVariant
        ? current.thinkingVariant
        : current.thinkingBudget?.min !== undefined
          ? String(current.thinkingBudget.min)
          : "",
    );
  }, [current?.id, current?.thinkingBudget?.min, current?.thinkingLevel, current?.thinkingVariant]);

  function applyBudget(): void {
    const tokens = Number(budgetDraft);
    const budget = current?.thinkingBudget;
    if (
      !budget ||
      !Number.isSafeInteger(tokens) ||
      tokens < 0 ||
      (budget.min !== undefined && tokens < budget.min) ||
      (budget.max !== undefined && tokens > budget.max)
    ) {
      return;
    }
    void onModelConfigChange?.(current.id, String(tokens));
  }
  const providerGroups = Array.from(
    models
      .reduce((groups, item) => {
        const key = item.provider;
        const group = groups.get(key);
        if (group) {
          group.models.push(item);
        } else {
          groups.set(key, {
            provider: item.provider,
            name: item.providerName ?? item.provider,
            models: [item],
          });
        }
        return groups;
      }, new Map<string, { provider: string; name: string; models: ModelInfo[] }>())
      .values(),
  );
  const tag = current?.name ?? "No model configured";

  return current ? (
    <Menu.Root>
      <Menu.Trigger className="app-no-drag flex h-[26px] min-w-0 items-center gap-1.5 rounded-md px-2 text-sm font-normal outline-none transition-colors hover:bg-hover data-popup-open:bg-hover">
        <ProviderLogo
          framed={false}
          name={current.providerName ?? current.provider}
          provider={current.provider}
          size="sm"
        />
        <span className="min-w-0 truncate text-fg">{tag}</span>
        <span className="hidden shrink-0 whitespace-nowrap text-fg-faint @md:inline">
          {selectedThinkingLabel(current)}
        </span>
        <IconChevronDown className="shrink-0 text-fg-faint" size={12} stroke={2} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="start" side="bottom" sideOffset={4}>
          <Menu.Popup className="origin-(--transform-origin) w-[280px] max-w-[calc(100vw-24px)] popup-chrome p-1">
            <Menu.SubmenuRoot>
              <Menu.SubmenuTrigger className="flex h-8 cursor-default items-center justify-between gap-3 rounded-md px-2.5 text-sm outline-none select-none data-highlighted:bg-hover data-popup-open:bg-hover">
                <span className="text-fg-subtle">Model</span>
                <span className="flex min-w-0 items-center gap-1 text-fg-faint text-xs">
                  <span className="max-w-[150px] truncate">{tag}</span>
                  <IconChevronRight size={13} stroke={1.8} />
                </span>
              </Menu.SubmenuTrigger>
              <Menu.Portal>
                <Menu.Positioner align="start" side="right" sideOffset={5}>
                  <Menu.Popup
                    className="scroll-thin origin-(--transform-origin) w-[280px] max-w-[calc(100vw-24px)] overflow-y-auto popup-chrome p-1"
                    style={{ maxHeight: "min(320px, var(--available-height))" }}
                  >
                    <div className="px-2.5 pt-1.5 pb-1 text-fg-faint text-xs">Model</div>
                    {providerGroups.map((group) => (
                      <div key={group.provider}>
                        <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-fg-faint text-2xs uppercase">
                          <ProviderLogo
                            framed={false}
                            name={group.name}
                            provider={group.provider}
                            size="sm"
                          />
                          <span className="truncate">{group.name}</span>
                        </div>
                        {group.models.map((item) => (
                          <Menu.Item
                            className="flex h-8 cursor-default items-center justify-between gap-3 rounded-md px-2.5 text-fg-subtle text-sm outline-none select-none data-highlighted:bg-hover"
                            key={item.id}
                            onClick={() => onModelChange(item.id)}
                          >
                            <span className="min-w-0 truncate">{item.name}</span>
                            <span className="flex shrink-0 items-center gap-2">
                              {!item.available ? (
                                <span className="rounded bg-chip px-1 text-2xs text-fg-faint">
                                  off
                                </span>
                              ) : null}
                              {item.id === current.id ? (
                                <IconCheck className="text-fg-muted" size={15} stroke={1.8} />
                              ) : null}
                            </span>
                          </Menu.Item>
                        ))}
                      </div>
                    ))}
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.SubmenuRoot>

            <Menu.SubmenuRoot>
              <Menu.SubmenuTrigger
                className="flex h-8 cursor-default items-center justify-between gap-3 rounded-md px-2.5 text-sm outline-none select-none data-disabled:opacity-45 data-highlighted:bg-hover data-popup-open:bg-hover"
                disabled={!effortAvailable || !onModelConfigChange}
              >
                <span className="text-fg-subtle">Effort</span>
                <span className="flex min-w-0 items-center gap-1 text-fg-faint text-xs">
                  <span className="max-w-[150px] truncate">{effortLabel}</span>
                  <IconChevronRight size={13} stroke={1.8} />
                </span>
              </Menu.SubmenuTrigger>
              <Menu.Portal>
                <Menu.Positioner align="start" side="right" sideOffset={5}>
                  <Menu.Popup className="origin-(--transform-origin) w-[220px] max-w-[calc(100vw-24px)] popup-chrome p-1">
                    <div className="px-2.5 pt-1.5 pb-1 text-fg-faint text-xs">Effort</div>
                    {current.thinkingBudget ? (
                      <>
                        <Menu.Item
                          className="flex h-8 cursor-default items-center justify-between gap-3 rounded-md px-2.5 text-fg-subtle text-sm outline-none select-none data-highlighted:bg-hover"
                          onClick={() => void onModelConfigChange?.(current.id, "off")}
                        >
                          <span>Off</span>
                          {current.thinkingLevel === "off" ? (
                            <IconCheck className="text-fg-muted" size={15} stroke={1.8} />
                          ) : null}
                        </Menu.Item>
                        <div className="grid grid-cols-[minmax(0,1fr)_28px] gap-1 px-1.5 py-1">
                          <input
                            aria-label="Thinking token budget"
                            className="h-8 min-w-0 rounded-md border border-hairline bg-canvas px-2.5 text-fg-subtle text-sm outline-none focus:border-fg-faint"
                            max={current.thinkingBudget.max}
                            min={current.thinkingBudget.min ?? 0}
                            onChange={(event) => setBudgetDraft(event.target.value)}
                            onKeyDown={(event) => {
                              event.stopPropagation();
                              if (event.key === "Enter") applyBudget();
                            }}
                            placeholder="Tokens"
                            type="number"
                            value={budgetDraft}
                          />
                          <button
                            aria-label="Apply thinking token budget"
                            className="flex size-7 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg"
                            onClick={applyBudget}
                            type="button"
                          >
                            <IconCheck size={14} stroke={1.8} />
                          </button>
                        </div>
                      </>
                    ) : (
                      thinkingOptions.map((option) => (
                        <Menu.Item
                          className="flex h-8 cursor-default items-center justify-between gap-3 rounded-md px-2.5 text-fg-subtle text-sm outline-none select-none data-highlighted:bg-hover"
                          key={option.value}
                          onClick={() => void onModelConfigChange?.(current.id, option.value)}
                        >
                          <span>{option.label}</span>
                          {thinkingSelection?.value === option.value ? (
                            <IconCheck className="text-fg-muted" size={15} stroke={1.8} />
                          ) : null}
                        </Menu.Item>
                      ))
                    )}
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.SubmenuRoot>

            <div className="my-1 h-px bg-hairline" />
            <EffortEnergySlider
              disabled={!onModelConfigChange || discreteEffortOptions.length < 2}
              label={sliderLabel}
              options={discreteEffortOptions}
              selectedValue={thinkingSelection?.value}
              syncKey={`${current.id}:${thinkingSelection?.value ?? ""}`}
              onCommit={(value) => void onModelConfigChange?.(current.id, value)}
            />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  ) : (
    <button
      className="app-no-drag flex h-[26px] items-center gap-1 rounded-md px-2 text-sm font-normal text-fg-faint transition-colors hover:bg-hover hover:text-fg-subtle"
      type="button"
    >
      No model configured
    </button>
  );
}

function EffortEnergySlider({
  disabled,
  label,
  options,
  selectedValue,
  syncKey,
  onCommit,
}: {
  disabled: boolean;
  label: string;
  options: ThinkingOption[];
  selectedValue: string | undefined;
  syncKey: string;
  onCommit(value: string): void;
}) {
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === selectedValue),
  );
  const [preview, setPreview] = useState({ index: selectedIndex, syncKey });
  const max = Math.max(1, options.length - 1);
  const index = Math.min(preview.syncKey === syncKey ? preview.index : selectedIndex, max);
  const energy = options.length > 1 ? index / (options.length - 1) : 0;
  const previewOption = options[index];

  return (
    <div
      className="effort-energy flex h-10 items-center gap-3 rounded-md px-2.5"
      data-maximum={!disabled && options.length > 1 && index === options.length - 1}
      style={
        {
          "--effort-opacity": 0.7 + energy * 0.3,
        } as CSSProperties
      }
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
        <IconAdjustmentsHorizontal className="shrink-0 text-fg-faint" size={15} stroke={1.7} />
        <span className="min-w-0 truncate text-fg-subtle">
          Effort <span className="text-fg-faint">({previewOption?.label ?? label})</span>
        </span>
      </div>
      <Slider.Root
        aria-label="Effort"
        className="relative w-[102px] shrink-0"
        disabled={disabled}
        max={max}
        min={0}
        step={1}
        thumbAlignment="edge"
        value={index}
        onValueChange={(nextIndex) => setPreview({ index: nextIndex, syncKey })}
        onValueCommitted={(nextIndex) => {
          const option = options[nextIndex];
          if (option && option.value !== selectedValue) onCommit(option.value);
        }}
      >
        <Slider.Control className="effort-energy-control relative flex h-[18px] touch-none items-center select-none data-disabled:opacity-35">
          <Slider.Track className="effort-energy-track relative h-[18px] w-full overflow-hidden rounded-full">
            <Slider.Indicator className="effort-energy-fill absolute inset-y-0 rounded-full" />
            {options.map((option, optionIndex) => (
              <span
                aria-hidden="true"
                className="effort-energy-stop absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
                data-unfilled={optionIndex > index}
                key={option.value}
                style={{
                  left: `calc(${(optionIndex / max) * 100}% + ${8 - (optionIndex / max) * 16}px)`,
                }}
              />
            ))}
          </Slider.Track>
          <Slider.Thumb
            className="effort-energy-thumb size-4 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-focus-ring-soft"
            getAriaLabel={() => "Effort"}
            getAriaValueText={(_, value) => options[value]?.label ?? label}
          />
        </Slider.Control>
      </Slider.Root>
    </div>
  );
}

function ContextUsageIndicator({
  contextWindow,
  usage,
}: {
  contextWindow?: number;
  usage?: ContextUsageInfo;
}) {
  const percent = contextUsagePercent(usage);
  const label = percent === undefined ? "not available yet" : `${Math.round(percent)}%`;

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`Context usage ${label}`}
        className="app-no-drag flex h-[26px] w-[26px] items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg data-popup-open:bg-hover data-popup-open:text-fg"
      >
        <ContextUsageRing percent={percent} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" side="top" sideOffset={8}>
          <Popover.Popup className="origin-(--transform-origin) popup-chrome p-2 transition-[transform,opacity] duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0">
            <ContextUsageTooltip
              {...(contextWindow ? { contextWindow } : {})}
              {...(usage ? { usage } : {})}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ContextUsageTooltip({
  contextWindow,
  usage,
}: {
  contextWindow?: number;
  usage?: ContextUsageInfo;
}) {
  const total = contextUsagePercent(usage);
  const usageWindow = usage?.contextWindow ?? contextWindow;
  const tokenLine =
    usage?.tokens !== null && usage?.tokens !== undefined && usageWindow
      ? `${usage.tokens.toLocaleString()} / ${usageWindow.toLocaleString()} tokens`
      : undefined;

  if (total === undefined && !tokenLine) {
    return (
      <div className="w-[260px] px-1 py-1.5 text-sm text-fg">
        <div className="mb-1 font-medium text-fg-muted">Context usage</div>
        <div className="text-fg-faint text-xs">No context usage yet.</div>
        {usageWindow ? (
          <div className="mt-2 text-2xs text-fg-faint">
            Context window {usageWindow.toLocaleString()} tokens
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="w-[320px] px-1 py-1.5 text-sm text-fg">
      <div className="mb-2 font-medium text-fg-muted">Context usage</div>
      <ContextUsageRow label="Total" strong value={formatUsagePercent(total)} />
      {tokenLine ? <div className="mt-2 text-xs text-fg-faint">{tokenLine}</div> : null}
    </div>
  );
}

function ContextUsageRow({
  label,
  strong = false,
  value,
}: {
  label: string;
  strong?: boolean;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-1">
      <span className={strong ? "font-semibold text-fg" : "text-fg-muted"}>{label}</span>
      <span className={strong ? "font-semibold text-fg" : "text-fg"}>{value}</span>
    </div>
  );
}
