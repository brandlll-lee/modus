import { Popover } from "@base-ui/react/popover";
import { Select } from "@base-ui/react/select";
import {
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconCube,
  IconEdit,
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
import { useComposerImages } from "./useComposerImages";
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
    skills?: string[],
    mode?: AgentMode,
  ): void;
  onAbort?(): void;
  /** Controlled composer mode (build/plan); falls back to internal state. */
  mode?: AgentMode;
  onModeChange?(mode: AgentMode): void;
};

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
}: ComposerProps) {
  const [value, setValue] = useState("");
  const [dragging, setDragging] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [internalMode, setInternalMode] = useState<AgentMode>("build");
  const mode = controlledMode ?? internalMode;
  const setMode = (next: AgentMode): void => {
    onModeChange?.(next);
    if (controlledMode === undefined) {
      setInternalMode(next);
    }
  };
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addFiles, clearImages, images, removeImage, toAttachments } = useComposerImages();
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
  const invokedSkills = skillsFromComposerValue(value, slash.skills, selectedSkills);

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
    const message =
      hasText || hasSelectedSkills
        ? messageFromComposerValue(value, selectedSkills)
        : "See the attached image(s).";
    const attachments = toAttachments();
    onSubmit(
      message,
      contextItems,
      delivery,
      attachments.length > 0 ? attachments : undefined,
      invokedSkills.length > 0 ? invokedSkills : undefined,
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
        current.includes(item.name) ? current : [...current, item.name],
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
                    key={skill}
                  >
                    <IconCube size={15} stroke={1.8} />
                    <span>{skill}</span>
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
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const current = models.find((item) => item.id === model) ?? models[0];
  const editingItem = models.find((item) => item.id === editingModel);
  const editingOptions = editingItem ? modelThinkingOptions(editingItem) : [];
  const editingSelection = editingItem ? selectedThinkingOption(editingItem) : undefined;
  const tag = current?.name ?? "No model configured";

  return current ? (
    <Select.Root onValueChange={(next) => onModelChange(String(next))} value={model}>
      {/* Provider shown as its (frameless) logo, then the model + thinking. */}
      <Select.Trigger className="app-no-drag flex h-[26px] min-w-0 items-center gap-1.5 rounded-md px-2 text-sm font-normal transition-colors hover:bg-hover data-popup-open:bg-hover">
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
        <Select.Icon>
          <IconChevronDown className="shrink-0 text-fg-faint" size={12} stroke={2} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        {/* alignItemWithTrigger=false：禁用 base-ui Select 默认的"item 居中对齐 trigger"行为，
            popup 改为正常 anchor positioning，紧贴 trigger 下方弹出，不再覆盖触发器文字。 */}
        <Select.Positioner
          align="start"
          alignItemWithTrigger={false}
          collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
          side="bottom"
          sideOffset={4}
        >
          <Select.Popup
            className="scroll-thin origin-(--transform-origin) w-[340px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg border border-hairline bg-elevated p-1 shadow-popup transition-[transform,opacity] duration-100 data-[side=bottom]:data-ending-style:translate-y-[-4px] data-[side=bottom]:data-starting-style:translate-y-[-4px] data-[side=top]:data-ending-style:translate-y-[4px] data-[side=top]:data-starting-style:translate-y-[4px] data-ending-style:opacity-0 data-starting-style:opacity-0"
            style={{ maxHeight: "min(320px, var(--available-height))" }}
          >
            {models.map((item) => (
              <Select.Item
                className={cn(
                  "group/model flex h-8 cursor-default items-center gap-1.5 rounded-md px-2 text-sm outline-none select-none",
                  "data-highlighted:bg-hover",
                )}
                key={item.id}
                value={item.id}
              >
                <ProviderLogo
                  framed={false}
                  name={item.providerName ?? item.provider}
                  provider={item.provider}
                  size="sm"
                />
                <span className="shrink-0 text-sm text-fg-muted">
                  {item.providerName ?? item.provider}
                </span>
                <Select.ItemText className="min-w-0 truncate text-sm text-fg-subtle">
                  {item.name}
                </Select.ItemText>
                {!item.available ? (
                  <span className="ml-1 shrink-0 rounded bg-chip px-1 text-2xs text-fg-faint">
                    off
                  </span>
                ) : null}
                <span className="ml-1 shrink-0 text-2xs text-fg-faint">
                  {selectedThinkingLabel(item)}
                </span>
                <button
                  aria-label={`Edit ${item.name}`}
                  className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-md text-fg-faint opacity-0 transition-opacity hover:bg-active hover:text-fg-muted group-hover/model:opacity-100 data-[open=true]:opacity-100"
                  data-open={editingModel === item.id}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setEditingModel((current) => (current === item.id ? null : item.id));
                  }}
                  type="button"
                >
                  <IconEdit size={13} stroke={1.8} />
                </button>
                <span className="flex w-3.5 shrink-0 justify-center text-fg">
                  <Select.ItemIndicator>
                    <IconCheck size={13} stroke={2} />
                  </Select.ItemIndicator>
                </span>
              </Select.Item>
            ))}
            {editingItem ? (
              <div className="mt-1 border-hairline-soft border-t px-1 pt-2 pb-1">
                <div className="mb-1 flex items-center justify-between px-1">
                  <span className="truncate text-xs text-fg-faint">
                    Thinking · {editingItem.name}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {editingOptions.map((option) => (
                    <button
                      className={cn(
                        "h-7 rounded-md px-2 text-xs transition-colors",
                        editingSelection?.value === option.value
                          ? "bg-active text-fg"
                          : "text-fg-subtle hover:bg-hover hover:text-fg",
                      )}
                      key={option.value}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void onModelConfigChange?.(editingItem.id, option.value);
                        setEditingModel(null);
                      }}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  ) : (
    <button
      className="app-no-drag flex h-[26px] items-center gap-1 rounded-md px-2 text-sm font-normal text-fg-faint transition-colors hover:bg-hover hover:text-fg-subtle"
      type="button"
    >
      No model configured
    </button>
  );
}

function ContextRing({ percent }: { percent: number }) {
  const radius = 6.5;
  const circumference = 2 * Math.PI * radius;
  const dash = (clampPercent(percent) / 100) * circumference;
  return (
    <svg
      aria-label={`${Math.round(clampPercent(percent))}% of context used`}
      className="-rotate-90 shrink-0"
      fill="none"
      height="15"
      role="img"
      viewBox="0 0 16 16"
      width="15"
    >
      <circle cx="8" cy="8" r={radius} stroke="var(--color-hairline-strong)" strokeWidth="1.6" />
      <circle
        cx="8"
        cy="8"
        r={radius}
        stroke="currentColor"
        strokeDasharray={`${dash} ${circumference}`}
        strokeLinecap="round"
        strokeWidth="1.6"
      />
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
  const label = formatUsagePercent(usage?.percent);

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`Context usage ${label}`}
        className="app-no-drag flex h-[22px] items-center gap-1.5 rounded-md px-1.5 text-[10px] text-fg-faint transition-colors hover:bg-hover hover:text-fg-subtle data-popup-open:text-fg-subtle"
      >
        <ContextRing percent={usage?.percent ?? 0} />
        <span className="tabular-nums">{label} context</span>
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
  const total = usage?.percent;
  const usageWindow = usage?.contextWindow ?? contextWindow;
  const tokenLine =
    usage?.tokens !== null && usage?.tokens !== undefined && usageWindow
      ? `${usage.tokens.toLocaleString()} / ${usageWindow.toLocaleString()} tokens`
      : undefined;

  return (
    <div className="w-[320px] px-1 py-1.5 text-sm text-fg">
      <div className="mb-2 font-medium text-fg-muted">Context usage</div>
      <ContextUsageRow label="Conversation" value={formatUsagePercent(total)} />
      <ContextUsageRow label="MCP tools" value="—" />
      <ContextUsageRow label="Steering files" value="—" />
      <div className="my-2 border-hairline-soft border-t" />
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

function formatUsagePercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }
  return `${Math.round(value)}%`;
}

function messageFromComposerValue(value: string, selectedSkills: string[]): string {
  const skillText = selectedSkills.map((skill) => `"${skill}"`).join(" ");
  return [skillText, value.trim()].filter(Boolean).join(" ");
}

function skillsFromComposerValue(
  value: string,
  knownSkills: Array<{ name: string }>,
  selectedSkills: string[],
): string[] {
  if (knownSkills.length === 0 && selectedSkills.length === 0) {
    return [];
  }
  const quoted = new Set(Array.from(value.matchAll(/"([^"\r\n]+)"/g), (match) => match[1] ?? ""));
  const invoked = new Set<string>(selectedSkills);
  for (const skill of knownSkills) {
    if (quoted.has(skill.name)) {
      invoked.add(skill.name);
    }
  }
  return [...invoked];
}
