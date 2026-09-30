import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
} from "@earendil-works/pi-coding-agent";
import { dialog } from "electron";
import { getPiCliAgentDir, modusAgentDir } from "./agent-paths";
import { createAgentSettings } from "./agent-settings";

export async function resolveProjectTrust(cwd: string): Promise<boolean> {
  const store = new ProjectTrustStore(modusAgentDir());
  const decision = store.get(cwd) ?? new ProjectTrustStore(getPiCliAgentDir()).get(cwd);
  if (decision !== null) return decision;
  const defaults = createAgentSettings().getDefaultProjectTrust();
  if (defaults === "always") return true;
  if (defaults === "never") return false;
  if (!hasTrustRequiringProjectResources(cwd) && !existsSync(join(cwd, ".modus"))) return false;
  const result = await dialog.showMessageBox({
    type: "question",
    message: "Trust this project's agent resources?",
    detail: `${cwd}\n\nProject settings, extensions, skills, and MCP servers can run code on your computer.`,
    buttons: ["Trust project", "Continue without project resources"],
    defaultId: 1,
    cancelId: 1,
  });
  const trusted = result.response === 0;
  store.set(cwd, trusted);
  return trusted;
}
