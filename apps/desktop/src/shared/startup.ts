export const STARTUP_RENDERER_MILESTONES = [
  "renderer.first-commit",
  "renderer.initial-hydration-settled",
] as const;

export type StartupRendererMilestone = (typeof STARTUP_RENDERER_MILESTONES)[number];

export type StartupMilestone =
  | "main.entry"
  | "main.electron-ready"
  | "main.window-created"
  | "main.dom-ready"
  | "main.ready-to-show"
  | StartupRendererMilestone;

export type StartupMetricInput = {
  milestone: StartupRendererMilestone;
  rendererElapsedMs: number;
};
