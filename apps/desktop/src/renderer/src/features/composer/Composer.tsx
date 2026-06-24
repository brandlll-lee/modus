import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import {
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCube,
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
  useCallback,
  useLayoutEffect,
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
import { BorderBeam } from "../../components/ui/BorderBeam";
import { ImageThumb } from "../../components/ui/ImageViewer";
import { TypingAnimation } from "../../components/ui/TypingAnimation";
import { cn } from "../../lib/cn";
import {
  modelThinkingOptions,
  selectedThinkingLabel,
  selectedThinkingOption,
} from "../../lib/modelThinking";
import { RunningProcessBar } from "../process/RunningProcessBar";
import { ProviderLogo } from "../settings/ProviderLogo";
import { ApprovalModeSelect } from "./ApprovalModeSelect";
import { ContextMentionMenu } from "./ContextMentionMenu";
import { ContextToken } from "./ContextToken";
import { DesignElementToken } from "./DesignElementToken";
import { SlashMenu } from "./SlashMenu";
import {
  type ComposerImage,
  type ComposerImageUpdate,
  useComposerImages,
} from "./useComposerImages";
import { type MentionRow, useComposerMentions } from "./useComposerMentions";
import { type SlashItem, useComposerSlash } from "./useComposerSlash";

const HERO_PLACEHOLDER_WORDS = [
  "Plan, build, / for skills, @ for context",
  "Refactor safely, / for skills, @ for context",
  "Debug with context, / for skills, @ for context",
];

const SESSION_PLACEHOLDER_WORDS = [
  "Reply to the agent…  / for skills, @ for context",
  "Ask a follow-up…  / for skills, @ for context",
];

type ComposerProps = {
  model: string;
  models: ModelInfo[];
  contextItems: ContextItem[];
  contextUsage?: ContextUsageInfo;
  workspaceId: string | undefined;
  cwd: string | undefined;
  canSubmit: boolean;
  hasSession: boolean;
  isRunning?: boolean;
  /** Agent session that owns this composer; scopes the running-process bar. */
  sessionId?: string;
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
  ): void;
  onAbort?(): void;
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
};

export type ComposerDraftUpdate = ComposerDraft | ((current: ComposerDraft) => ComposerDraft);

export function createEmptyComposerDraft(): ComposerDraft {
  return { value: "", images: [], selectedSkills: [] };
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
  hasSession,
  isRunning = false,
  sessionId,
  onAbort,
  onModelChange,
  onModelConfigChange,
  onContextChange,
  onSubmit,
  mode: controlledMode,
  onModeChange,
  draft,
  onDraftChange,
}: ComposerProps) {
  const [uncontrolledDraft, setUncontrolledDraft] =
    useState<ComposerDraft>(createEmptyComposerDraft);
  const activeDraft = draft ?? uncontrolledDraft;
  const [dragging, setDragging] = useState(false);
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addFiles, clearImages, images, removeImage, toAttachments } = useComposerImages({
    images: activeDraft.images,
    onImagesChange: setImages,
  });
  const value = activeDraft.value;
  const selectedSkills = activeDraft.selectedSkills;
  const hasText = value.trim().length > 0;
  const hasImages = images.length > 0;
  const hasSelectedSkills = selectedSkills.length > 0;
  const inlineContextItems = contextItems.filter((item) => item.type !== "design-element");
  const hasInlineTokens = inlineContextItems.length > 0 || hasSelectedSkills;
  const hasContent = hasText || hasImages || hasSelectedSkills;
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
    value,
    workspaceId,
  });
  const slash = useComposerSlash({ cwd, value });

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  });

  function send(delivery: PromptDelivery = isRunning ? "follow-up" : "normal"): void {
    if (!hasContent || !canSubmit || models.length === 0 || !model) {
      return;
    }
    // Providers reject empty text blocks, so image-only sends get a stub line.
    const message = hasText
      ? value.trim()
      : hasSelectedSkills
        ? "Use the selected skill(s)."
        : "See the attached image(s).";
    const attachments = toAttachments();
    onSubmit(
      message,
      contextItems,
      delivery,
      attachments.length > 0 ? attachments : undefined,
      selectedSkills.length > 0 ? selectedSkills : undefined,
      mode,
    );
    setValue("");
    clearImages();
    setSelectedSkills([]);
    onContextChange([]);
  }

  function selectSlashItem(item: SlashItem): void {
    if (item.kind === "skill") {
      setSelectedSkills((current) =>
        current.some((skill) => skill.path === item.skill.path)
          ? current
          : [...current, { name: item.skill.name, path: item.skill.path }],
      );
      setValue("");
      return;
    }
    // Commands seed the composer with their instruction prefix to keep typing.
    setValue(item.command.prefix);
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
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
      onContextChange([...contextItems, item]);
    }
    if (mention) {
      setValue(
        `${value.slice(0, mention.start)}${value.slice(mention.start).replace(/@[^\s]*$/, "")}`,
      );
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

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
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
      const lastContextItem = inlineContextItems.at(-1);
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
      setValue("");
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
      setValue((current) => (mention ? current.slice(0, mention.start) : current));
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

  return (
    <div className="flex flex-col items-stretch">
      <RunningProcessBar sessionId={sessionId} workspaceId={workspaceId} />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag-drop is a pointer-only enhancement; keyboard users attach images via paste in the textarea. */}
      <div
        className={cn(
          "relative rounded-[14px] border border-composer-border bg-surface shadow-composer-edge transition-[border-color] duration-150",
          // No focus glow: hover/focus only nudge the border one notch brighter
          // (subtle, theme-aware). While running, the Border Beam carries motion.
          !isRunning &&
            "hover:border-composer-border-strong focus-within:border-composer-border-strong",
          dragging && "border-composer-border-strong",
        )}
        onDragLeave={() => setDragging(false)}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isRunning ? <BorderBeam /> : null}
        <div className="relative">
          {!hasText && !hasInlineTokens ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 px-4 pt-4 text-md font-normal text-fg-subtle"
            >
              {hasSession ? (
                SESSION_PLACEHOLDER_WORDS[0]
              ) : (
                <TypingAnimation
                  blinkCursor
                  cursorStyle="line"
                  deleteSpeed={28}
                  loop
                  pauseDelay={2200}
                  showCursor
                  startOnView={false}
                  typeSpeed={42}
                  words={HERO_PLACEHOLDER_WORDS}
                />
              )}
            </div>
          ) : null}
          <div
            className={cn(
              hasInlineTokens
                ? "flex min-h-[68px] flex-wrap items-start gap-x-1 gap-y-1 px-4 pt-4"
                : "",
            )}
          >
            {inlineContextItems.map((item) => (
              <ContextToken
                item={item}
                key={contextItemKey(item)}
                onRemove={() =>
                  onContextChange(
                    contextItems.filter((other) => contextItemKey(other) !== contextItemKey(item)),
                  )
                }
              />
            ))}
            {hasSelectedSkills
              ? selectedSkills.map((skill) => (
                  <span
                    className="inline-flex h-6 items-center gap-1.5 text-focus-ring text-sm font-medium"
                    key={skill.path}
                  >
                    <IconCube size={15} stroke={1.8} />
                    <span>{skill.name}</span>
                  </span>
                ))
              : null}
            <textarea
              className={cn(
                "scroll-thin block max-h-[260px] resize-none overflow-y-auto bg-transparent text-md font-normal text-fg leading-[1.5] outline-none",
                hasInlineTokens
                  ? "min-h-[28px] min-w-[180px] flex-1 pt-px"
                  : "min-h-[68px] w-full px-4 pt-4",
              )}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              ref={textareaRef}
              value={value}
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

        {images.length > 0 ? (
          <div className="flex flex-wrap gap-2 px-3 pt-1.5">
            {images.map((image) => (
              <div className="group/image relative" key={image.id}>
                <ImageThumb
                  alt={image.name}
                  className="size-14 rounded-lg border border-hairline object-cover"
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

        {contextItems.some((item) => item.type === "design-element") ? (
          <div className="flex flex-wrap gap-2 px-3 pt-1.5">
            {contextItems
              .filter((item) => item.type === "design-element")
              .map((item) => (
                <DesignElementToken
                  element={item.element}
                  key={contextItemKey(item)}
                  onRemove={() =>
                    onContextChange(
                      contextItems.filter(
                        (other) => contextItemKey(other) !== contextItemKey(item),
                      ),
                    )
                  }
                />
              ))}
          </div>
        ) : null}

        {/* @container: controls collapse their labels to icons as the composer
          narrows (responsive to the composer's own width, not the viewport). */}
        {/* @container: controls collapse their labels to icons as the composer
          narrows (responsive to the composer's own width, not the viewport). */}
        <div className="@container flex items-center gap-2 px-3 pt-1 pb-2.5">
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

          {mode === "plan" ? <PlanModePill onExit={() => setMode("build")} /> : null}

          <ModelSelect
            model={model}
            models={models}
            onModelChange={onModelChange}
            {...(onModelConfigChange ? { onModelConfigChange } : {})}
          />

          <div className="flex-1" />

          {/* Stop while running; otherwise the send button is always shown (active in
            brand purple, muted/disabled when there's nothing to send). */}
          <AnimatePresence initial={false} mode="popLayout">
            {isRunning && onAbort ? (
              <m.button
                animate={{ opacity: 1, scale: 1 }}
                aria-label="Stop"
                className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-focus-ring text-white shadow-composer transition-colors hover:bg-focus-ring-soft active:scale-[0.94]"
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
                className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-focus-ring text-white transition-colors hover:bg-focus-ring-soft active:scale-[0.94] disabled:bg-chip-strong disabled:text-fg-faint"
                disabled={!hasContent || !canSubmit || models.length === 0 || !model}
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

      {/* Outside the box, Cursor-style: permission at bottom-left, context usage
        at bottom-right — quiet metadata that doesn't crowd the input itself. */}
      <div className="mt-1.5 flex items-center justify-between px-1.5">
        <ApprovalModeSelect />
        <ContextUsageIndicator
          {...(currentModel?.contextWindow ? { contextWindow: currentModel.contextWindow } : {})}
          {...(contextUsage ? { usage: contextUsage } : {})}
        />
      </div>
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
        <span className="min-w-0 truncate text-fg-subtle">{tag}</span>
        <span className="hidden shrink-0 whitespace-nowrap text-fg-faint @md:inline">
          {selectedThinkingLabel(current)}
        </span>
        <IconChevronDown className="shrink-0 text-fg-faint" size={12} stroke={2} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="start" side="bottom" sideOffset={4}>
          <Menu.Popup className="origin-(--transform-origin) w-[260px] max-w-[calc(100vw-24px)] rounded-lg border border-hairline bg-elevated p-1 shadow-popup">
            <div className="px-2.5 pt-1.5 pb-1 text-fg-faint text-xs">Reasoning</div>
            {thinkingOptions.map((option) => (
              <Menu.Item
                className="flex h-8 cursor-default items-center justify-between gap-3 rounded-md px-2.5 text-fg-subtle text-sm outline-none select-none data-highlighted:bg-hover"
                disabled={!onModelConfigChange}
                key={option.value}
                onClick={() => void onModelConfigChange?.(current.id, option.value)}
              >
                <span>{option.label}</span>
                {thinkingSelection?.value === option.value ? (
                  <IconCheck className="text-fg-muted" size={15} stroke={1.8} />
                ) : null}
              </Menu.Item>
            ))}

            <div className="my-1 h-px bg-hairline" />

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
                    className="scroll-thin origin-(--transform-origin) w-[280px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg border border-hairline bg-elevated p-1 shadow-popup"
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

function ContextUsageRing({ percent }: { percent: number | undefined }) {
  const strokeWidth = 1.8;
  const center = 8;
  const radius = center - strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;
  const known = percent !== undefined;
  const offset = circumference * (1 - clampPercent(percent ?? 0) / 100);

  return (
    <svg
      aria-hidden="true"
      className="-rotate-90 shrink-0"
      fill="none"
      height="15"
      viewBox="0 0 16 16"
      width="15"
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        stroke="var(--color-hairline-strong)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={center}
        cy={center}
        r={radius}
        stroke="currentColor"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeWidth={strokeWidth}
        className={cn(
          "transition-[stroke-dashoffset] duration-300 ease-out",
          !known && "opacity-0",
        )}
      />
      {!known ? (
        <circle className="opacity-85" cx={center} cy={center} fill="currentColor" r="1.8" />
      ) : null}
    </svg>
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
          <Popover.Popup className="origin-(--transform-origin) rounded-lg border border-hairline bg-elevated p-2 shadow-popup transition-[transform,opacity] duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0">
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

function clampPercent(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

function contextUsagePercent(usage: ContextUsageInfo | undefined): number | undefined {
  if (!usage) {
    return undefined;
  }
  if (typeof usage.percent === "number" && Number.isFinite(usage.percent)) {
    return clampPercent(usage.percent);
  }
  if (
    typeof usage.tokens === "number" &&
    Number.isFinite(usage.tokens) &&
    usage.contextWindow > 0
  ) {
    return clampPercent((usage.tokens / usage.contextWindow) * 100);
  }
  return undefined;
}

function formatUsagePercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }
  return `${Math.round(value)}%`;
}
