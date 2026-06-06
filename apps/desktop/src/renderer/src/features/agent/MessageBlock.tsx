import { IconChevronRight } from "@tabler/icons-react";
import { AnimatePresence, m } from "motion/react";
import { useState } from "react";
import { MarkdownMessage } from "./MarkdownMessage";

type MessageBlockProps = {
  messageRole: "assistant" | "user";
  content: string;
  thinking: string;
  streaming?: boolean;
};

export function MessageBlock({
  messageRole,
  content,
  thinking,
  streaming = false,
}: MessageBlockProps) {
  const [thinkingOpen, setThinkingOpen] = useState(false);

  if (messageRole === "user") {
    if (!content.trim()) return null;

    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] rounded-xl border border-hairline bg-surface/95 px-4 py-2.5 text-sm text-fg leading-relaxed shadow-composer">
          <div className="whitespace-pre-wrap">{content}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 text-sm leading-relaxed">
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
      {content ? <MarkdownMessage content={content} streaming={streaming} /> : null}
    </div>
  );
}

function estimateThinkingSeconds(thinking: string): number {
  return Math.max(1, Math.min(9, Math.round(thinking.length / 240)));
}
