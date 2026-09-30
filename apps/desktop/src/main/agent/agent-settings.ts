import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { getPiCliAgentDir, modusAgentDir } from "./agent-paths";

type Settings = ReturnType<SettingsManager["getSettings"]>;
export type AgentSettingsInput = {
  cwd?: string;
  projectTrusted?: boolean;
  overrides?: Partial<Settings>;
};

function readSettings(path: string): Settings {
  return SettingsManager.fromStorage(
    {
      withLock(_scope, read) {
        read(existsSync(path) ? readFileSync(path, "utf8") : undefined);
      },
    },
    { projectTrusted: false },
  ).getGlobalSettings();
}

function mergeSettings(...layers: Settings[]): Settings {
  const manager = SettingsManager.inMemory({});
  for (const layer of layers) manager.applyOverrides(layer);
  return manager.getSettings();
}

function resourcePaths(settings: Settings, base: string): Settings {
  const result = { ...settings };
  for (const key of ["extensions", "skills", "prompts", "themes"] as const) {
    if (result[key])
      result[key] = result[key].map((entry) => {
        const prefix = /^[!+-]/.test(entry) ? entry[0] : "";
        const path = prefix ? entry.slice(1) : entry;
        return `${prefix}${isAbsolute(path) || path.startsWith("~") || /^[a-z][a-z0-9+.-]*:/i.test(path) ? path : resolve(base, path)}`;
      });
  }
  if (result.packages)
    result.packages = result.packages.map((entry) => {
      const source = typeof entry === "string" ? entry : entry.source;
      const normalized = source.startsWith(".") ? resolve(base, source) : source;
      return typeof entry === "string" ? normalized : { ...entry, source: normalized };
    });
  return result;
}

export function createAgentSettings(input: AgentSettingsInput = {}): SettingsManager {
  const cwd = input.cwd ?? process.cwd();
  return SettingsManager.fromStorage(
    {
      withLock(scope, modify) {
        const ownGlobal = resourcePaths(
          readSettings(join(modusAgentDir(), "settings.json")),
          modusAgentDir(),
        );
        const base =
          scope === "global"
            ? resourcePaths(
                readSettings(join(getPiCliAgentDir(), "settings.json")),
                getPiCliAgentDir(),
              )
            : resourcePaths(readSettings(join(cwd, ".pi", "settings.json")), join(cwd, ".pi"));
        const ownProject =
          scope === "project"
            ? resourcePaths(readSettings(join(cwd, ".modus", "settings.json")), join(cwd, ".modus"))
            : {};
        modify(JSON.stringify(mergeSettings(base, ownGlobal, ownProject, input.overrides ?? {})));
      },
    },
    { projectTrusted: input.projectTrusted ?? false },
  );
}

export async function resolveInheritedResources(cwd: string, projectTrusted: boolean) {
  const kinds = ["extensions", "skills", "prompts", "themes"] as const;
  const resolved = await new DefaultPackageManager({
    cwd,
    agentDir: getPiCliAgentDir(),
    settingsManager: SettingsManager.fromStorage(
      {
        withLock(scope, read) {
          const base = scope === "global" ? getPiCliAgentDir() : join(cwd, ".pi");
          read(JSON.stringify(resourcePaths(readSettings(join(base, "settings.json")), base)));
        },
      },
      { projectTrusted },
    ),
    builtinExtensions: ["codemode", "tool_search", "mcp"],
  }).resolve(async () => "skip");
  const layers = [
    { root: modusAgentDir(), scope: "user" as const },
    ...(projectTrusted ? [{ root: join(cwd, ".modus"), scope: "project" as const }] : []),
  ];
  for (const layer of layers) {
    const own = resourcePaths(readSettings(join(layer.root, "settings.json")), layer.root);
    const settings = { ...own };
    for (const kind of kinds)
      settings[kind] = [
        ...resolved[kind].map((entry) => entry.path),
        ...resolved[kind].filter((entry) => !entry.enabled).map((entry) => `-${entry.path}`),
        ...(own[kind] ?? []),
      ];
    const next = await new DefaultPackageManager({
      cwd,
      agentDir: layer.root,
      settingsManager: SettingsManager.inMemory(settings, { projectTrusted: false }),
      builtinExtensions: ["codemode", "tool_search", "mcp"],
    }).resolve(async () => "skip");
    for (const kind of kinds) {
      const previous = new Map(resolved[kind].map((entry) => [entry.path, entry]));
      resolved[kind] = next[kind]
        .filter(
          (entry) =>
            entry.metadata.source !== "auto" ||
            entry.metadata.baseDir === layer.root ||
            previous.has(entry.path),
        )
        .map((entry) => ({
          ...entry,
          metadata: previous.get(entry.path)?.metadata ?? { ...entry.metadata, scope: layer.scope },
        }))
        .sort((a, b) => Number(previous.has(a.path)) - Number(previous.has(b.path)));
    }
  }
  return resolved;
}
