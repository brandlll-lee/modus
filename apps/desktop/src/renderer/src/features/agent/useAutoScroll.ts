import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Stick-to-bottom scrolling, ported from opencode's `createAutoScroll`
 * (packages/ui/src/hooks/create-auto-scroll.tsx).
 *
 * The authoritative signal for "should I follow the bottom" is NOT a pixel
 * proximity threshold recomputed on every scroll event — that re-enables
 * following whenever the user lingers near the bottom and lets layout-driven
 * resizes (e.g. content-visibility resolving off-screen heights) yank the view
 * back down. Instead:
 *
 *   - `userScrolled` is a sticky flag set the moment the user scrolls up and
 *     cleared only when they return to the bottom. User intent wins.
 *   - Auto-follow runs only while working. Idle restores native overflow
 *     anchoring, preserving position without a guessed settle window.
 *   - `markAuto`/`isAuto` tag our own programmatic scrolls so the scroll handler
 *     doesn't mistake them for the user scrolling away.
 *
 * `working` is the authoritative run status from the caller (session busy/retry
 * vs idle), not a guess.
 */

const BOTTOM_THRESHOLD = 10;
const AUTO_MARK_MS = 1500;

export const distanceFromBottom = (el: HTMLElement): number =>
  el.scrollHeight - el.clientHeight - el.scrollTop;

const canScroll = (el: HTMLElement): boolean => el.scrollHeight - el.clientHeight > 1;

export function shouldShowScrollToLatest(distance: number, viewportHeight: number): boolean {
  return viewportHeight > 0 && distance > viewportHeight;
}

export const shouldAutoFollow = (working: boolean, userScrolled: boolean): boolean =>
  working && !userScrolled;

export const shouldPinOnEnd = (
  wasWorking: boolean,
  working: boolean,
  userScrolled: boolean,
): boolean => wasWorking && !working && !userScrolled;

export type AutoScroll = {
  /** Callback ref for the scroll container. */
  scrollRef: (el: HTMLDivElement | null) => void;
  /** Callback ref for the content element whose growth should pin the bottom. */
  contentRef: (el: HTMLElement | null) => void;
  /** Wire to the container's onScroll. */
  handleScroll: () => void;
  /** Follow new content only when auto-follow is currently active. */
  scrollToBottom: () => void;
  /** Force back to following the bottom (new prompt, session switch). */
  resume: () => void;
  /** The user is more than one viewport away from the latest content. */
  showScrollToLatest: boolean;
  /** User-requested return to the latest content. */
  scrollToLatest: () => void;
};

export function useAutoScroll(working: boolean): AutoScroll {
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLElement | null>(null);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);

  const userScrolledRef = useRef(false);
  const autoRef = useRef<{ smooth: boolean; top: number; time: number } | undefined>(undefined);
  const autoTimerRef = useRef<number | undefined>(undefined);
  const workingRef = useRef(working);
  const wasWorkingRef = useRef(working);
  workingRef.current = working;

  const active = useCallback(
    (): boolean => shouldAutoFollow(workingRef.current, userScrolledRef.current),
    [],
  );

  const updateOverflowAnchor = useCallback(
    (el: HTMLElement): void => {
      el.style.overflowAnchor = active() ? "none" : "auto";
    },
    [active],
  );

  const updateScrollToLatestVisibility = useCallback((el: HTMLElement | null): void => {
    setShowScrollToLatest(
      el ? shouldShowScrollToLatest(distanceFromBottom(el), el.clientHeight) : false,
    );
  }, []);

  const setScrollRef = useCallback(
    (el: HTMLDivElement | null): void => {
      setScrollEl(el);
      if (el) updateOverflowAnchor(el);
      updateScrollToLatestVisibility(el);
    },
    [updateOverflowAnchor, updateScrollToLatestVisibility],
  );

  const markAuto = useCallback((el: HTMLElement, smooth: boolean): void => {
    autoRef.current = {
      smooth,
      top: Math.max(0, el.scrollHeight - el.clientHeight),
      time: Date.now(),
    };
    window.clearTimeout(autoTimerRef.current);
    autoTimerRef.current = window.setTimeout(() => {
      autoRef.current = undefined;
    }, AUTO_MARK_MS);
  }, []);

  const isAuto = useCallback((el: HTMLElement): boolean => {
    const a = autoRef.current;
    if (!a) {
      return false;
    }
    if (Date.now() - a.time > AUTO_MARK_MS) {
      autoRef.current = undefined;
      return false;
    }
    if (a.smooth) {
      return true;
    }
    return Math.abs(el.scrollTop - a.top) < 2;
  }, []);

  const scrollToBottom = useCallback(
    (force: boolean, behavior: ScrollBehavior = "auto"): void => {
      const el = scrollEl;
      if (!el) {
        return;
      }
      if (force && userScrolledRef.current) {
        userScrolledRef.current = false;
        updateOverflowAnchor(el);
      }
      if (force) {
        setShowScrollToLatest(false);
      }
      if (!force && !active()) {
        return;
      }
      markAuto(el, behavior === "smooth");
      if (distanceFromBottom(el) >= 2) {
        if (behavior === "smooth") {
          el.scrollTo({ top: el.scrollHeight, behavior });
        } else {
          // Direct scrollTop assignment bypasses any CSS smooth-scroll, so
          // following content stays glued to the bottom without catch-up jank.
          el.scrollTop = el.scrollHeight;
        }
      }
      if (behavior !== "smooth") {
        updateScrollToLatestVisibility(el);
      }
    },
    [scrollEl, active, markAuto, updateOverflowAnchor, updateScrollToLatestVisibility],
  );

  const stop = useCallback((): void => {
    const el = scrollEl;
    updateScrollToLatestVisibility(el);
    if (!el || !canScroll(el)) {
      if (userScrolledRef.current && el) {
        userScrolledRef.current = false;
        updateOverflowAnchor(el);
      }
      return;
    }
    if (userScrolledRef.current) {
      return;
    }
    userScrolledRef.current = true;
    updateOverflowAnchor(el);
  }, [scrollEl, updateOverflowAnchor, updateScrollToLatestVisibility]);

  const handleScroll = useCallback((): void => {
    const el = scrollEl;
    if (!el) {
      return;
    }
    if (!canScroll(el)) {
      setShowScrollToLatest(false);
      if (userScrolledRef.current) {
        userScrolledRef.current = false;
        updateOverflowAnchor(el);
      }
      return;
    }
    // Our own scrollToBottom fired this event — don't treat it as the user
    // leaving the bottom. Smooth return-to-latest emits intermediate positions,
    // so keep the affordance hidden until that programmatic scroll settles.
    if (!userScrolledRef.current && isAuto(el)) {
      setShowScrollToLatest(false);
      if (!autoRef.current?.smooth) {
        scrollToBottom(false);
      }
      return;
    }
    const distance = distanceFromBottom(el);
    setShowScrollToLatest(shouldShowScrollToLatest(distance, el.clientHeight));
    if (distance < BOTTOM_THRESHOLD) {
      if (userScrolledRef.current) {
        userScrolledRef.current = false;
        updateOverflowAnchor(el);
      }
      return;
    }
    stop();
  }, [scrollEl, isAuto, scrollToBottom, stop, updateOverflowAnchor]);

  const follow = useCallback((): void => {
    scrollToBottom(false);
  }, [scrollToBottom]);

  const resume = useCallback((): void => {
    scrollToBottom(true);
  }, [scrollToBottom]);

  const scrollToLatest = useCallback((): void => {
    scrollToBottom(true);
  }, [scrollToBottom]);

  // Wheel-up is the authoritative "user wants to read history" signal. Scrolling
  // inside a nested scroll region (tool output, code block) opts out via
  // [data-scrollable] so it doesn't drop follow-bottom.
  useEffect(() => {
    if (!scrollEl) {
      return;
    }
    const onWheel = (e: WheelEvent): void => {
      if (e.deltaY >= 0) {
        return;
      }
      const target = e.target instanceof Element ? e.target : undefined;
      const nested = target?.closest("[data-scrollable]");
      if (nested && nested !== scrollEl) {
        return;
      }
      stop();
    };
    scrollEl.addEventListener("wheel", onWheel, { passive: true });
    return () => scrollEl.removeEventListener("wheel", onWheel);
  }, [scrollEl, stop]);

  // Content growth pins the bottom only while the run is authoritatively live.
  useEffect(() => {
    if (!contentEl) {
      return;
    }
    const observer = new ResizeObserver(() => {
      const el = scrollEl;
      if (!el || !active()) {
        return;
      }
      updateScrollToLatestVisibility(el);
      if (!canScroll(el)) {
        return;
      }
      scrollToBottom(false);
    });
    observer.observe(contentEl);
    if (scrollEl) {
      observer.observe(scrollEl);
    }
    return () => observer.disconnect();
  }, [contentEl, scrollEl, active, scrollToBottom, updateScrollToLatestVisibility]);

  // Correct the authoritative run boundary before WorkFold's resize is painted.
  useLayoutEffect(() => {
    const wasWorking = wasWorkingRef.current;
    wasWorkingRef.current = working;
    if (scrollEl) updateOverflowAnchor(scrollEl);
    if (shouldPinOnEnd(wasWorking, working, userScrolledRef.current)) {
      scrollToBottom(true);
    } else if (working) {
      scrollToBottom(false);
    }
  }, [working, scrollEl, scrollToBottom, updateOverflowAnchor]);

  useEffect(
    () => () => {
      window.clearTimeout(autoTimerRef.current);
    },
    [],
  );

  return {
    scrollRef: setScrollRef,
    contentRef: setContentEl,
    handleScroll,
    scrollToBottom: follow,
    resume,
    showScrollToLatest,
    scrollToLatest,
  };
}
