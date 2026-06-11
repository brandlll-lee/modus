import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadWorkspaceSkills,
  normalizeSkillName,
  parseFrontmatter,
  parseSkill,
} from "./skills-config";

describe("parseFrontmatter", () => {
  it("parses scalar keys and the body", () => {
    const { data, body } = parseFrontmatter(
      "---\nname: code-review\ndescription: Review a diff\n---\nDo the thing.",
    );
    expect(data.name).toBe("code-review");
    expect(data.description).toBe("Review a diff");
    expect(body).toBe("Do the thing.");
  });

  it("parses inline and block lists", () => {
    const inline = parseFrontmatter("---\nallowed-tools: [read, grep]\n---\nx").data;
    expect(inline["allowed-tools"]).toEqual(["read", "grep"]);
    const block = parseFrontmatter("---\nallowed-tools:\n  - read\n  - grep\n---\nx").data;
    expect(block["allowed-tools"]).toEqual(["read", "grep"]);
  });

  it("parses YAML block scalar descriptions", () => {
    const literal = parseFrontmatter(
      "---\ndescription: |\n  Read the diff carefully.\n  Return findings first.\n---\nx",
    ).data;
    expect(literal.description).toBe("Read the diff carefully.\nReturn findings first.");

    const folded = parseFrontmatter(
      "---\ndescription: >\n  Read the diff carefully.\n  Return findings first.\n---\nx",
    ).data;
    expect(folded.description).toBe("Read the diff carefully. Return findings first.");
  });

  it("parses indented multiline descriptions without a scalar marker", () => {
    const { data } = parseFrontmatter(
      "---\ndescription:\n  React composition patterns that scale.\n  Includes React 19 API changes.\nlicense: MIT\n---\nx",
    );

    expect(data.description).toBe(
      "React composition patterns that scale. Includes React 19 API changes.",
    );
    expect(data.license).toBe("MIT");
  });

  it("treats a document with no frontmatter as pure body", () => {
    const { data, body } = parseFrontmatter("# Title\n\nbody");
    expect(data).toEqual({});
    expect(body).toBe("# Title\n\nbody");
  });
});

describe("parseSkill", () => {
  it("falls back to the folder name and first body line", () => {
    const skill = parseSkill("# Heading\n\nThis explains the skill.", "my-skill");
    expect(skill.name).toBe("my-skill");
    expect(skill.description).toBe("This explains the skill.");
  });

  it("normalizes a noisy frontmatter name", () => {
    expect(parseSkill("---\nname: Code Review!\n---\nx", "fallback").name).toBe("code-review");
  });

  it("uses a normalized one-line description from multiline frontmatter", () => {
    const skill = parseSkill(
      "---\nname: review\ndescription: |\n  Read the diff carefully.\n  Return findings first.\n---\nx",
      "fallback",
    );

    expect(skill.description).toBe("Read the diff carefully. Return findings first.");
  });
});

describe("normalizeSkillName", () => {
  it("kebab-cases arbitrary input", () => {
    expect(normalizeSkillName("  Improve  Codebase Architecture ")).toBe(
      "improve-codebase-architecture",
    );
  });
});

describe("loadWorkspaceSkills", () => {
  let cwd: string;
  let home: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "modus-skills-cwd-"));
    home = mkdtempSync(join(tmpdir(), "modus-skills-home-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  function writeSkill(root: string, name: string, text: string): void {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), text, "utf8");
  }

  it("discovers folder-style and flat skills", () => {
    writeSkill(join(cwd, ".modus", "skills"), "autoplan", "---\ndescription: Plan it\n---\nbody");
    mkdirSync(join(cwd, ".cursor", "skills"), { recursive: true });
    writeFileSync(
      join(cwd, ".cursor", "skills", "explain.md"),
      "---\ndescription: Explain code\n---\nbody",
      "utf8",
    );

    const skills = loadWorkspaceSkills(cwd, home);
    const names = skills.map((skill) => skill.name);
    expect(names).toContain("autoplan");
    expect(names).toContain("explain");
  });

  it("discovers nested folder-style skills below a skills root", () => {
    writeSkill(
      join(cwd, ".modus", "skills", "engineering", "review"),
      "deep-scope",
      "---\ndescription: Nested review\n---\nbody",
    );

    const skills = loadWorkspaceSkills(cwd, home);
    const nested = skills.find((skill) => skill.name === "deep-scope");
    expect(nested?.description).toBe("Nested review");
    expect(nested?.path).toContain(join("engineering", "review", "deep-scope", "SKILL.md"));
  });

  it("lets workspace .modus override an interop folder with the same name", () => {
    writeSkill(join(cwd, ".cursor", "skills"), "review", "---\ndescription: from cursor\n---\na");
    writeSkill(join(cwd, ".modus", "skills"), "review", "---\ndescription: from modus\n---\nb");

    const skills = loadWorkspaceSkills(cwd, home);
    const review = skills.filter((skill) => skill.name === "review");
    expect(review).toHaveLength(1);
    expect(review[0]?.description).toBe("from modus");
    expect(review[0]?.source).toBe(".modus");
  });

  it("discovers user-scoped skills from the home directory", () => {
    writeSkill(join(home, ".modus", "skills"), "grill-me", "---\ndescription: Interview\n---\nx");
    const skills = loadWorkspaceSkills(cwd, home);
    const grill = skills.find((skill) => skill.name === "grill-me");
    expect(grill?.scope).toBe("user");
  });
});
