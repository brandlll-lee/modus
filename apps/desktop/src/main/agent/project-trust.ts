import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  getPackageDir,
  type LoadExtensionsResult,
  type ProjectTrustContext,
  ProjectTrustStore,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { getPiCliAgentDir } from "./agent-paths";

export async function resolveProjectTrust(
  cwd: string,
  settings: SettingsManager,
  extensionsResult: LoadExtensionsResult,
  context: ProjectTrustContext,
): Promise<boolean> {
  const native = await import(
    pathToFileURL(join(getPackageDir(), "dist/core/project-trust.js")).href
  );
  return native.resolveProjectTrusted({
    cwd,
    trustStore: new ProjectTrustStore(getPiCliAgentDir()),
    defaultProjectTrust: settings.getDefaultProjectTrust(),
    extensionsResult,
    projectTrustContext: context,
    onExtensionError: (message: string) => context.ui.notify(message, "warning"),
  });
}
