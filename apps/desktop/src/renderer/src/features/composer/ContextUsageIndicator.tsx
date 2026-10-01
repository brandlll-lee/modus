import { Popover } from "@base-ui/react/popover";
import type { ContextUsageInfo } from "../../../../shared/contracts";
import { ContextUsageRing, contextUsagePercent, formatUsagePercent } from "../../lib/contextUsage";

export function ContextUsageIndicator({
  contextWindow,
  usage,
}: {
  contextWindow?: number;
  usage?: ContextUsageInfo;
}) {
  const percent = contextUsagePercent(usage);
  const label = percent === undefined ? "not available yet" : `${Math.round(percent)}%`;

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`Context usage ${label}`}
        className="app-no-drag flex h-[26px] w-[26px] items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg data-popup-open:bg-hover data-popup-open:text-fg"
      >
        <ContextUsageRing percent={percent} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" side="top" sideOffset={8}>
          <Popover.Popup className="origin-(--transform-origin) popup-chrome max-w-[calc(100vw-32px)] p-3 transition-[transform,opacity] duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0">
            <ContextUsageTooltip
              {...(contextWindow ? { contextWindow } : {})}
              {...(usage ? { usage } : {})}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ContextUsageTooltip({
  contextWindow,
  usage,
}: {
  contextWindow?: number;
  usage?: ContextUsageInfo;
}) {
  const total = contextUsagePercent(usage);
  const usageWindow = usage?.contextWindow ?? contextWindow;
  const tokenLine =
    usage?.tokens !== null && usage?.tokens !== undefined && usageWindow
      ? `${usage.tokens.toLocaleString()} / ${usageWindow.toLocaleString()} tokens`
      : undefined;

  return (
    <div className="w-[260px] max-w-full text-sm text-fg tabular-nums">
      <Popover.Title className="mb-2 font-medium">Context usage</Popover.Title>
      <ContextUsageRow label="Current context" value={formatUsagePercent(total)} />
      <div className="mt-1 text-xs text-fg-subtle">
        {tokenLine ??
          (usageWindow ? `Not measured / ${usageWindow.toLocaleString()} tokens` : "Not measured")}
      </div>
      <div className="mt-3 border-t border-hairline pt-3">
        <div className="mb-1 text-xs text-fg-subtle">Session totals</div>
        <ContextUsageRow label="Input" value={usage?.totals?.input.toLocaleString() ?? "—"} />
        <ContextUsageRow label="Output" value={usage?.totals?.output.toLocaleString() ?? "—"} />
        <ContextUsageRow
          label="Cache read (R)"
          value={usage?.totals?.cacheRead.toLocaleString() ?? "—"}
        />
        <ContextUsageRow
          label="Cache write (W)"
          value={usage?.totals?.cacheWrite.toLocaleString() ?? "—"}
        />
        <ContextUsageRow
          label="Cost"
          value={usage?.totals ? `$${usage.totals.cost.toFixed(3)}` : "—"}
        />
      </div>
    </div>
  );
}

function ContextUsageRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6 py-1">
      <span className="text-fg-muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}
