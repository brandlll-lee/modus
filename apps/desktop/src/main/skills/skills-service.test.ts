import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSkill } from "./skills-service";

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
});
