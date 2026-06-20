import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSkill, resolveSkillsPrompt } from "./skills-service";

describe("createSkill", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "modus-skill-create-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("writes the user-authored instructions into SKILL.md", () => {
    const body = [
      "# Code Review",
      "",
      "Use this skill when reviewing code.",
      "",
      "## Steps",
      "",
      "1. Read the diff.",
      "2. Return findings first.",
    ].join("\n");

    const skill = createSkill({
      cwd,
      name: "Code Review",
      description: "Review code changes",
      body,
    });

    const text = readFileSync(skill.path, "utf8");
    expect(text).toContain("name: code-review");
    expect(text).toContain("description: Review code changes");
    expect(text).toContain(body);
  });

  it("lists implicit skills without injecting their bodies", () => {
    const skillDir = join(cwd, ".modus", "skills", "review");
    const skillPath = join(skillDir, "SKILL.md");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      skillPath,
      "---\nname: review\ndescription: Review code\n---\nSECRET BODY",
      "utf8",
    );

    const prompt = resolveSkillsPrompt(cwd, []);

    expect(prompt).toContain("## Skills");
    expect(prompt).toContain(skillPath);
    expect(prompt).not.toContain("SECRET BODY");
  });

  it("injects only the explicitly selected skill body by path", () => {
    const firstDir = join(cwd, ".cursor", "skills", "review");
    const secondDir = join(cwd, ".modus", "skills", "review");
    const firstPath = join(firstDir, "SKILL.md");
    const secondPath = join(secondDir, "SKILL.md");
    mkdirSync(firstDir, { recursive: true });
    mkdirSync(secondDir, { recursive: true });
    writeFileSync(firstPath, "---\nname: review\ndescription: Cursor\n---\nCURSOR BODY", "utf8");
    writeFileSync(secondPath, "---\nname: review\ndescription: Modus\n---\nMODUS BODY", "utf8");

    const prompt = resolveSkillsPrompt(cwd, [{ name: "review", path: secondPath }]);

    expect(prompt).toContain(`<skill name="review" path="${secondPath}">`);
    expect(prompt).toContain("MODUS BODY");
    expect(prompt).not.toContain("CURSOR BODY");
  });
});
