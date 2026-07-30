import { describe, expect, it } from "vitest";
import { formatWaitHeadline, formatWaitedDuration } from "./wait-tools";

describe("formatWaitHeadline", () => {
  it("names a single subagent and duration from result facts", () => {
    expect(
      formatWaitHeadline({
        waitedMs: 12_000,
        timedOut: false,
        subagents: [{}],
        terminals: [],
      }),
    ).toBe("Waited 12s for subagent");
  });

  it("pluralizes subagents and terminals from counts", () => {
    expect(
      formatWaitHeadline({
        waitedMs: 65_000,
        timedOut: false,
        subagents: [{}, {}],
        terminals: [{}],
      }),
    ).toBe("Waited 1m 5s for 2 subagents, 1 terminal");
  });

  it("marks timeout without losing the subject", () => {
    expect(
      formatWaitHeadline({
        waitedMs: 120_000,
        timedOut: true,
        subagents: [{}, {}, {}],
        terminals: [],
      }),
    ).toBe("Waited 2m for 3 subagents (timed out)");
  });

  it("omits subject when nothing was watched", () => {
    expect(
      formatWaitHeadline({
        waitedMs: 0,
        timedOut: false,
        subagents: [],
        terminals: [],
      }),
    ).toBe(`Waited ${formatWaitedDuration(0)}`);
  });
});
