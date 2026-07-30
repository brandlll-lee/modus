import type { ContextUsageInfo } from "../../../shared/contracts";
import { cn } from "./cn";

/** Clamp a percent into 0–100; non-finite → 0. */
export function clampPercent(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

/**
 * Authoritative context fill: prefer `usage.percent`, else tokens/window.
 * Shared by Composer ring and Session Title chrome — one formula, one truth.
 */
export function contextUsagePercent(usage: ContextUsageInfo | undefined): number | undefined {
  if (!usage) {
    return undefined;
  }
  if (typeof usage.percent === "number" && Number.isFinite(usage.percent)) {
    return clampPercent(usage.percent);
  }
  if (
    typeof usage.tokens === "number" &&
    Number.isFinite(usage.tokens) &&
    usage.contextWindow > 0
  ) {
    return clampPercent((usage.tokens / usage.contextWindow) * 100);
  }
  return undefined;
}

export function formatUsagePercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }
  return `${Math.round(value)}%`;
}

/** Compact donut used in Composer and Session Title popover. */
export function ContextUsageRing({ percent }: { percent: number | undefined }) {
  const strokeWidth = 1.8;
  const center = 8;
  const radius = center - strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;
  const known = percent !== undefined;
  const offset = circumference * (1 - clampPercent(percent ?? 0) / 100);

  return (
    <svg
      aria-hidden="true"
      className="-rotate-90 shrink-0"
      fill="none"
      height="15"
      viewBox="0 0 16 16"
      width="15"
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        stroke="var(--color-hairline-strong)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={center}
        cy={center}
        r={radius}
        stroke="currentColor"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeWidth={strokeWidth}
        className={cn(
          "transition-[stroke-dashoffset] duration-300 ease-out",
          !known && "opacity-0",
        )}
      />
    </svg>
  );
}
