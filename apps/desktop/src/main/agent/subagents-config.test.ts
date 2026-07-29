import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSubagent,
  deleteSubagent,
  listSubagents,
  loadWorkspaceSubagents,
  parseSubagent,
  resolveSubagentsPrompt,
  subagentsDir,
  updateSubagent,
} from "./subagents-config";

describe("parseSubagent", () => {
  it("parses Cursor-compatible frontmatter and defaults", () => {
    const agent = parseSubagent(
      "---\nname: Security Auditor\ndescription: Review auth\nreadonly: true\n---\nBody",
      "fallback",
    );

    expect(agent).toEqual({
      name: "security-auditor",
      description: "Review auth",
      model: "inherit",
      readOnly: true,
      isolation: "shared",
      body: "Body",
    });
  });

  it("parses tool filters and worktree isolation", () => {
    const agent = parseSubagent(
      "---\ntools: [read, grep]\ndisallowedTools:\n  - shell\nisolation: worktree\n---\nBody",
      "researcher",
    );

    expect(agent).toMatchObject({
      tools: ["read", "grep"],
      disallowedTools: ["shell"],
      isolation: "worktree",
    });
  });
});

describe("loadWorkspaceSubagents", () => {
  let cwd: string;
  let home: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "modus-subagents-cwd-"));
    home = mkdtempSync(join(tmpdir(), "modus-subagents-home-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  function writeAgent(root: string, name: string, description: string): string {
    const dir = join(root, "agents");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${name}.md`);
    writeFileSync(
      path,
      `---\nname: ${name}\ndescription: ${description}\n---\n${description}`,
      "utf8",
    );
    return path;
  }

  it("uses workspace and provider precedence for same-name agents", () => {
    writeAgent(join(home, ".modus"), "reviewer", "home modus");
    writeAgent(join(cwd, ".claude"), "reviewer", "workspace claude");
    const winner = writeAgent(join(cwd, ".modus"), "reviewer", "workspace modus");

    const agents = loadWorkspaceSubagents(cwd, home);

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      name: "reviewer",
      description: "workspace modus",
      path: winner,
      scope: "workspace",
      source: ".modus",
    });
  });

  it("keeps overridden user agents visible for settings management", () => {
    const user = writeAgent(join(home, ".modus"), "reviewer", "home modus");
    const workspace = writeAgent(join(cwd, ".modus"), "reviewer", "workspace modus");

    expect(loadWorkspaceSubagents(cwd, home)).toHaveLength(1);
    expect(listSubagents(cwd, home).filter((agent) => agent.name === "reviewer")).toEqual([
      expect.objectContaining({ path: user, scope: "user" }),
      expect.objectContaining({ path: workspace, scope: "workspace" }),
    ]);
  });

  it("resolves home and workspace Modus agent folders from explicit scope", () => {
    expect(subagentsDir(cwd, "user", home)).toBe(join(home, ".modus", "agents"));
    expect(subagentsDir(cwd, "workspace", home)).toBe(join(cwd, ".modus", "agents"));
  });

  it("renders an empty manifest that prevents invented subagent names", () => {
    const prompt = resolveSubagentsPrompt(cwd);

    expect(prompt).toContain("No configured subagents are available");
    expect(prompt).toContain("without the `subagent` field");
    expect(prompt).toContain("do not invent subagent names");
  });

  it("creates, updates, deletes, and renders the manifest without bodies", () => {
    const created = createSubagent({
      cwd,
      name: "Security Auditor",
      description: "Review auth",
      model: "mock/model",
      readOnly: true,
      tools: ["read", "grep"],
      disallowedTools: ["shell"],
      isolation: "worktree",
      body: "SECRET BODY",
    });
    expect(readFileSync(created.path, "utf8")).toContain("name: security-auditor");
    expect(readFileSync(created.path, "utf8")).toContain("tools: [read, grep]");

    const updated = updateSubagent({
      cwd,
      path: created.path,
      name: "Security Auditor",
      description: "Review payments",
      model: "inherit",
      readOnly: false,
      isolation: "shared",
      body: "UPDATED BODY",
    });
    expect(updated.description).toBe("Review payments");

    const prompt = resolveSubagentsPrompt(cwd);
    expect(prompt).toContain("security-auditor");
    expect(prompt).toContain("Review payments");
    expect(prompt).toContain("exact name listed below");
    expect(prompt).not.toContain("UPDATED BODY");

    expect(deleteSubagent(cwd, updated.path)).toEqual([]);
  });
});
