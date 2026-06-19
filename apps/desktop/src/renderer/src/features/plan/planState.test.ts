import { describe, expect, it } from "vitest";
import type { PlanRef } from "../../../../shared/contracts";
import { buildPlanMessage, effectiveBuildStatus, normalizePlan } from "./planState";

/** A complete, current-shape plan. */
const plan: PlanRef = {
  id: "ws:feat",
  slug: "feat",
  title: "Feat",
  overview: "Build it.",
  path: "/p/plan.md",
  hash: "h",
  workspaceId: "ws",
  content: "# Feat",
  todos: [{ id: "t-0", content: "step", status: "pending" }],
  buildStatus: "not_built",
  createdAt: "now",
  updatedAt: "now",
  savedToWorkspace: false,
};

describe("normalizePlan", () => {
  it("returns the same reference for an already-complete plan", () => {
    expect(normalizePlan(plan)).toBe(plan);
  });

  it("fills fields missing on plans recorded before the feature existed", () => {
    // A pre-feature plan.updated payload: no todos/overview/buildStatus. Reading
    // plan.todos here used to crash <PlanPanel> (Cannot read 'filter' of undefined).
    const legacy = {
      ...plan,
      overview: undefined,
      todos: undefined,
      buildStatus: undefined,
    } as unknown as PlanRef;
    expect(normalizePlan(legacy)).toMatchObject({
      overview: "",
      todos: [],
      buildStatus: "not_built",
    });
  });
});

describe("buildPlanMessage", () => {
  it("references the plan file + lists numbered to-dos, without pasting the body", () => {
    const message = buildPlanMessage({
      ...plan,
      title: "My Feature",
      path: "/p/plan.md",
      content: "# huge body that must NOT be inlined",
      todos: [
        { id: "a", content: "Scaffold", status: "pending" },
        { id: "b", content: "Wire it up", status: "pending" },
      ],
    });
    expect(message).toContain('"My Feature"');
    expect(message).toContain("/p/plan.md");
    expect(message).toContain("1. Scaffold");
    expect(message).toContain("2. Wire it up");
    // The full markdown body is never pasted into the build message.
    expect(message).not.toContain("huge body");
  });
});

describe("effectiveBuildStatus", () => {
  it("keeps building while the session is working", () => {
    expect(effectiveBuildStatus({ ...plan, buildStatus: "building" }, true)).toBe("building");
  });

  it("treats a stale building (session idle) as not_built so it can be rebuilt", () => {
    expect(effectiveBuildStatus({ ...plan, buildStatus: "building" }, false)).toBe("not_built");
  });

  it("passes through built and not_built unchanged", () => {
    expect(effectiveBuildStatus({ ...plan, buildStatus: "built" }, false)).toBe("built");
    expect(effectiveBuildStatus(plan, false)).toBe("not_built");
  });
});
