import type { Skill } from "@earendil-works/pi-coding-agent";
import type { SkillInfo } from "../../shared/contracts";

/**
 * Skill presentation adapter — maps PI's discovered skills to Modus contract types.
 *
 * PI owns discovery, parsing, validation, and precedence. Modus does not scan
 * directories; it reads the resource loader's resolved skills and translates
 * them for the UI. `scope` and `source` therefore mirror PI's `SourceInfo`
 * rather than a Modus-invented taxonomy.
 */

export function toSkillInfo(skill: Skill): SkillInfo {
  return {
    name: skill.name,
    description: skill.description,
    scope: skill.sourceInfo.scope,
    source: skill.sourceInfo.source,
    path: skill.filePath,
    allowImplicitInvocation: !skill.disableModelInvocation,
  };
}
