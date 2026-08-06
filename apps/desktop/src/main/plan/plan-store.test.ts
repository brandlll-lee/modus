import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteSessionPlan,
  hashContent,
  readPlan,
  readPlanById,
  setPlanBuildStatusById,
  writePlan,
} from "./plan-store";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "modus-plan-root-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(overrides: Partial<Parameters<typeof writePlan>[1]> = {}) {
  return writePlan(root, {
    workspaceId: "ws-1",
    sessionId: "session-1",
    title: "Feat",
    overview: "Build the thing.",
    content: "# Feat\n\nDo a thing.",
    todos: [{ content: "Scaffold the project" }, { content: "Wire it up" }],
    ...overrides,
  });
}

describe("session plan persistence", () => {
  it("stores markdown content as plan.md and a single markdown block", () => {
    const plan = write({ content: "# Feature\n\nClient calls the router, then the store." });

    expect(plan.id).toBe("session-1");
    expect(plan.blocks).toEqual([
      { type: "markdown", content: "# Feature\n\nClient calls the router, then the store." },
    ]);
    expect(plan.hash).toBe(hashContent(plan.content));
    expect(readFileSync(plan.path, "utf8")).toContain("Client calls the router");
    expect(readPlan(root, "session-1")?.content).toContain("Client calls the router");
  });

  it("projects legacy visual blocks to markdown on read", () => {
    const dir = join(root, "session-legacy");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "plan.md");
    const body = "### Request flow\n\nClient calls the router, then the store.";
    writeFileSync(path, body, "utf8");
    writeFileSync(
      join(dir, "plan.json"),
      JSON.stringify({
        id: "session-legacy",
        sessionId: "session-legacy",
        workspaceId: "ws-1",
        title: "Legacy",
        overview: "Old visual plan.",
        path,
        blocks: [
          { type: "markdown", content: "# Feature" },
          {
            type: "visual",
            title: "Request flow",
            kind: "svg",
            content: "<svg><path /></svg>",
            fallback: "Client calls the router, then the store.",
          },
        ],
        todos: [],
        buildStatus: "not_built",
      }),
      "utf8",
    );

    const plan = readPlan(root, "session-legacy");
    expect(plan?.blocks).toEqual([
      { type: "markdown", content: "# Feature" },
      {
        type: "markdown",
        content: "### Request flow\n\nClient calls the router, then the store.",
      },
    ]);
    expect(plan?.content).toBe(body);
  });

  it("isolates equal plan titles by session and rewrites only the owning session", () => {
    const first = write();
    const other = write({ sessionId: "session-2" });
    const revised = write({
      content: "# Revised",
    });

    expect(revised.path).toBe(first.path);
    expect(other.path).not.toBe(first.path);
    expect(readPlan(root, "session-1")?.content).toBe("# Revised");
    expect(readPlan(root, "session-2")?.content).toContain("# Feat");
  });

  it("derives stable unique todo ids and resets build status on revision", () => {
    const plan = write({
      todos: [{ content: "Same step" }, { content: "Same step" }],
    });
    expect(new Set(plan.todos.map((todo) => todo.id)).size).toBe(2);
    expect(setPlanBuildStatusById(root, plan.id, "built")?.buildStatus).toBe("built");
    expect(write().buildStatus).toBe("not_built");
  });

  it("deletes the plan with its session", () => {
    write();
    deleteSessionPlan(root, "session-1");
    expect(readPlan(root, "session-1")).toBeUndefined();
  });

  it("also removes a historical workspace-scoped plan owned by the session", () => {
    const legacyDir = join(root, "workspace", "feature");
    const path = join(legacyDir, "plan.md");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(path, "# Legacy", "utf8");
    writeFileSync(
      join(legacyDir, "plan.json"),
      JSON.stringify({ id: "workspace:feature", sessionId: "session-1", path }),
      "utf8",
    );

    deleteSessionPlan(root, "session-1");
    expect(existsSync(legacyDir)).toBe(false);
  });
});

describe("build status transitions", () => {
  it("transitions through building and built by session id", () => {
    const plan = write();
    expect(setPlanBuildStatusById(root, plan.id, "building")?.buildStatus).toBe("building");
    expect(setPlanBuildStatusById(root, plan.id, "built")?.buildStatus).toBe("built");
    expect(readPlanById(root, plan.id)?.buildStatus).toBe("built");
  });

  it("returns undefined for a missing plan", () => {
    expect(setPlanBuildStatusById(root, "missing", "built")).toBeUndefined();
    expect(readPlanById(root, "missing")).toBeUndefined();
  });
});
