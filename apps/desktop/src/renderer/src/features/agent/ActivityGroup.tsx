import { IconAlertCircle, IconChevronRight } from "@tabler/icons-react";
import { m } from "motion/react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CollapsibleMotion } from "../../components/ui/CollapsibleMotion";
import { cn } from "../../lib/cn";
import { MarkdownMessage } from "./MarkdownMessage";
import { ShinyText } from "./TextEffects";
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

  useEffect(() => {
    if (!interactedRef.current) {
      setOpen(streaming);
    }
  }, [streaming]);

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
      <CollapsibleMotion open={open} preset="timeline">
        <pre className="scroll-thin mt-1 max-h-44 max-w-full overflow-x-auto overflow-y-auto whitespace-pre-wrap font-mono text-2xs text-fg-faint leading-relaxed">
          {text}
        </pre>
      </CollapsibleMotion>
    </div>
  );
}

const ACTIVE_LABEL = { explore: "Exploring", browser: "Browser using" } as const;

/** Cheap content-length signature so the streaming viewport can stick to bottom. */
function streamLength(items: ActivityItem[]): number {
  let total = 0;
  for (const item of items) {
    if (item.type === "tool") total += item.output.length;
    else if (item.type === "thought") total += item.text.length;
    else total += item.content.length;
  }
  return total;
}

/**
 * Cursor-style folded activity run (read-only exploration or browser control).
 *
 * While the agent is still working the group is forced open and streams its
 * members — interleaved thoughts, intermediate assistant text, and flat tool
 * rows — inside a fixed-height viewport that fades out at the edges (no hard
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
  kind: "explore" | "browser";
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

  // Stick the live viewport to the bottom so the newest line stays in view.
  const signature = streamLength(items);
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
        {isError ? (
          <IconAlertCircle className="shrink-0 text-danger" size={14} stroke={1.7} />
        ) : null}
        {active ? (
          <ShinyText>{label}</ShinyText>
        ) : (
          <span
            className={cn(
              "min-w-0 truncate transition-colors",
              isError ? "text-danger" : "text-fg-muted group-hover/activity:text-fg",
            )}
          >
            {label}
          </span>
        )}
        <IconChevronRight
          className={cn(
            "shrink-0 text-fg-faint transition-transform duration-150",
            open && "rotate-90",
          )}
          size={13}
          stroke={1.7}
        />
      </button>
      <CollapsibleMotion open={open} preset="timeline">
        <div
          className={cn(
            "space-y-1 pt-0.5 pb-1.5",
            active
              ? "activity-fade max-h-[200px] overflow-hidden"
              : "scroll-thin max-h-96 overflow-y-auto",
          )}
          ref={viewportRef}
        >
          {items.map((item) =>
            item.type === "thought" ? (
              <ThoughtRow key={item.id} streaming={item.streaming ?? false} text={item.text} />
            ) : item.type === "tool" ? (
              <ToolCard
                args={item.args}
                isComplete={item.isComplete ?? false}
                isError={item.isError ?? false}
                key={item.id}
                name={item.name}
                output={item.output}
              />
            ) : item.content.trim() ? (
              <div className="text-sm leading-relaxed text-fg-muted" key={item.id}>
                <MarkdownMessage content={item.content} />
              </div>
            ) : null,
          )}
        </div>
      </CollapsibleMotion>
    </div>
  );
});
