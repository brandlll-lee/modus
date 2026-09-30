import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

/**
 * Agent settings layering — PI CLI config first, Modus overrides on top.
 *
 * Modus is a desktop front end for the PI kernel, not a rival agent. A machine
 * that already uses the PI CLI has its provider, compaction, retry, proxy,
 * and shell choices in `~/.pi/agent/settings.json`; those are the authoritative
 * user intent and Modus inherits them.
 *
 * `agentDir` stays inside Modus's own userData, so models.json, auth.json, and
 * sessions never share a file with the CLI. Both installations can run at once.
 *
 * Only Modus-owned files are ever written. The PI settings file is read and
 * folded into memory via `applyOverrides`, which performs no file I/O.
 */
export type AgentSettingsInput = {
  /** Modus overrides. Applied last, so they win over inherited PI values. */
  overrides?: Record<string, unknown>;
};

/** Parse a settings document, treating any read/parse failure as "not configured". */
export function readSettingsFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Build the session settings manager: PI CLI settings as the base layer, then
 * Modus overrides. Uses the in-memory manager so nothing is persisted and the
 * CLI's own project settings are never touched.
 */
export function createAgentSettings(input: AgentSettingsInput = {}): SettingsManager {
  const manager = SettingsManager.inMemory();
  manager.applyOverrides(readSettingsFile(join(getAgentDir(), "settings.json")));
  if (input.overrides) {
    manager.applyOverrides(input.overrides);
  }
  return manager;
}
