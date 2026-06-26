import {
  AnimatePresence,
  type MotionValue,
  m,
  useMotionValue,
  useSpring,
  useTransform,
} from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import { formatClock } from "../../lib/formatClock";
import { blockRenderKeys, type TimelineBlock } from "./Timeline";

const DEFAULT_BASE_WIDTH = 8;
const DEFAULT_MAGNIFICATION = 28;
const DEFAULT_DISTANCE = 100;
const DEFAULT_HIDE_DELAY_MS = 1500;
const PREVIEW_LENGTH = 80;
const PREVIEW_WIDTH = 320;
const PREVIEW_SIDE_OFFSET = 12;
const PREVIEW_COLLISION_PADDING = 12;
const TIMELINE_TICK_PITCH = 14;

export type RailEntry = {
  key: string;
  blockIndex: number;
  userPreview: string;
  assistantPreview?: string;
  userCreatedAt?: number;
  assistantCreatedAt?: number;
};

type ConversationTimelineProps = {
  blocks: TimelineBlock[];
  scrollContainer: HTMLDivElement | null;
  baseWidth?: number;
  magnification?: number;
  distance?: number;
};

type PreviewTarget = {
  anchorY: number;
  entry: RailEntry;
  left: number;
};

export function messagePreview(content: string, maxLength = PREVIEW_LENGTH): string {
  const text = content
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const chars = Array.from(text);
  if (chars.length <= maxLength) {
    return text;
  }
  if (maxLength <= 3) {
    return chars.slice(0, maxLength).join("");
  }
  return `${chars.slice(0, maxLength - 3).join("")}...`;
}

export function extractRailEntries(blocks: TimelineBlock[]): RailEntry[] {
  const keys = blockRenderKeys(blocks);
  const entries: RailEntry[] = [];
  const assistantTextByEntry = new Map<RailEntry, string>();
  let currentEntry: RailEntry | undefined;

  blocks.forEach((block, blockIndex) => {
    if (block.type !== "message" || !block.content.trim()) {
      return;
    }

    if (block.role === "user") {
      const entry: RailEntry = {
        key: keys[blockIndex] ?? `${block.id}:${blockIndex}`,
        blockIndex,
        userPreview: messagePreview(block.content),
      };
      if (block.createdAt !== undefined) {
        entry.userCreatedAt = block.createdAt;
      }
      entries.push(entry);
      assistantTextByEntry.set(entry, "");
      currentEntry = entry;
      return;
    }

    if (!currentEntry || block.streaming) {
      return;
    }

    const assistantText = [assistantTextByEntry.get(currentEntry), block.content]
      .filter(Boolean)
      .join("\n\n");
    assistantTextByEntry.set(currentEntry, assistantText);
    currentEntry.assistantPreview = messagePreview(assistantText);
    if (block.createdAt !== undefined) {
      currentEntry.assistantCreatedAt = block.createdAt;
    }
  });

  return entries;
}

export function railTrackHeight(entryCount: number, tickPitch = TIMELINE_TICK_PITCH): string {
  return `min(100%, ${entryCount * tickPitch}px)`;
}

export function railEntryIndexAtClientY(
  clientY: number,
  trackTop: number,
  trackHeight: number,
  entryCount: number,
): number | undefined {
  if (
    entryCount <= 0 ||
    trackHeight <= 0 ||
    !Number.isFinite(clientY) ||
    !Number.isFinite(trackTop) ||
    !Number.isFinite(trackHeight)
  ) {
    return undefined;
  }
  const offset = clientY - trackTop;
  if (offset < 0 || offset > trackHeight) {
    return undefined;
  }
  return Math.min(entryCount - 1, Math.floor((offset / trackHeight) * entryCount));
}

export function previewTopForAnchor(
  anchorY: number,
  previewHeight: number,
  viewportHeight: number,
  collisionPadding = PREVIEW_COLLISION_PADDING,
): number {
  const preferredTop = anchorY - previewHeight / 2;
  const maxTop = Math.max(collisionPadding, viewportHeight - previewHeight - collisionPadding);
  return Math.min(Math.max(preferredTop, collisionPadding), maxTop);
}

export function previewLeftForRail(
  railRight: number,
  previewWidth: number,
  viewportWidth: number,
  sideOffset = PREVIEW_SIDE_OFFSET,
  collisionPadding = PREVIEW_COLLISION_PADDING,
): number {
  const preferredLeft = railRight + sideOffset;
  const maxLeft = Math.max(collisionPadding, viewportWidth - previewWidth - collisionPadding);
  return Math.min(preferredLeft, maxLeft);
}

export function ConversationTimeline({
  blocks,
  scrollContainer,
  baseWidth = DEFAULT_BASE_WIDTH,
  magnification = DEFAULT_MAGNIFICATION,
  distance = DEFAULT_DISTANCE,
}: ConversationTimelineProps) {
  const entries = useMemo(() => extractRailEntries(blocks), [blocks]);
  const mouseY = useMotionValue(Number.POSITIVE_INFINITY);
  const previewRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const [previewTop, setPreviewTop] = useState(0);
  const { hideNow, setMouseInside, visible } = useRailVisibility(scrollContainer);

  const updatePreviewFromPointer = useCallback(
    (clientY: number): void => {
      const track = trackRef.current;
      if (!track) {
        return;
      }
      const rect = track.getBoundingClientRect();
      const index = railEntryIndexAtClientY(clientY, rect.top, rect.height, entries.length);
      if (index === undefined) {
        setPreviewTarget(null);
        return;
      }
      const entry = entries[index];
      if (!entry) {
        return;
      }
      const rowHeight = rect.height / entries.length;
      const anchorY = rect.top + rowHeight * (index + 0.5);
      const previewWidth = previewRef.current?.offsetWidth ?? PREVIEW_WIDTH;
      const left = previewLeftForRail(rect.right, previewWidth, window.innerWidth);
      setPreviewTarget((current) =>
        current?.entry === entry && current.anchorY === anchorY && current.left === left
          ? current
          : { anchorY, entry, left },
      );
    },
    [entries],
  );

  const updatePreviewTop = useCallback((): void => {
    if (!previewTarget) {
      return;
    }
    setPreviewTop(
      previewTopForAnchor(
        previewTarget.anchorY,
        previewRef.current?.offsetHeight ?? 0,
        window.innerHeight,
      ),
    );
  }, [previewTarget]);

  useLayoutEffect(() => {
    updatePreviewTop();
  }, [updatePreviewTop]);

  useEffect(() => {
    if (!previewTarget) {
      return;
    }
    window.addEventListener("resize", updatePreviewTop);
    return () => window.removeEventListener("resize", updatePreviewTop);
  }, [previewTarget, updatePreviewTop]);

  useEffect(() => {
    setPreviewTarget((current) => (current && entries.includes(current.entry) ? current : null));
  }, [entries]);

  if (entries.length === 0) {
    return null;
  }

  const preview = (
    <AnimatePresence initial={false}>
      {previewTarget ? (
        <m.div
          animate={{ opacity: 1, scale: 1, x: previewTarget.left, y: previewTop }}
          className="pointer-events-none fixed top-0 left-0 z-50 max-h-[calc(100vh-24px)] max-w-[calc(100vw-24px)] origin-left overflow-hidden rounded-lg border border-hairline bg-elevated px-3 py-2.5 text-left shadow-popup outline-none"
          exit={{ opacity: 0, scale: 0.99 }}
          initial={{ opacity: 0, scale: 0.985, x: previewTarget.left, y: previewTop }}
          ref={previewRef}
          style={{ width: PREVIEW_WIDTH }}
          transition={{ duration: 0.1, ease: [0.22, 1, 0.36, 1] }}
        >
          <TimelinePreviewCard entry={previewTarget.entry} />
        </m.div>
      ) : null}
    </AnimatePresence>
  );

  return (
    <>
      <m.nav
        animate={{ opacity: visible ? 1 : 0, x: visible ? 0 : -8 }}
        aria-label="Conversation timeline"
        className={cn(
          "absolute top-0 bottom-0 left-0 z-20 w-14 py-4 pl-2 pr-3",
          visible ? "pointer-events-auto" : "pointer-events-none",
        )}
        initial={false}
        onMouseEnter={(event) => {
          setMouseInside(true);
          updatePreviewFromPointer(event.clientY);
        }}
        onMouseLeave={() => {
          mouseY.set(Number.POSITIVE_INFINITY);
          setPreviewTarget(null);
          setMouseInside(false);
        }}
        onMouseMove={(event) => {
          mouseY.set(event.clientY);
          updatePreviewFromPointer(event.clientY);
        }}
        transition={{ duration: visible ? 0.2 : 0.4, ease: visible ? "easeOut" : "easeIn" }}
      >
        <div
          className="grid w-full"
          ref={trackRef}
          style={{
            gridTemplateRows: `repeat(${entries.length}, minmax(0, 1fr))`,
            height: railTrackHeight(entries.length),
          }}
        >
          {entries.map((entry) => (
            <TimelineTick
              active={previewTarget?.entry === entry}
              baseWidth={baseWidth}
              distance={distance}
              entry={entry}
              key={entry.key}
              magnification={magnification}
              mouseY={mouseY}
              onJump={() => {
                setPreviewTarget(null);
                hideNow();
                scrollToTimelineBlock(scrollContainer, entry.blockIndex);
              }}
            />
          ))}
        </div>
      </m.nav>
      {createPortal(preview, document.body)}
    </>
  );
}

function useRailVisibility(
  scrollContainer: HTMLDivElement | null,
  hideDelayMs = DEFAULT_HIDE_DELAY_MS,
) {
  const [visible, setVisible] = useState(false);
  const mouseInsideRef = useRef(false);
  const hideTimerRef = useRef<number | undefined>(undefined);

  const hideNow = useCallback((): void => {
    mouseInsideRef.current = false;
    window.clearTimeout(hideTimerRef.current);
    setVisible(false);
  }, []);

  const show = useCallback((): void => {
    window.clearTimeout(hideTimerRef.current);
    setVisible(true);
  }, []);

  const hideLater = useCallback((): void => {
    window.clearTimeout(hideTimerRef.current);
    if (mouseInsideRef.current) {
      return;
    }
    hideTimerRef.current = window.setTimeout(() => setVisible(false), hideDelayMs);
  }, [hideDelayMs]);

  const setMouseInside = useCallback(
    (inside: boolean): void => {
      mouseInsideRef.current = inside;
      if (inside) {
        show();
      } else {
        hideLater();
      }
    },
    [hideLater, show],
  );

  useEffect(() => {
    if (!scrollContainer) {
      return;
    }

    const onScroll = (): void => {
      show();
      hideLater();
    };

    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", onScroll);
  }, [hideLater, scrollContainer, show]);

  useEffect(
    () => () => {
      window.clearTimeout(hideTimerRef.current);
    },
    [],
  );

  return { hideNow, setMouseInside, visible: visible || mouseInsideRef.current };
}

function TimelineTick({
  active,
  baseWidth,
  distance,
  entry,
  magnification,
  mouseY,
  onJump,
}: {
  active: boolean;
  baseWidth: number;
  distance: number;
  entry: RailEntry;
  magnification: number;
  mouseY: MotionValue<number>;
  onJump(): void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const distanceFromMouse = useTransform(mouseY, (value) => {
    const bounds = ref.current?.getBoundingClientRect();
    if (!bounds || !Number.isFinite(value)) {
      return Number.POSITIVE_INFINITY;
    }
    return value - bounds.y - bounds.height / 2;
  });
  const widthTarget = useTransform(distanceFromMouse, (value) => {
    if (!Number.isFinite(value)) {
      return baseWidth;
    }
    const closeness = Math.max(0, 1 - Math.abs(value) / distance);
    return baseWidth + (magnification - baseWidth) * closeness;
  });
  const width = useSpring(widthTarget, { mass: 0.1, stiffness: 150, damping: 12 });
  const clock = formatClock(entry.userCreatedAt);

  return (
    <div className="relative flex min-h-0 items-center">
      <m.button
        aria-label={clock ? `Jump to turn at ${clock}` : "Jump to turn"}
        className={cn(
          "h-[3px] rounded-sm border-0 p-0 transition-colors hover:bg-fg-subtle",
          active ? "bg-fg-subtle" : "bg-fg-faint/70",
        )}
        onClick={onJump}
        ref={ref}
        style={{ width }}
        type="button"
      />
    </div>
  );
}

function TimelinePreviewCard({ entry }: { entry: RailEntry }) {
  const userClock = formatClock(entry.userCreatedAt);
  const assistantClock = formatClock(entry.assistantCreatedAt);

  return (
    <>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-2xs font-medium text-fg-muted">You</span>
        {userClock ? (
          <span className="text-2xs text-fg-faint tabular-nums">{userClock}</span>
        ) : null}
      </div>
      <p className="line-clamp-2 min-h-[2lh] text-xs text-fg-subtle leading-relaxed">
        {entry.userPreview}
      </p>
      {entry.assistantPreview ? (
        <>
          <div className="mt-2 mb-1 flex items-center gap-2">
            <span className="text-2xs font-medium text-fg-muted">Modus</span>
            {assistantClock ? (
              <span className="text-2xs text-fg-faint tabular-nums">{assistantClock}</span>
            ) : null}
          </div>
          <p className="line-clamp-2 min-h-[2lh] text-xs text-fg-subtle leading-relaxed">
            {entry.assistantPreview}
          </p>
        </>
      ) : null}
    </>
  );
}

function scrollToTimelineBlock(scrollContainer: HTMLDivElement | null, blockIndex: number): void {
  const target = scrollContainer?.querySelectorAll<HTMLElement>(".timeline-block")[blockIndex];
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}
