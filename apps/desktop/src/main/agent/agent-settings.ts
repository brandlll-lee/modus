import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { getPiCliAgentDir } from "./agent-paths";

export function createAgentSettings(
  input: {
    cwd?: string;
    projectTrusted?: boolean;
    overrides?: Partial<ReturnType<SettingsManager["getSettings"]>>;
  } = {},
): SettingsManager {
  const settings = SettingsManager.create(input.cwd ?? process.cwd(), getPiCliAgentDir(), {
    projectTrusted: input.projectTrusted ?? false,
  });
  if (input.overrides) settings.applyOverrides(input.overrides);
  return settings;
}
