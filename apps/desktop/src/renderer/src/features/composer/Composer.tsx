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
import { Tooltip } from "../../components/ui/Tooltip";
import { TypingAnimation } from "../../components/ui/TypingAnimation";
import { cn } from "../../lib/cn";

const HERO_PLACEHOLDER_WORDS = [
  "Plan, build, / for skills, @ for context",
  "Refactor safely, / for skills, @ for context",
  "Debug with context, / for skills, @ for context",
];

const SESSION_PLACEHOLDER_WORDS = [
  "Reply to the agent…  / for skills, @ for context",
  "Ask a follow-up…  / for skills, @ for context",
];

// Cursor 桌面 Composer 的模型按钮形态："族名 + tag"两段式 (例 "Opus 4.7 Max Fast")，不带图标。
const MODELS = [
  { value: "pi-default", name: "pi", tag: "default" },
  { value: "pi-fast", name: "pi", tag: "fast" },
  { value: "pi-reasoning", name: "pi", tag: "reasoning" },
];

type ComposerProps = {
  model: string;
  canSubmit: boolean;
  hasSession: boolean;
  onModelChange(model: string): void;
  onSubmit(message: string): void;
};

export function Composer({ model, canSubmit, hasSession, onModelChange, onSubmit }: ComposerProps) {
  const [value, setValue] = useState("");
  const hasText = value.trim().length > 0;

  function send(): void {
    if (!hasText || !canSubmit) {
      return;
    }
    onSubmit(value.trim());
    setValue("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
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
            <TypingAnimation
              blinkCursor
              cursorStyle="line"
              deleteSpeed={28}
              loop
              pauseDelay={2200}
              showCursor
              startOnView={false}
              typeSpeed={42}
              words={hasSession ? SESSION_PLACEHOLDER_WORDS : HERO_PLACEHOLDER_WORDS}
            />
          </div>
        ) : null}
        <textarea
          className="scroll-thin block max-h-[260px] min-h-[68px] w-full resize-none bg-transparent px-4 pt-4 text-md font-normal text-fg leading-[1.5] outline-none"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          value={value}
        />
      </div>

      <div className="flex items-center gap-2 px-3 pt-1 pb-2.5">
        <Tooltip content="Add context">
          <button
            aria-label="Add context"
            className="flex size-[26px] items-center justify-center rounded-full text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
            type="button"
          >
            <IconPlus size={16} stroke={1.7} />
          </button>
        </Tooltip>

        <ModelSelect model={model} onModelChange={onModelChange} />

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
  onModelChange,
}: {
  model: string;
  onModelChange(model: string): void;
}) {
  const current = MODELS.find((item) => item.value === model);
  const name = current?.name ?? "pi";
  const tag = current?.tag ?? "default";

  return (
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
          side="bottom"
          sideOffset={6}
        >
          <Select.Popup className="origin-(--transform-origin) min-w-[220px] rounded-lg border border-hairline bg-elevated p-1 shadow-popup transition-[transform,opacity] duration-100 data-ending-style:translate-y-[-4px] data-ending-style:opacity-0 data-starting-style:translate-y-[-4px] data-starting-style:opacity-0">
            {MODELS.map((item) => (
              <Select.Item
                className={cn(
                  "flex h-8 cursor-default items-center gap-1.5 rounded-md px-2 text-sm outline-none select-none",
                  "data-highlighted:bg-hover",
                )}
                key={item.value}
                value={item.value}
              >
                <Select.ItemText className="text-fg-muted">{item.name}</Select.ItemText>
                <span className="text-sm text-fg-subtle">{item.tag}</span>
                <span className="ml-auto flex w-3.5 justify-center text-fg">
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
  );
}
