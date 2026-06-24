import { IconAlertCircle, IconChevronRight } from "@tabler/icons-react";
import { m } from "motion/react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CollapsibleMotion } from "../../components/ui/CollapsibleMotion";
import { ShinyText } from "../../components/ui/ShinyText";
import { cn } from "../../lib/cn";
import type { ActivityItem } from "./Timeline";
import { ToolCard } from "./ToolCard";

/** Rough reading-time estimate for a thinking transcript (1–9s), Cursor-style. */
function estimateThinkingSeconds(text: string): number {
  return Math.max(1, Math.min(9, Math.round(text.length / 240)));
}

/**
 * One thinking segment. While it streams it auto-expands and the label shimmers
 * ("Thinking", reusing the timeline's ShinyText); once done it folds to a
 * one-line "Thought for Xs" the reader can re-open. Used both standalone in the
 * timeline and interleaved inside an {@link ActivityGroup}.
 */
export function ThoughtRow({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  const interactedRef = useRef(false);
  const preRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (!interactedRef.current) {
      setOpen(streaming);
    }
  }, [streaming]);

  const showBody = open;
  const textLength = text.length;

  useLayoutEffect(() => {
    if (!streaming || !showBody || !preRef.current || textLength === 0) {
      return;
    }
    preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [streaming, showBody, textLength]);

  if (!streaming && !text.trim()) {
    return null;
  }

  const label = streaming ? "Thinking" : `Thought for ${estimateThinkingSeconds(text)}s`;

  return (
    <div className="min-w-0">
      <button
        aria-expanded={open}
        className="flex items-center gap-1 text-sm text-fg-subtle transition-colors hover:text-fg-muted"
        onClick={() => {
          interactedRef.current = true;
          setOpen((value) => !value);
        }}
        type="button"
      >
        <m.span
          animate={{ rotate: open ? 90 : 0 }}
          className="flex size-3 items-center justify-center"
          transition={{ duration: 0.16, ease: "easeOut" }}
        >
          <IconChevronRight size={12} stroke={1.8} />
        </m.span>
        {streaming ? <ShinyText>{label}</ShinyText> : <span>{label}</span>}
      </button>
      <CollapsibleMotion open={showBody} preset="timeline">
        <pre
          className="scroll-thin mt-1 max-h-44 max-w-full overflow-x-auto overflow-y-auto whitespace-pre-wrap text-2xs text-fg-faint leading-relaxed"
          ref={preRef}
        >
          {text}
        </pre>
      </CollapsibleMotion>
    </div>
  );
}

const ACTIVE_LABEL = {
  explore: "Exploring",
  browser: "Browser using",
  shell: "Running command",
} as const;

/**
 * Growth signature for the live viewport's stick-to-bottom. It must move on
 * EVERY change that can push the newest tool down, not just streamed output:
 *  - the item COUNT, so a freshly-called tool (entering with empty output, and
 *    often a flat one-line card) scrolls into view the instant it appears;
 *  - each tool's output;
 *  - streamed thought text. Streaming args intentionally do not count:
 *    serializing large args was the hot path during tool-call streaming.
 * Counting only output (the old bug) left a just-called tool clipped below the
 * fade until it produced output, so the preview lagged the latest tool.
 */
function streamSignature(items: ActivityItem[]): number {
  let total = items.length;
  for (const item of items) {
    if (item.type === "tool") {
      total += item.output.length;
    } else if (item.type === "thought") {
      total += item.text.length;
    }
  }
  return total;
}

/**
 * Cursor-style folded activity run (read-only exploration, shell, or browser control).
 *
 * While the agent is still working the group is forced open and streams its
 * members — interleaved thoughts and flat tool rows — inside a fixed-height
 * viewport that fades out at the edges (no hard
 * border) and sticks to the latest line. Once the run seals it collapses to a
 * one-line digest ("Explored 4 files…" / "Browser used 2 pages"); re-opening it
 * restores the full, freely-scrolling transcript.
 */
export const ActivityGroup = memo(function ActivityGroup({
  kind,
  active,
  summary,
  items,
  isError = false,
}: {
  kind: "explore" | "browser" | "shell";
  active: boolean;
  summary: string;
  items: ActivityItem[];
  isError?: boolean;
}) {
  const [open, setOpen] = useState(active);
  const interactedRef = useRef(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // Track the run's lifecycle: open while working, fold once sealed — until the
  // reader takes over the toggle, after which their choice wins.
  useEffect(() => {
    if (!interactedRef.current) {
      setOpen(active);
    }
  }, [active]);

  // Stick the live viewport to the bottom so the newest tool stays in view.
  const signature = streamSignature(items);
  // biome-ignore lint/correctness/useExhaustiveDependencies: signature is the content-growth signal that should retrigger the scroll; the node is read via ref.
  useLayoutEffect(() => {
    if (active && open && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [active, open, signature]);

  const label = active ? ACTIVE_LABEL[kind] : summary;

  return (
    <div className="min-w-0 text-sm">
      <button
        aria-expanded={open}
        className="group/activity flex w-fit min-w-0 max-w-full items-center gap-1.5 rounded-md py-0.5 text-left transition-colors"
        onClick={() => {
          interactedRef.current = true;
          setOpen((value) => !value);
        }}
        type="button"
      >
        {/* Dropdown caret leads the row (图3), rotating down as it opens. */}
        <m.span
          animate={{ rotate: open ? 90 : 0 }}
          className="flex size-3 shrink-0 items-center justify-center text-fg-faint"
          transition={{ duration: 0.16, ease: "easeOut" }}
        >
          <IconChevronRight size={12} stroke={1.8} />
        </m.span>
        {isError ? (
          <IconAlertCircle className="shrink-0 text-danger" size={14} stroke={1.7} />
        ) : null}
        {active ? (
          <ShinyText>{label}</ShinyText>
        ) : (
          <span
            className={cn(
              "min-w-0 truncate transition-colors",
              isError ? "text-danger" : "text-fg-subtle group-hover/activity:text-fg-muted",
            )}
          >
            {label}
          </span>
        )}
      </button>
      <CollapsibleMotion open={open} preset="timeline">
        {/* Guide line in the caret gutter: its height tracks the rendered content
            (it wraps the viewport), so the rail reads as "this much was folded". */}
        <div className="mt-0.5 ml-[6px] border-hairline-strong border-l pl-3">
          <div
            className={cn(
              "space-y-1 pt-0.5 pb-1",
              active
                ? "activity-fade max-h-[200px] overflow-hidden"
                : "scroll-thin max-h-96 overflow-y-auto",
            )}
            ref={viewportRef}
          >
            {items.map((item) =>
              item.type === "thought" ? (
                <ThoughtRow key={item.id} streaming={item.streaming ?? false} text={item.text} />
              ) : (
                <ToolCard
                  args={item.args}
                  isComplete={item.isComplete ?? false}
                  isError={item.isError ?? false}
                  key={item.id}
                  name={item.name}
                  output={item.output}
                  {...(kind === "shell" ? { variant: "group" as const } : {})}
                />
              ),
            )}
          </div>
        </div>
      </CollapsibleMotion>
    </div>
  );
});
