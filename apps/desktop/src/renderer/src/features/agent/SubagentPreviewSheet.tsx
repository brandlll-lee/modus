import { IconArrowLeft, IconArrowsMaximize, IconX } from "@tabler/icons-react";
import { m } from "motion/react";
import { type ReactNode, useEffect, useState } from "react";
import { ToolbarButton, TOOLBAR_ICON } from "../../components/ui/ToolbarButton";
import { cn } from "../../lib/cn";

const PANEL_TRANSITION = { duration: 0.19, ease: [0.22, 1, 0.36, 1] } as const;

/**
 * Subagent preview sheet, scoped to the timeline area of its host pane so the
 * composer below stays sharp and usable. Chrome only — children supply the
 * reused ChatPane (no import cycle).
 *
 * Body visibility follows `open` (authoritative). Gating on motion's
 * `onAnimationComplete` left the chrome up and the body empty forever whenever
 * that callback missed (already-at-target animate, interrupted exit, reduced
 * motion). Close still drops the body immediately so the exit tween is cheap.
 *
 * Presence is self-managed rather than AnimatePresence, which would keep a
 * cached exit copy (and its body) mounted for the whole tween.
 */
export function SubagentPreviewSheet({
  open,
  title,
  onExpand,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onExpand(): void;
  onClose(): void;
  children: ReactNode;
}) {
  const [present, setPresent] = useState(false);
  const [scrimIn, setScrimIn] = useState(false);

  useEffect(() => {
    if (open) {
      setPresent(true);
      const id = window.requestAnimationFrame(() => setScrimIn(true));
      return () => window.cancelAnimationFrame(id);
    }
    setScrimIn(false);
    // Fallback when motion skips onAnimationComplete (already-at-target / reduced motion).
    const id = window.setTimeout(() => setPresent(false), Math.ceil(PANEL_TRANSITION.duration * 1000) + 50);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!present) {
    return null;
  }

  return (
    <div className={cn("absolute inset-0 z-40", open ? undefined : "pointer-events-none")}>
      <div
        className="subagent-preview-scrim absolute inset-0"
        data-mounted={scrimIn ? "" : undefined}
        data-settled={open ? "" : undefined}
        onClick={onClose}
        role="presentation"
      />
      <m.div
        animate={open ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
        aria-hidden={open ? undefined : true}
        className="absolute inset-x-4 top-9 bottom-1 z-10 mx-auto flex max-w-5xl flex-col overflow-hidden popup-chrome bg-elevated"
        initial={{ opacity: 0, y: 12 }}
        onAnimationComplete={() => {
          if (!open) setPresent(false);
        }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        transition={PANEL_TRANSITION}
      >
        <div className="flex h-11 shrink-0 items-center justify-between gap-1 border-hairline border-b px-2">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <ToolbarButton label="Close preview" onClick={onClose}>
              <IconArrowLeft size={TOOLBAR_ICON.size} stroke={TOOLBAR_ICON.stroke} />
            </ToolbarButton>
            <div className="min-w-0 flex-1 truncate px-1 font-medium text-fg text-sm">{title}</div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <ToolbarButton label="Open in inspector" onClick={onExpand}>
              <IconArrowsMaximize size={TOOLBAR_ICON.size} stroke={TOOLBAR_ICON.stroke} />
            </ToolbarButton>
            <ToolbarButton label="Close preview" onClick={onClose}>
              <IconX size={TOOLBAR_ICON.size} stroke={TOOLBAR_ICON.stroke} />
            </ToolbarButton>
          </div>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {open ? (
            <div className="subagent-preview-body flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
          ) : null}
        </div>
      </m.div>
    </div>
  );
}
