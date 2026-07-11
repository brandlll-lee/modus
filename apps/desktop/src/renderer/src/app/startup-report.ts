import type { StartupRendererMilestone } from "../../../shared/startup";

/** Reports renderer-owned milestones against the main process startup clock. */
export function reportRendererStartup(milestone: StartupRendererMilestone): void {
  if (!window.modus) {
    return;
  }

  void window.modus.app
    .startupMetric({ milestone, rendererElapsedMs: performance.now() })
    .catch((error: unknown) => {
      console.warn("Unable to report renderer startup milestone.", error);
    });
}
