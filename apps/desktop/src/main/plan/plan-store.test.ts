import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hashContent,
  readPlan,
  readPlanById,
  saveToWorkspace,
  setPlanBuildStatusById,
  slugify,
  writePlan,
} from "./plan-store";

let root: string;
let repo: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "modus-plan-root-"));
  repo = mkdtempSync(join(tmpdir(), "modus-plan-repo-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

/** A complete writePlan input with sensible defaults the test can override. */
function write(overrides: Partial<Parameters<typeof writePlan>[1]> = {}) {
  return writePlan(root, {
    workspaceId: "ws-1",
    slug: "feat",
    title: "Feat",
    overview: "Build the thing.",
    content: "# Feat\n## Goal\nDo a thing.\n",
    todos: [{ content: "Scaffold the project" }, { content: "Wire it up" }],
    ...overrides,
  });
}

describe("slugify", () => {
  it("produces a filesystem-safe kebab slug and never empty", () => {
    expect(slugify("SleepNode MVP 计划")).toBe("sleepnode-mvp-计划");
    expect(slugify("  Add JWT / Redis auth!  ")).toBe("add-jwt-redis-auth");
    expect(slugify("***")).toBe("plan");
  });
});

describe("writePlan / readPlan", () => {
  it("writes plan.md and round-trips the reference with structured fields", () => {
    const plan = write({ slug: slugify("My Feature"), title: "My Feature", sessionId: "s-1" });
    expect(plan.path.endsWith("plan.md")).toBe(true);
    expect(readFileSync(plan.path, "utf8")).toContain("## Goal");
    expect(plan.hash).toBe(hashContent(plan.content));
    expect(plan.overview).toBe("Build the thing.");
    expect(plan.buildStatus).toBe("not_built");
    expect(plan.savedToWorkspace).toBe(false);

    const read = readPlan(root, "ws-1", plan.slug);
    expect(read?.content).toBe(plan.content);
    expect(read?.id).toBe(plan.id);
    expect(read?.overview).toBe("Build the thing.");
  });

  it("derives stable, unique todo ids from content + index, all pending", () => {
    const plan = write({
      todos: [{ content: "Same step" }, { content: "Same step" }, { content: "Other step" }],
    });
    expect(plan.todos.map((todo) => todo.status)).toEqual(["pending", "pending", "pending"]);
    const ids = plan.todos.map((todo) => todo.id);
    expect(new Set(ids).size).toBe(3); // unique even when content repeats
    expect(plan.todos[2]?.content).toBe("Other step");
  });

  it("updates the same file on repeated writes for one slug (no forking)", () => {
    const first = write({ content: "v1" });
    const second = write({ content: "v2 updated" });
    expect(second.path).toBe(first.path);
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(readPlan(root, "ws-1", "feat")?.content).toBe("v2 updated");
  });

  it("resets buildStatus to not_built on every (re)write, so an edited plan re-opens for review", () => {
    const plan = write();
    setPlanBuildStatusById(root, plan.id, "built");
    expect(readPlan(root, "ws-1", "feat")?.buildStatus).toBe("built");
    // Editing the plan must drop it back to not_built.
    const rewritten = write({ content: "edited" });
    expect(rewritten.buildStatus).toBe("not_built");
  });

  it("returns undefined for a missing plan", () => {
    expect(readPlan(root, "ws-1", "nope")).toBeUndefined();
  });
});

describe("build status transitions", () => {
  it("transitions through building → built and is readable by id", () => {
    const plan = write();
    expect(setPlanBuildStatusById(root, plan.id, "building")?.buildStatus).toBe("building");
    expect(setPlanBuildStatusById(root, plan.id, "built")?.buildStatus).toBe("built");
    expect(readPlanById(root, plan.id)?.buildStatus).toBe("built");
  });

  it("reverts to not_built", () => {
    const plan = write();
    expect(setPlanBuildStatusById(root, plan.id, "building")?.buildStatus).toBe("building");
    expect(setPlanBuildStatusById(root, plan.id, "not_built")?.buildStatus).toBe("not_built");
  });

  it("returns undefined for a malformed id or missing plan", () => {
    expect(setPlanBuildStatusById(root, "ws-1:nope", "built")).toBeUndefined();
    expect(setPlanBuildStatusById(root, "malformed-id", "built")).toBeUndefined();
    expect(readPlanById(root, "malformed-id")).toBeUndefined();
  });
});

describe("saveToWorkspace", () => {
  it("copies the plan into <repo>/.modus/specs/<slug>/ and flips the flag", () => {
    const plan = write({ content: "# Feat\n" });
    const target = saveToWorkspace(root, plan, repo);
    expect(target).toBe(join(repo, ".modus", "specs", "feat", "plan.md"));
    expect(readFileSync(target, "utf8")).toBe("# Feat\n");
    expect(readPlan(root, "ws-1", "feat")?.savedToWorkspace).toBe(true);
  });
});
