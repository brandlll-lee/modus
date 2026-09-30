import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import { getPiCliAgentDir, modusAgentDir } from "./agent-paths";

export function readConfigObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const value: unknown = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path}: expected an object.`);
  return value as Record<string, unknown>;
}

export function modelConfigFiles(): string[] {
  return [join(getPiCliAgentDir(), "models.json"), join(modusAgentDir(), "models.json")];
}

export function prepareModelConfig(): {
  path: string;
  sources: Map<string, string>;
  isolated: Set<string>;
} {
  const providers: Record<string, unknown> = {};
  const sources = new Map<string, string>();
  const isolated = new Set<string>();
  for (const [index, source] of modelConfigFiles().entries()) {
    const document = readConfigObject(source);
    const entries = document.providers;
    if (entries === undefined) continue;
    if (!entries || typeof entries !== "object" || Array.isArray(entries))
      throw new Error(`${source}: providers must be an object.`);
    for (const [id, entry] of Object.entries(entries)) {
      providers[id] = entry;
      sources.set(id, source);
      if (index > 0) isolated.add(id);
    }
  }
  const path = join(app.getPath("userData"), "pi-cache", "models.json");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify({ providers }, null, 2)}\n`, { mode: 0o600 });
  return { path, sources, isolated };
}
