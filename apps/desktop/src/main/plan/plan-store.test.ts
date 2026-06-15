import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashContent, readPlan, saveToWorkspace, slugify, writePlan } from "./plan-store";

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

describe("slugify", () => {
  it("produces a filesystem-safe kebab slug and never empty", () => {
    expect(slugify("SleepNode MVP 计划")).toBe("sleepnode-mvp-计划");
    expect(slugify("  Add JWT / Redis auth!  ")).toBe("add-jwt-redis-auth");
    expect(slugify("***")).toBe("plan");
  });
});

describe("writePlan / readPlan", () => {
  it("writes plan.md and round-trips the reference", () => {
    const plan = writePlan(root, {
      workspaceId: "ws-1",
      slug: slugify("My Feature"),
      title: "My Feature",
      content: "# My Feature\n## Goal\nDo a thing.\n",
      sessionId: "s-1",
    });
    expect(plan.path.endsWith("plan.md")).toBe(true);
    expect(readFileSync(plan.path, "utf8")).toContain("## Goal");
    expect(plan.hash).toBe(hashContent(plan.content));
    expect(plan.savedToWorkspace).toBe(false);

    const read = readPlan(root, "ws-1", plan.slug);
    expect(read?.content).toBe(plan.content);
    expect(read?.id).toBe(plan.id);
  });

  it("updates the same file on repeated writes for one slug (no forking)", () => {
    const first = writePlan(root, {
      workspaceId: "ws-1",
      slug: "feat",
      title: "Feat",
      content: "v1",
    });
    const second = writePlan(root, {
      workspaceId: "ws-1",
      slug: "feat",
      title: "Feat",
      content: "v2 updated",
    });
    expect(second.path).toBe(first.path);
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(readPlan(root, "ws-1", "feat")?.content).toBe("v2 updated");
  });

  it("returns undefined for a missing plan", () => {
    expect(readPlan(root, "ws-1", "nope")).toBeUndefined();
  });
});

describe("saveToWorkspace", () => {
  it("copies the plan into <repo>/.modus/specs/<slug>/ and flips the flag", () => {
    const plan = writePlan(root, {
      workspaceId: "ws-1",
      slug: "feat",
      title: "Feat",
      content: "# Feat\n",
    });
    const target = saveToWorkspace(root, plan, repo);
    expect(target).toBe(join(repo, ".modus", "specs", "feat", "plan.md"));
    expect(readFileSync(target, "utf8")).toBe("# Feat\n");
    expect(readPlan(root, "ws-1", "feat")?.savedToWorkspace).toBe(true);
  });
});
