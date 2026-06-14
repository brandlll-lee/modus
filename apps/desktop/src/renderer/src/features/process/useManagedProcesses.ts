import { useEffect, useRef, useState } from "react";
import type { ManagedProcessInfo, ManagedProcessOrigin } from "../../../../shared/contracts";

/**
 * Live, session-scoped view of the unified managed-process model — the single
 * data source shared by the composer running-process bar and the right-panel
 * terminal grouping. It re-fetches the scoped snapshot from the main process on:
 *   - mount / scope change,
 *   - the coarse `process:changed` signal (a process was created/exited/killed),
 *   - a slow safety poll (catches a process that self-exits with no event, e.g.
 *     a GUI app the user closes from its own window).
 *
 * Per-session isolation lives entirely in the scope passed here: the main
 * process filters by `(workspaceId, sessionId)`, so switching session or project
 * simply re-fetches a different (often empty) list. The `nowMs` ticker re-renders
 * once a second so callers can render a live elapsed timer off `startedAt`.
 */

/** Safety poll cadence to catch self-exits that emit no change signal. */
const POLL_INTERVAL_MS = 3_000;
/** Elapsed-timer re-render cadence. */
const TICK_INTERVAL_MS = 1_000;

export type ManagedProcessScope = {
  workspaceId?: string | undefined;
  sessionId?: string | undefined;
  /** Restrict to a single origin (e.g. the composer bar wants agent-owned). */
  origin?: ManagedProcessOrigin | undefined;
};

export type UseManagedProcesses = {
  processes: ManagedProcessInfo[];
  /** `Date.now()` snapshot that advances each second, for elapsed display. */
  nowMs: number;
  /** Terminate a managed process by id (optimism deferred to the change event). */
  kill: (id: string) => void;
};

export function useManagedProcesses(scope: ManagedProcessScope): UseManagedProcesses {
  const [processes, setProcesses] = useState<ManagedProcessInfo[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  // biome-ignore lint/correctness/useExhaustiveDependencies: scopeRef is read inside refresh so the latest scope is always used; the deps re-subscribe when the scope actually changes (session/project switch).
  useEffect(() => {
    let cancelled = false;
    const refresh = (): void => {
      const current = scopeRef.current;
      void window.modus.process
        .list({
          ...(current.workspaceId !== undefined ? { workspaceId: current.workspaceId } : {}),
          ...(current.sessionId !== undefined ? { sessionId: current.sessionId } : {}),
          ...(current.origin !== undefined ? { origin: current.origin } : {}),
        })
        .then((list: ManagedProcessInfo[]) => {
          if (!cancelled) {
            setProcesses(list);
          }
        });
    };

    refresh();
    const unsubscribe = window.modus.process.onChanged(refresh);
    const poll = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(poll);
    };
  }, [scope.workspaceId, scope.sessionId, scope.origin]);

  useEffect(() => {
    const tick = window.setInterval(() => setNowMs(Date.now()), TICK_INTERVAL_MS);
    return () => window.clearInterval(tick);
  }, []);

  const kill = (id: string): void => {
    void window.modus.process.kill(id);
  };

  return { processes, nowMs, kill };
}
