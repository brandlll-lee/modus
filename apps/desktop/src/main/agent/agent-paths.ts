import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { app } from "electron";

let inheritedAgentDir: string | undefined;

export function getPiCliAgentDir(): string {
  return inheritedAgentDir ?? getAgentDir();
}

export function modusAgentDir(): string {
  const path = join(app.getPath("userData"), "pi-agent");
  mkdirSync(path, { recursive: true });
  return path;
}

export function configurePiHost(): void {
  inheritedAgentDir = getAgentDir();
  process.env.PI_CODING_AGENT_DIR = modusAgentDir();
}

export function getModusDeviceId(): string {
  const directory = modusAgentDir();
  return SettingsManager.create(directory, directory).getOrCreateDeviceId();
}
