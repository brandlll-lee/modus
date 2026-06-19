import { IconLoader2 } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { SessionRunStatus } from "../../../../shared/contracts";

/**
 * Single non-fatal line shown while the runtime auto-retries a transient
 * failure (timeout, overloaded provider, dropped connection). Ported from
 * opencode's `SessionRetry`: a spinner plus "retrying · in Ns · attempt N/M",
 * with a live countdown to the next attempt. Deliberately NOT red — the turn is
 * still working, so this reads as a status, not an error. Truncates long
 * provider messages, keeping the full text in the tooltip.
 *
 * Fatal errors (retries exhausted, non-retryable failures) are surfaced
 * elsewhere as a red `run.failed` / `runtime.error`, never here.
 */
export function RetryStatusBar({
  status,
}: {
  status: Extract<SessionRunStatus, { type: "retry" }>;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.round((status.nextAt - now) / 1000));
  const countdown = seconds > 0 ? `in ${seconds}s` : "";
  const info = [countdown, `attempt ${status.attempt}/${status.maxAttempts}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mb-2 flex items-start gap-2 rounded-md border border-hairline bg-chip/40 px-3 py-2 text-xs text-fg-muted">
      <IconLoader2 className="mt-0.5 shrink-0 animate-spin text-fg-subtle" size={14} stroke={2} />
      <div className="min-w-0">
        <span className="truncate" title={status.message}>
          {status.message}
        </span>
        <span className="ml-2 text-fg-faint">retrying{info ? ` · ${info}` : ""}</span>
      </div>
    </div>
  );
}
