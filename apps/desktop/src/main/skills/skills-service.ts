import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CreateSkillInput, SkillDetail, SkillInfo } from "../../shared/contracts";
import { loadWorkspaceSkills, normalizeSkillName, skillId, toSkillInfo } from "./skills-config";

/**
 * Skills runtime — discovers SKILL.md files for a workspace, exposes them to the
 * Settings UI and the composer slash menu, lets users scaffold new skills, and
 * resolves a set of invoked skills into instruction text the runtime prepends
 * to a prompt (the manual `/skill` invocation path).
 */

/** All skills visible from this workspace, without their (large) bodies. */
export function listSkills(cwd: string): SkillInfo[] {
  return loadWorkspaceSkills(cwd).map(toSkillInfo);
}

/** A single skill with its full instruction body, located by id or name. */
export function getSkill(cwd: string, idOrName: string): SkillDetail | undefined {
  const skills = loadWorkspaceSkills(cwd);
  return (
    skills.find((skill) => skill.id === idOrName) ??
    skills.find((skill) => skill.name === normalizeSkillName(idOrName))
  );
}

/**
 * Build the instruction block injected when the user invokes skills with `/name`.
 * Each skill's body is wrapped so the model can tell where instructions begin
 * and end, mirroring how Cursor/Claude inject skill content on manual trigger.
 */
export function resolveSkillsPrompt(cwd: string, names: string[]): string {
  if (names.length === 0) {
    return "";
  }
  const skills = loadWorkspaceSkills(cwd);
  const blocks: string[] = [];
  for (const name of names) {
    const normalized = normalizeSkillName(name);
    const skill = skills.find((item) => item.id === name || item.name === normalized);
    if (!skill) {
      continue;
    }
    const header = skill.description ? `${skill.name} — ${skill.description}` : skill.name;
    blocks.push(`<skill name="${skill.name}">\n${header}\n\n${skill.body}\n</skill>`);
  }
  if (blocks.length === 0) {
    return "";
  }
  return [
    "<invoked_skills>",
    "The user invoked the following skill(s). Follow their instructions for this task.",
    "",
    ...blocks,
    "</invoked_skills>",
  ].join("\n");
}

function frontmatterScalar(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}

const DEFAULT_SKILL_BODY = (name: string): string => `# ${name}

Describe what this skill does and when the agent should use it.

## Steps

1. First, …
2. Then, …

## Guidelines

- Be specific about the expected output.
- Reference the tools or files this skill should touch.
`;

const SKILL_TEMPLATE = (name: string, description: string, body: string): string =>
  `---
name: ${name}
description: ${frontmatterScalar(description)}
---

${body.trim() || DEFAULT_SKILL_BODY(name)}
`;

/** The Modus-native skills directory for a workspace (where new skills land). */
export function skillsDir(cwd: string): string {
  return join(cwd, ".modus", "skills");
}

/** Scaffold a new skill folder + SKILL.md and return its info. Errors on conflict. */
export function createSkill(input: CreateSkillInput): SkillInfo {
  const name = normalizeSkillName(input.name);
  if (!name) {
    throw new Error("Skill name must contain at least one letter or number.");
  }
  const description = input.description.trim();
  const body = input.body.trim();
  const dir = join(skillsDir(input.cwd), name);
  const file = join(dir, "SKILL.md");
  if (existsSync(file)) {
    throw new Error(`A skill named "${name}" already exists in this workspace.`);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, SKILL_TEMPLATE(name, description, body), "utf8");
  return {
    id: skillId("workspace", ".modus", name),
    name,
    description,
    scope: "workspace",
    source: ".modus",
    path: file,
  };
}

/** Ensure the workspace skills directory exists; returns its path (for "open"). */
export function ensureSkillsDir(cwd: string): string {
  const dir = skillsDir(cwd);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
