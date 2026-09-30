import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { shell } from "electron";
import type { SkillState } from "../../shared/contracts";
import { sessionResources } from "../agent/session-resources";
import { toSkillInfo } from "./skills";

export function listSkills(sessionId: string): SkillState {
  const loaded = sessionResources()
    .find(({ id }) => id === sessionId)
    ?.loader.getSkills();
  return {
    skills: loaded?.skills.map(toSkillInfo) ?? [],
    diagnostics:
      loaded?.diagnostics.map(({ type, message, path }) => ({
        type,
        message,
        ...(path ? { path } : {}),
      })) ?? [],
  };
}

export async function revealSkill(sessionId: string, path: string): Promise<void> {
  const state = listSkills(sessionId);
  if (
    (!state.skills.some((skill) => skill.path === path) &&
      !state.diagnostics.some((diagnostic) => diagnostic.path === path)) ||
    !existsSync(path)
  )
    throw new Error("Skill is not available in this session.");
  const error = await shell.openPath(dirname(path));
  if (error) throw new Error(error);
}
