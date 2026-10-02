import { IconChevronRight } from "@tabler/icons-react";
import { m } from "motion/react";
import type { ReactNode } from "react";
import { ShinyText } from "../../components/ui/ShinyText";

export function ActivityHeader({
  active = false,
  controlsId,
  label,
  onToggle,
  open,
  icon,
}: {
  active?: boolean;
  controlsId?: string;
  label: string;
  onToggle(): void;
  open: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      aria-controls={controlsId}
      aria-expanded={open}
      className="group/activity flex min-w-0 max-w-full items-center gap-1.5 rounded-md py-0.5 text-left text-sm font-medium text-fg-subtle transition-colors hover:text-fg-muted"
      onClick={onToggle}
      type="button"
    >
      {icon ? <span className="action-icon">{icon}</span> : null}
      {active ? (
        <ShinyText className="min-w-0 truncate">{label}</ShinyText>
      ) : (
        <span className="min-w-0 truncate text-fg-subtle">{label}</span>
      )}
      <m.span
        animate={{ rotate: open ? 90 : 0 }}
        className="flex size-4 shrink-0 items-center justify-center text-fg-faint"
        transition={{ duration: 0.16, ease: "easeOut" }}
      >
        <IconChevronRight aria-hidden size={12} stroke={1.8} />
      </m.span>
    </button>
  );
}
