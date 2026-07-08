import {
  IconBrain,
  IconChevronRight,
  IconFileSearch,
  IconTerminal2,
  IconWorld,
} from "@tabler/icons-react";
import { m } from "motion/react";
import { memo, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CollapsibleMotion } from "../../components/ui/CollapsibleMotion";
import { ShinyText } from "../../components/ui/ShinyText";
import { cn } from "../../lib/cn";
import { useSmoothStreamingText } from "../../lib/useSmoothStreamingText";
import type { ActivityItem } from "./Timeline";
import { ToolCard } from "./ToolCard";

/** Rough reading-time estimate for a thinking transcript (1–9s), Cursor-style. */
function estimateThinkingSeconds(text: string): number {
  return Math.max(1, Math.min(9, Math.round(text.length / 240)));
}

type ActivityKind = "explore" | "browser" | "shell";

const ACTIVITY_ICONS: Record<ActivityKind, ReactNode> = {
  explore: <IconFileSearch size={14} stroke={1.7} />,
  browser: <IconWorld size={14} stroke={1.7} />,
  shell: <IconTerminal2 size={14} stroke={1.7} />,
};

function ActivityHeader({
  active = false,
  icon,
  label,
  onToggle,
  open,
}: {
  active?: boolean;
  icon: ReactNode;
  label: string;
  onToggle(): void;
  open: boolean;
}) {
  return (
    <button
      aria-expanded={open}
      className="group/activity flex w-fit min-w-0 max-w-full items-center gap-1.5 rounded-md py-0.5 text-left text-sm text-fg-subtle transition-colors hover:text-fg-muted"
      onClick={onToggle}
      type="button"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-fg-faint">{icon}</span>
      {active ? (
        <ShinyText>{label}</ShinyText>
      ) : (
        <span className="min-w-0 truncate transition-colors">{label}</span>
      )}
      <m.span
        animate={{ rotate: open ? 90 : 0 }}
        className="flex size-4 shrink-0 items-center justify-center text-fg-faint opacity-0 transition-opacity group-focus-visible/activity:opacity-100 group-hover/activity:opacity-100"
        transition={{ duration: 0.16, ease: "easeOut" }}
      >
        <IconChevronRight size={12} stroke={1.8} />
      </m.span>
    </button>
  );
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
  const displayText = useSmoothStreamingText(text, streaming);
  const textLength = displayText.length;

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
      <ActivityHeader
        active={streaming}
        icon={<IconBrain size={14} stroke={1.7} />}
        label={label}
        onToggle={() => {
          interactedRef.current = true;
          setOpen((value) => !value);
        }}
        open={open}
      />
      <CollapsibleMotion open={showBody} preset="timeline">
        <pre
          className="scroll-thin mt-1 max-h-44 max-w-full overflow-x-auto overflow-y-auto whitespace-pre-wrap text-2xs text-fg-faint leading-relaxed"
          ref={preRef}
        >
          {displayText}
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
}: {
  kind: ActivityKind;
  active: boolean;
  summary: string;
  items: ActivityItem[];
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
      <ActivityHeader
        active={active}
        icon={ACTIVITY_ICONS[kind]}
        label={label}
        onToggle={() => {
          interactedRef.current = true;
          setOpen((value) => !value);
        }}
        open={open}
      />
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
