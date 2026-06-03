import { Select } from "@base-ui/react/select";
import {
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconMicrophone,
  IconPlus,
} from "@tabler/icons-react";
import { AnimatePresence, m } from "motion/react";
import { type KeyboardEvent, useState } from "react";
import type { ContextItem, ContextSuggestion, ModelInfo } from "../../../../shared/contracts";
import { Tooltip } from "../../components/ui/Tooltip";
import { TypingAnimation } from "../../components/ui/TypingAnimation";
import { cn } from "../../lib/cn";
import { ContextMentionMenu } from "./ContextMentionMenu";
import { ContextToken } from "./ContextToken";
import { useComposerMentions } from "./useComposerMentions";

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
  workspaceId: string | undefined;
  cwd: string | undefined;
  canSubmit: boolean;
  hasSession: boolean;
  onModelChange(model: string): void;
  onContextChange(items: ContextItem[]): void;
  onSubmit(message: string, context: ContextItem[]): void;
};

export function Composer({
  model,
  models,
  contextItems,
  workspaceId,
  cwd,
  canSubmit,
  hasSession,
  onModelChange,
  onContextChange,
  onSubmit,
}: ComposerProps) {
  const [value, setValue] = useState("");
  const hasText = value.trim().length > 0;
  const { activeIndex, isOpen, mention, setActiveIndex, suggestions } = useComposerMentions({
    cwd,
    value,
    workspaceId,
  });

  function send(): void {
    if (!hasText || !canSubmit) {
      return;
    }
    onSubmit(value.trim(), contextItems);
    setValue("");
    onContextChange([]);
  }

  function addContext(suggestion: ContextSuggestion): void {
    const key = contextItemKey(suggestion.item);
    if (!contextItems.some((item) => contextItemKey(item) === key)) {
      onContextChange([...contextItems, suggestion.item]);
    }
    if (mention) {
      setValue(
        `${value.slice(0, mention.start)}${value.slice(mention.start).replace(/@[^\s]*$/, "")}`,
      );
    }
  }

  async function openContextMenu(): Promise<void> {
    if (!workspaceId || !cwd) {
      return;
    }
    if (value.endsWith("@") || /(?:^|\s)@[^\s]*$/.test(value)) {
      return;
    }
    setValue((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@`);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (isOpen && event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
      return;
    }

    if (isOpen && event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
      return;
    }

    if (isOpen && event.key === "Escape") {
      event.preventDefault();
      setValue((current) => (mention ? current.slice(0, mention.start) : current));
      return;
    }

    if (isOpen && event.key === "Enter" && suggestions[activeIndex]) {
      event.preventDefault();
      addContext(suggestions[activeIndex]);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  return (
    <div className="rounded-[14px] border border-hairline-soft bg-surface shadow-composer transition-colors focus-within:border-hairline">
      <div className="relative">
        {!hasText ? (
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
        <textarea
          className="scroll-thin block max-h-[260px] min-h-[68px] w-full resize-none bg-transparent px-4 pt-4 text-md font-normal text-fg leading-[1.5] outline-none"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          value={value}
        />
        <ContextMentionMenu
          activeIndex={activeIndex}
          onSelect={addContext}
          suggestions={isOpen ? suggestions : []}
        />
      </div>

      {contextItems.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 px-3 pt-1">
          {contextItems.map((item, index) => (
            <ContextToken
              item={item}
              key={contextItemKey(item)}
              onRemove={() =>
                onContextChange(contextItems.filter((_, itemIndex) => itemIndex !== index))
              }
            />
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2 px-3 pt-1 pb-2.5">
        <Tooltip content="Add context">
          <button
            aria-label="Add context"
            className="flex size-[26px] items-center justify-center rounded-full text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
            onClick={() => void openContextMenu()}
            type="button"
          >
            <IconPlus size={16} stroke={1.7} />
          </button>
        </Tooltip>

        <ModelSelect model={model} models={models} onModelChange={onModelChange} />

        <div className="flex-1" />

        {/* 用纯 opacity 切换 send/mic：去掉 scale 变换，避免每次切换都触发 layout/paint reflow；
            duration 80ms 触感更快，配合 LazyMotion(domAnimation) 走单帧 transform 路径。 */}
        <AnimatePresence initial={false} mode="popLayout">
          {hasText ? (
            <m.button
              animate={{ opacity: 1 }}
              aria-label="Send"
              className="flex size-[26px] items-center justify-center rounded-full bg-fg text-canvas transition-colors hover:bg-white active:scale-[0.94] disabled:bg-white/10 disabled:text-fg-faint"
              disabled={!canSubmit}
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              key="send"
              onClick={send}
              transition={{ duration: 0.08, ease: "linear" }}
              type="button"
            >
              <IconArrowUp size={14} stroke={2.4} />
            </m.button>
          ) : (
            <m.button
              animate={{ opacity: 1 }}
              aria-label="Dictate"
              className="flex size-[26px] items-center justify-center rounded-full bg-white/10 text-fg transition-colors hover:bg-white/14 active:scale-[0.94]"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              key="mic"
              transition={{ duration: 0.08, ease: "linear" }}
              type="button"
            >
              <IconMicrophone size={14} stroke={1.7} />
            </m.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ModelSelect({
  model,
  models,
  onModelChange,
}: {
  model: string;
  models: ModelInfo[];
  onModelChange(model: string): void;
}) {
  const items: ModelInfo[] =
    models.length > 0 ? models : [{ available: false, id: model, provider: "pi", name: "default" }];
  const current = items.find((item) => item.id === model) ?? items[0];
  const name = current?.provider ?? "pi";
  const tag = current?.name ?? "default";

  return current ? (
    <Select.Root onValueChange={(next) => onModelChange(String(next))} value={model}>
      {/* 不再前置 Sparkles 图标，与 Cursor 原生模型按钮形态一致 */}
      <Select.Trigger className="app-no-drag flex h-[26px] items-center gap-1 rounded-md px-2 text-sm font-normal transition-colors hover:bg-hover data-popup-open:bg-hover">
        <span className="text-fg-muted">{name}</span>
        <span className="text-fg-subtle">{tag}</span>
        <Select.Icon>
          <IconChevronDown className="text-fg-faint" size={12} stroke={2} />
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
            {items.map((item) => (
              <Select.Item
                className={cn(
                  "flex h-8 cursor-default items-center gap-1.5 rounded-md px-2 text-sm outline-none select-none",
                  "data-highlighted:bg-hover",
                )}
                key={item.id}
                value={item.id}
              >
                <Select.ItemText className="shrink-0 text-fg-muted">
                  {item.provider}
                </Select.ItemText>
                <span className="min-w-0 truncate text-sm text-fg-subtle">{item.name}</span>
                {!item.available ? (
                  <span className="ml-1 shrink-0 rounded bg-white/6 px-1 text-2xs text-fg-faint">
                    off
                  </span>
                ) : null}
                <span className="ml-auto flex w-3.5 shrink-0 justify-center text-fg">
                  <Select.ItemIndicator>
                    <IconCheck size={13} stroke={2} />
                  </Select.ItemIndicator>
                </span>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  ) : null;
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

  return `git-diff:${item.mode}:${item.base ?? ""}`;
}
