import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listRuleFiles, parseMdcFrontmatter, resolveAlwaysRulesPrompt } from "./rules-service";

describe("parseMdcFrontmatter", () => {
  it("parses scalar keys and returns the body", () => {
    const { data, body } = parseMdcFrontmatter(
      "---\nalwaysApply: true\ndescription: Test rule\n---\nFollow these steps.",
    );
    expect(data.alwaysApply).toBe("true");
    expect(data.description).toBe("Test rule");
    expect(body).toBe("Follow these steps.");
  });

  it("treats a document with no frontmatter as pure body", () => {
    const { data, body } = parseMdcFrontmatter("# Title\n\nbody");
    expect(data).toEqual({});
    expect(body).toBe("# Title\n\nbody");
  });
});

describe("listRuleFiles", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "modus-rules-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("detects root markdown rules and .mdc modes", () => {
    writeFileSync(join(root, "AGENTS.md"), "# Agent rules");
    mkdirSync(join(root, ".cursor", "rules"), { recursive: true });
    writeFileSync(
      join(root, ".cursor", "rules", "always.mdc"),
      "---\nalwaysApply: true\n---\nAlways body.",
    );
    writeFileSync(
      join(root, ".cursor", "rules", "glob.mdc"),
      '---\nglobs: "**/*.ts"\n---\nGlob body.',
    );

    const rules = listRuleFiles(root);
    expect(rules.map((rule) => rule.relPath)).toEqual(
      expect.arrayContaining(["AGENTS.md", ".cursor/rules/always.mdc", ".cursor/rules/glob.mdc"]),
    );
    expect(rules.find((rule) => rule.relPath === "AGENTS.md")?.mode).toBe("always");
    expect(rules.find((rule) => rule.relPath.endsWith("always.mdc"))?.mode).toBe("always");
    expect(rules.find((rule) => rule.relPath.endsWith("glob.mdc"))?.mode).toBe("glob");
  });
});

describe("resolveAlwaysRulesPrompt", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "modus-rules-prompt-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("wraps always-applied rules in a project_rules block", () => {
    writeFileSync(join(root, "AGENTS.md"), "Use TypeScript strictly.");
    const prompt = resolveAlwaysRulesPrompt(root);
    expect(prompt).toContain("<project_rules>");
    expect(prompt).toContain('<rule source="AGENTS.md">');
    expect(prompt).toContain("Use TypeScript strictly.");
  });

  it("returns undefined when no always rules exist", () => {
    mkdirSync(join(root, ".cursor", "rules"), { recursive: true });
    writeFileSync(
      join(root, ".cursor", "rules", "manual.mdc"),
      "---\ndescription: Manual only\n---\nBody.",
    );
    expect(resolveAlwaysRulesPrompt(root)).toBeUndefined();
  });
});
