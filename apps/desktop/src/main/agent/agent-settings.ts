import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { getPiCliAgentDir } from "./agent-paths";

export type AgentSettingsInput = {
  cwd?: string;
  projectTrusted?: boolean;
  overrides?: Partial<ReturnType<SettingsManager["getSettings"]>>;
};

function readInheritedSettings(cwd: string, projectTrusted: boolean): SettingsManager {
  return SettingsManager.fromStorage(
    {
      withLock(scope, read) {
        const path =
          scope === "global"
            ? join(getPiCliAgentDir(), "settings.json")
            : join(cwd, ".pi", "settings.json");
        read(existsSync(path) ? readFileSync(path, "utf8") : undefined);
      },
    },
    { projectTrusted },
  );
}

export function createAgentSettings(input: AgentSettingsInput = {}): SettingsManager {
  const cwd = input.cwd ?? process.cwd();
  const projectTrusted = input.projectTrusted ?? false;
  const inherited = readInheritedSettings(cwd, true);
  const initial = (settings: ReturnType<SettingsManager["getSettings"]>): string => {
    const manager = SettingsManager.inMemory(settings);
    if (input.overrides) manager.applyOverrides(input.overrides);
    return JSON.stringify(manager.getSettings());
  };
  const values = {
    global: initial(inherited.getGlobalSettings()),
    project: initial(inherited.getProjectSettings()),
  };
  return SettingsManager.fromStorage(
    {
      withLock(scope, modify) {
        const next = modify(values[scope]);
        if (next !== undefined) values[scope] = next;
      },
    },
    { projectTrusted },
  );
}

export async function resolveInheritedResources(cwd: string, projectTrusted: boolean) {
  return new DefaultPackageManager({
    cwd,
    agentDir: getPiCliAgentDir(),
    settingsManager: readInheritedSettings(cwd, projectTrusted),
    builtinExtensions: ["codemode", "tool_search", "mcp"],
  }).resolve(async () => "skip");
}
