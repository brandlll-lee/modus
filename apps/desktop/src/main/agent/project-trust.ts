import {
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
} from "@earendil-works/pi-coding-agent";
import { dialog } from "electron";
import { getPiCliAgentDir } from "./agent-paths";
import { createAgentSettings } from "./agent-settings";

export async function resolveProjectTrust(cwd: string): Promise<boolean> {
  const store = new ProjectTrustStore(getPiCliAgentDir());
  const decision = store.get(cwd);
  if (decision !== null) return decision;
  const defaults = createAgentSettings().getDefaultProjectTrust();
  if (defaults === "always") return true;
  if (defaults === "never") return false;
  if (!hasTrustRequiringProjectResources(cwd)) return false;
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
