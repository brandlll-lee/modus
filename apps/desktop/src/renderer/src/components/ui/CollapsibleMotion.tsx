import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef } from "react";
import { cn } from "../../lib/cn";

type CollapsibleMotionPreset = "default" | "compact" | "timeline";
type CollapsibleMotionState = "opening" | "closing";

type CollapsibleMotionContextValue = {
  notifyLayoutAnimationStart(durationMs: number, state: CollapsibleMotionState): void;
};

const CollapsibleMotionContext = createContext<CollapsibleMotionContextValue>({
  notifyLayoutAnimationStart: () => {},
});

const COLLAPSIBLE_MOTION = {
  compact: {
    heightDuration: 0.24,
    opacityDuration: 0.18,
    scrollPauseMs: 320,
  },
  default: {
    heightDuration: 0.3,
    opacityDuration: 0.2,
    scrollPauseMs: 400,
  },
  timeline: {
    heightDuration: 0.34,
    opacityDuration: 0.22,
    scrollPauseMs: 460,
  },
} satisfies Record<
  CollapsibleMotionPreset,
  { heightDuration: number; opacityDuration: number; scrollPauseMs: number }
>;

const COLLAPSIBLE_EASE = [0.22, 1, 0.36, 1] as const;

export function CollapsibleMotionProvider({
  children,
  onLayoutAnimationStart,
}: {
  children: ReactNode;
  onLayoutAnimationStart?(durationMs: number, state: CollapsibleMotionState): void;
}) {
  const value = useMemo<CollapsibleMotionContextValue>(
    () => ({
      notifyLayoutAnimationStart(durationMs, state) {
        onLayoutAnimationStart?.(durationMs, state);
      },
    }),
    [onLayoutAnimationStart],
  );

  return (
    <CollapsibleMotionContext.Provider value={value}>{children}</CollapsibleMotionContext.Provider>
  );
}

export function CollapsibleMotion({
  children,
  className,
  open,
  preset = "default",
}: {
  children: ReactNode;
  className?: string;
  open: boolean;
  preset?: CollapsibleMotionPreset;
}) {
  const reduceMotion = useReducedMotion();
  const firstRenderRef = useRef(true);
  const { notifyLayoutAnimationStart } = useContext(CollapsibleMotionContext);
  const config = COLLAPSIBLE_MOTION[preset];

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    notifyLayoutAnimationStart(config.scrollPauseMs, open ? "opening" : "closing");
  }, [config.scrollPauseMs, notifyLayoutAnimationStart, open]);

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <m.div
          animate={{ height: "auto", opacity: 1 }}
          className={cn("overflow-hidden", className)}
          data-collapsible-motion
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          style={{ transformOrigin: "top" }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : {
                  height: { duration: config.heightDuration, ease: COLLAPSIBLE_EASE },
                  opacity: { duration: config.opacityDuration, ease: "easeOut" },
                }
          }
        >
          {children}
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}
