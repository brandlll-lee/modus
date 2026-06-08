import { IconChevronRight } from "@tabler/icons-react";
import { AnimatePresence, m } from "motion/react";
import { memo, useState } from "react";
import { CopyButton } from "../../components/ui/CopyButton";
import { useSmoothStreamingText } from "../../lib/useSmoothStreamingText";
import { MarkdownMessage } from "./MarkdownMessage";

type MessageBlockProps = {
  messageRole: "assistant" | "user";
  content: string;
  thinking: string;
  streaming?: boolean;
  /** Epoch ms — user send time. */
  createdAt?: number;
  /** Assistant only: present on the last message of a turn → shows one footer. */
  actions?: { content: string; createdAt?: number };
};

export const MessageBlock = memo(function MessageBlock({
  messageRole,
  content,
  thinking,
  streaming = false,
  createdAt,
  actions,
}: MessageBlockProps) {
  const [thinkingOpen, setThinkingOpen] = useState(false);
  // Smoothly reveal assistant text like a typewriter, decoupled from bursty
  // provider chunks. User messages are already complete, so this is a no-op.
  const displayContent = useSmoothStreamingText(content, streaming);

  if (messageRole === "user") {
    if (!content.trim()) return null;

    return (
      <div className="group flex flex-col items-end gap-1">
        <div className="max-w-[78%] rounded-xl border border-hairline bg-surface/95 px-4 py-2.5 text-sm text-fg leading-relaxed shadow-composer">
          <div className="whitespace-pre-wrap">{content}</div>
        </div>
        <div className="flex h-6 items-center gap-1 pr-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <span className="text-2xs text-fg-faint tabular-nums">{formatClock(createdAt)}</span>
          <CopyButton label="Copy message" text={content} />
        </div>
      </div>
    );
  }

  return (
    <div className="group min-w-0 text-sm leading-relaxed">
      {thinking ? (
        <div className="mb-1.5">
          <button
            className="flex items-center gap-1 text-sm text-fg-subtle transition-colors hover:text-fg-muted"
            onClick={() => setThinkingOpen((open) => !open)}
            type="button"
          >
            <m.span
              animate={{ rotate: thinkingOpen ? 90 : 0 }}
              className="flex size-3 items-center justify-center"
              transition={{ duration: 0.16, ease: "easeOut" }}
            >
              <IconChevronRight size={12} stroke={1.8} />
            </m.span>
            <span>{`Thought for ${estimateThinkingSeconds(thinking)}s`}</span>
          </button>
          <AnimatePresence initial={false}>
            {thinkingOpen ? (
              <m.pre
                animate={{ height: "auto", opacity: 1 }}
                className="scroll-thin mt-1 max-h-44 overflow-y-auto whitespace-pre-wrap pl-4 font-mono text-2xs text-fg-faint leading-relaxed"
                exit={{ height: 0, opacity: 0 }}
                initial={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              >
                {thinking}
              </m.pre>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}
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

function estimateThinkingSeconds(thinking: string): number {
  return Math.max(1, Math.min(9, Math.round(thinking.length / 240)));
}

function formatClock(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
