import { homedir } from "node:os";
import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { getPiCliAgentDir } from "./agent-paths";

export function sessionDirectory(cwd: string): string | undefined {
  const configured = process.env.PI_CODING_AGENT_SESSION_DIR;
  if (configured)
    return configured.startsWith("~/") || configured.startsWith("~\\")
      ? join(homedir(), configured.slice(2))
      : configured;
  return SettingsManager.create(cwd, getPiCliAgentDir()).getSessionDir();
}
