import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CreateSkillInput,
  SkillDetail,
  SkillInfo,
  SkillSelection,
} from "../../shared/contracts";
import { loadWorkspaceSkills, normalizeSkillName, toSkillInfo } from "./skills-config";

/**
 * Skills runtime — discovers SKILL.md files for a workspace, exposes them to the
 * Settings UI and the composer slash menu, lets users scaffold new skills, and
 * renders the Codex-style skills manifest plus explicit `/skill` injections.
 */

/** All skills visible from this workspace, without their (large) bodies. */
export function listSkills(cwd: string): SkillInfo[] {
  return loadWorkspaceSkills(cwd).map(toSkillInfo);
}

/** A single skill with its full instruction body, located by its discovered path. */
export function getSkill(cwd: string, path: string): SkillDetail | undefined {
  return loadWorkspaceSkills(cwd).find((skill) => skill.path === path);
}

const SKILLS_MANIFEST_BUDGET = 8000;

export function resolveSkillsPrompt(
  cwd: string,
  selections: SkillSelection[],
  home?: string,
): string {
  const skills = loadWorkspaceSkills(cwd, home);
  const manifest = renderSkillsManifest(skills);
  const blocks: string[] = [];
  const selectedPaths = new Set(selections.map((selection) => selection.path));
  for (const path of selectedPaths) {
    const skill = skills.find((item) => item.path === path);
    if (!skill) {
      continue;
    }
    const header = skill.description ? `${skill.name} — ${skill.description}` : skill.name;
    blocks.push(
      `<skill name="${skill.name}" path="${skill.path}">\n${header}\n\n${skill.body}\n</skill>`,
    );
  }
  if (blocks.length === 0) {
    return manifest;
  }
  return [
    manifest,
    "<invoked_skills>",
    "The user invoked the following skill(s). Follow their instructions for this task.",
    "",
    ...blocks,
    "</invoked_skills>",
  ].join("\n");
}

function renderSkillsManifest(skills: SkillDetail[]): string {
  const available = skills.filter((skill) => skill.enabled && skill.allowImplicitInvocation);
  if (available.length === 0) {
    return "";
  }
  const intro = [
    "## Skills",
    "A skill is a local `SKILL.md` workflow. Below are the skills available this turn.",
    "If a task matches a skill, read its file path with the existing file tools before following it.",
    "Prefer built-in skills when they cover the task; use external skills for workflows not covered by built-ins.",
    "",
  ];
  const fullLines = renderSkillLinesByScope(available, true);
  const full = [...intro, ...fullLines].join("\n");
  if (full.length <= SKILLS_MANIFEST_BUDGET) {
    return full;
  }
  const minimalLines = renderSkillLinesByScope(available, false);
  const lines = [...intro, ...minimalLines];
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const next = used + line.length + 1;
    if (next > SKILLS_MANIFEST_BUDGET) {
      break;
    }
    kept.push(line);
    used = next;
  }
  return kept.join("\n");
}

function renderSkillLinesByScope(skills: SkillDetail[], includeDescription: boolean): string[] {
  const groups = [
    ["### Built-in skills", skills.filter((skill) => skill.scope === "builtin")],
    ["### External skills", skills.filter((skill) => skill.scope !== "builtin")],
  ] as const;
  return groups.flatMap(([heading, items]) => {
    if (items.length === 0) {
      return [];
    }
    return [
      "",
      heading,
      ...items.map((skill) =>
        includeDescription && skill.description
          ? `- ${skill.name}: ${skill.description} (file: ${skill.path})`
          : `- ${skill.name}: (file: ${skill.path})`,
      ),
    ];
  });
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
    name,
    description,
    scope: "workspace",
    source: ".modus",
    path: file,
    enabled: true,
    allowImplicitInvocation: true,
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
