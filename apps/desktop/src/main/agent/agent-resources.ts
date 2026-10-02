import {
  createCodemodeExtension,
  createToolSearchExtension,
  DefaultResourceLoader,
  type InlineExtension,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createModusMcpExtension } from "../mcp/mcp-service";
import { getPiCliAgentDir } from "./agent-paths";
import { withRuntimeToolPolicy } from "./runtime-tools";

export async function createAgentResourceLoader(
  cwd: string,
  settingsManager: SettingsManager,
  extensionFactories: InlineExtension[],
): Promise<DefaultResourceLoader> {
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getPiCliAgentDir(),
    settingsManager,
    extensionFactories: [
      {
        name: "codemode",
        builtin: true,
        replaceable: true,
        factory: withRuntimeToolPolicy(createCodemodeExtension()),
      },
      {
        name: "tool-search",
        builtin: true,
        replaceable: true,
        factory: withRuntimeToolPolicy(createToolSearchExtension()),
      },
      { name: "mcp", builtin: true, replaceable: true, factory: createModusMcpExtension() },
      ...extensionFactories,
    ],
  });
  await loader.reload();
  return loader;
}
