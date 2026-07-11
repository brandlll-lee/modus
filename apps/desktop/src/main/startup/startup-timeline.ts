import type { StartupMilestone } from "../../shared/startup";

export type StartupTiming = {
  milestone: StartupMilestone;
  processElapsedMs: number;
  rendererElapsedMs?: number | undefined;
};

type StartupClock = () => number;

type StartupTimelineOptions = {
  clock?: StartupClock | undefined;
  enabled?: boolean | undefined;
  log?: ((message: string) => void) | undefined;
};

export type StartupTimeline = {
  mark(milestone: StartupMilestone, rendererElapsedMs?: number): void;
  timings(): readonly StartupTiming[];
};

function defaultClock(): number {
  return process.uptime() * 1_000;
}

function formatTiming(timing: StartupTiming): string {
  const renderer =
    timing.rendererElapsedMs === undefined
      ? ""
      : ` renderer=${Math.round(timing.rendererElapsedMs)}ms`;
  return `[startup] ${timing.milestone} process=${Math.round(timing.processElapsedMs)}ms${renderer}`;
}

/**
 * Records one authoritative event for each startup lifecycle milestone. The
 * process clock is injected so tests can validate event ordering without time
 * thresholds or wall-clock assumptions.
 */
export function createStartupTimeline({
  clock = defaultClock,
  enabled = Boolean(process.env.ELECTRON_RENDERER_URL || process.env.MODUS_STARTUP_METRICS),
  log = console.info,
}: StartupTimelineOptions = {}): StartupTimeline {
  const recorded = new Set<StartupMilestone>();
  const timings: StartupTiming[] = [];

  return {
    mark(milestone, rendererElapsedMs) {
      if (recorded.has(milestone)) {
        return;
      }

      recorded.add(milestone);
      const timing = {
        milestone,
        processElapsedMs: clock(),
        ...(rendererElapsedMs === undefined ? {} : { rendererElapsedMs }),
      } satisfies StartupTiming;
      timings.push(timing);

      if (enabled) {
        log(formatTiming(timing));
      }
    },
    timings() {
      return timings;
    },
  };
}
