import { AnimatePresence, m, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type CollapsibleMotionPreset = "default" | "compact" | "timeline";

const COLLAPSIBLE_MOTION = {
  compact: 0.18,
  default: 0.2,
  timeline: 0.22,
} satisfies Record<CollapsibleMotionPreset, number>;

const COLLAPSIBLE_EASE = [0.22, 1, 0.36, 1] as const;

export function CollapsibleMotion({
  children,
  className,
  id,
  open,
  preset = "default",
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  open: boolean;
  preset?: CollapsibleMotionPreset;
}) {
  const reduceMotion = useReducedMotion();
  const duration = reduceMotion ? 0 : COLLAPSIBLE_MOTION[preset];

  return (
    <m.div
      className={cn("relative overflow-hidden", className)}
      data-collapsible-motion
      id={id}
      layout={reduceMotion ? false : "size"}
      layoutDependency={open}
      style={{ transformOrigin: "top" }}
      transition={{ layout: { duration, ease: COLLAPSIBLE_EASE } }}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {open ? (
          <m.div
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            initial={{ opacity: 0, y: -4 }}
            layout={reduceMotion ? false : "position"}
            layoutDependency={open}
            transition={{ duration, ease: "easeOut" }}
          >
            {children}
          </m.div>
        ) : null}
      </AnimatePresence>
    </m.div>
  );
}
