import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import type { CreateSkillInput, SkillDetail, SkillInfo } from "../../shared/contracts";
import { modusAgentDir } from "../agent/agent-paths";
import {
  assertSessionResourcesIdle,
  reloadSessionResources,
  sessionResources,
} from "../agent/session-resources";
import { builtinSkillsDir, modusSkillPaths, normalizeSkillName, toSkillInfo } from "./skills";

export function listSkills(cwd: string): SkillInfo[] {
  return sessionResources(cwd)[0]?.loader.getSkills().skills.map(toSkillInfo) ?? [];
}

export function skillPathsFor(cwd: string): string[] {
  return modusSkillPaths(cwd, homedir(), builtinSkillsDir());
}

export function getSkill(cwd: string, path: string): SkillDetail | undefined {
  const skill = sessionResources(cwd)
    .flatMap(({ loader }) => loader.getSkills().skills)
    .find((item) => item.filePath === path);
  if (!skill) return undefined;
  return { ...toSkillInfo(skill), body: readFileSync(skill.filePath, "utf8") };
}

export function skillsDir(cwd: string): string {
  return join(cwd, ".modus", "skills");
}

export async function createSkill(input: CreateSkillInput): Promise<SkillInfo> {
  assertSessionResourcesIdle(input.cwd);
  const name = normalizeSkillName(input.name);
  if (!name) throw new Error("Skill name must contain at least one letter or number.");
  const dir = join(skillsDir(input.cwd), name);
  const file = join(dir, "SKILL.md");
  if (existsSync(file))
    throw new Error(`A skill named "${name}" already exists in this workspace.`);
  const body = input.body.trim();
  if (!body || !input.description.trim())
    throw new Error("Skill description and instructions are required.");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    file,
    `---\nname: ${name}\ndescription: ${JSON.stringify(input.description.trim())}\n---\n\n${body}\n`,
    "utf8",
  );
  const result = loadSkills({
    cwd: input.cwd,
    agentDir: modusAgentDir(),
    skillPaths: [file],
    includeDefaults: false,
  });
  const skill = result.skills[0];
  if (!skill)
    throw new Error(
      result.diagnostics.map((diagnostic) => diagnostic.message).join("\n") ||
        "PI could not load the skill.",
    );
  await reloadSessionResources(input.cwd);
  return toSkillInfo(skill);
}

export function ensureSkillsDir(cwd: string): string {
  const dir = skillsDir(cwd);
  mkdirSync(dir, { recursive: true });
  return dir;
}
