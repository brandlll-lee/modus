import { describe, expect, it, vi } from "vitest";
import { createStartupTimeline } from "./startup-timeline";

describe("createStartupTimeline", () => {
  it("records each lifecycle milestone once with its authoritative process clock", () => {
    const clock = vi.fn().mockReturnValueOnce(12).mockReturnValueOnce(34).mockReturnValueOnce(56);
    const log = vi.fn();
    const timeline = createStartupTimeline({ clock, enabled: true, log });

    timeline.mark("main.entry");
    timeline.mark("main.window-created");
    timeline.mark("renderer.first-commit", 21);
    timeline.mark("renderer.first-commit", 22);

    expect(timeline.timings()).toEqual([
      { milestone: "main.entry", processElapsedMs: 12 },
      { milestone: "main.window-created", processElapsedMs: 34 },
      { milestone: "renderer.first-commit", processElapsedMs: 56, rendererElapsedMs: 21 },
    ]);
    expect(log).toHaveBeenCalledTimes(3);
  });
});
