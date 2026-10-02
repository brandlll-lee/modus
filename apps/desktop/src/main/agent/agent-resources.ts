import type { ProjectTrustContext } from "@earendil-works/pi-coding-agent";
import {
  createCodemodeExtension,
  createToolSearchExtension,
  DefaultResourceLoader,
  type InlineExtension,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createModusMcpExtension } from "../mcp/mcp-service";
import { getPiCliAgentDir } from "./agent-paths";
import { resolveProjectTrust } from "./project-trust";

export async function createAgentResourceLoader(
  cwd: string,
  settingsManager: SettingsManager,
  extensionFactories: InlineExtension[],
  projectTrustContext: ProjectTrustContext,
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
        factory: createCodemodeExtension(),
      },
      {
        name: "tool-search",
        builtin: true,
        replaceable: true,
        factory: createToolSearchExtension(),
      },
      { name: "mcp", builtin: true, replaceable: true, factory: createModusMcpExtension() },
      ...extensionFactories,
    ],
  });
  await loader.reload({
    resolveProjectTrust: ({ extensionsResult }) =>
      resolveProjectTrust(cwd, settingsManager, extensionsResult, projectTrustContext),
  });
  return loader;
}
