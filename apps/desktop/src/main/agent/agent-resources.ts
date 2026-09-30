import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  DefaultResourceLoader,
  type InlineExtension,
  loadProjectContextFiles,
  type ResourceLoader,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { builtinSkillsDir } from "../skills/skills";
import { getPiCliAgentDir, modusAgentDir } from "./agent-paths";
import { resolveInheritedResources } from "./agent-settings";

export async function createAgentResourceLoader(
  cwd: string,
  settingsManager: SettingsManager,
  extensionFactories: InlineExtension[],
  hostPrompt: () => string[] = () => [],
): Promise<ResourceLoader> {
  async function load(
    options?: Parameters<ResourceLoader["reload"]>[0],
  ): Promise<DefaultResourceLoader> {
    await settingsManager.reload();
    const trusted = settingsManager.isProjectTrusted();
    const resources = await resolveInheritedResources(cwd, trusted);
    const enabled = (entries: typeof resources.skills) =>
      entries.filter((entry) => entry.enabled).map((entry) => entry.path);
    const roots = [
      getPiCliAgentDir(),
      join(cwd, ".pi"),
      modusAgentDir(),
      ...(trusted ? [join(cwd, ".modus")] : []),
    ];
    const promptFile = (name: string) => roots.map((root) => join(root, name)).findLast(existsSync);
    const systemPrompt = promptFile("SYSTEM.md");
    const append = promptFile("APPEND_SYSTEM.md");
    const bundled = builtinSkillsDir();
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: modusAgentDir(),
      settingsManager,
      extensionFactories,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      additionalExtensionPaths: enabled(resources.extensions),
      additionalSkillPaths: [
        ...enabled(resources.skills),
        ...(existsSync(bundled) ? [bundled] : []),
      ],
      additionalPromptTemplatePaths: enabled(resources.prompts),
      additionalThemePaths: enabled(resources.themes),
      ...(systemPrompt ? { systemPrompt } : {}),
      appendSystemPrompt: [...(append ? [append] : []), ...hostPrompt()],
      agentsFilesOverride: () => {
        const roots = [
          getPiCliAgentDir(),
          modusAgentDir(),
          ...(trusted ? [join(cwd, ".modus")] : []),
        ];
        const files = new Map<string, { path: string; content: string }>();
        for (const agentDir of roots)
          for (const file of loadProjectContextFiles({ cwd, agentDir }))
            if (!files.has(file.path)) files.set(file.path, file);
        return { agentsFiles: [...files.values()] };
      },
    });
    await loader.reload(options);
    loader.extendResources({
      skillPaths: resources.skills.filter((entry) => entry.enabled),
      promptPaths: resources.prompts.filter((entry) => entry.enabled),
      themePaths: resources.themes.filter((entry) => entry.enabled),
    });
    return loader;
  }
  let current = await load();
  return {
    getExtensions: () => current.getExtensions(),
    getSkills: () => current.getSkills(),
    getPrompts: () => current.getPrompts(),
    getThemes: () => current.getThemes(),
    getAgentsFiles: () => current.getAgentsFiles(),
    getSystemPrompt: () => current.getSystemPrompt(),
    getSystemPromptSource: () => current.getSystemPromptSource(),
    getAppendSystemPrompt: () => current.getAppendSystemPrompt(),
    getAppendSystemPromptSources: () => current.getAppendSystemPromptSources(),
    extendResources: (paths) => current.extendResources(paths),
    reload: async (options) => {
      current = await load(options);
    },
  };
}
