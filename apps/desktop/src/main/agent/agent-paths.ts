import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

let inheritedAgentDir: string | undefined;

export function getPiCliAgentDir(): string {
  return inheritedAgentDir ?? getAgentDir();
}

export function modusAgentDir(): string {
  return join(homedir(), ".modus", "agent");
}

export function configurePiHost(): void {
  inheritedAgentDir = getAgentDir();
  process.env.PI_CODING_AGENT_DIR = modusAgentDir();
}
