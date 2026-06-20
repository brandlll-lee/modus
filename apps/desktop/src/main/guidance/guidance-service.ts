import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { PersonalizationState } from "../../shared/contracts";

const BASE_FILE = "AGENTS.md";
const OVERRIDE_FILE = "AGENTS.override.md";
const MAX_GUIDANCE_BYTES = 24 * 1024;

export function personalizationDir(): string {
  return join(homedir(), ".modus");
}

function paths(
  root = personalizationDir(),
): Pick<PersonalizationState, "basePath" | "overridePath"> {
  return {
    basePath: join(root, BASE_FILE),
    overridePath: join(root, OVERRIDE_FILE),
  };
}

function readFile(path: string): string | undefined {
  try {
    return statSync(path).isFile() ? readFileSync(path, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

function activePath(root?: string): string {
  const { basePath, overridePath } = paths(root);
  return readFile(overridePath)?.trim() ? overridePath : basePath;
}

export function getPersonalization(root?: string): PersonalizationState {
  const { basePath, overridePath } = paths(root);
  const active = activePath(root);
  return {
    basePath,
    overridePath,
    activePath: active,
    overrideActive: active === overridePath,
    content: readFile(active) ?? "",
  };
}

export function savePersonalization(content: string, root?: string): PersonalizationState {
  const path = activePath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return getPersonalization(root);
}

export function ensurePersonalizationFile(root?: string): string {
  const state = getPersonalization(root);
  mkdirSync(dirname(state.activePath), { recursive: true });
  if (!existsSync(state.activePath)) {
    writeFileSync(state.activePath, state.content, "utf8");
  }
  return state.activePath;
}

export function resolveGlobalGuidancePrompt(root?: string): string | undefined {
  const state = getPersonalization(root);
  let body = state.content.trim();
  if (!body) {
    return undefined;
  }
  if (Buffer.byteLength(body, "utf8") > MAX_GUIDANCE_BYTES) {
    body = `${Buffer.from(body, "utf8").subarray(0, MAX_GUIDANCE_BYTES).toString("utf8")}\n...(global guidance truncated)`;
  }
  return `<global_guidance>
The user has provided global personal instructions. Follow them along with workspace instructions.
Source: ${state.activePath}
${body}
</global_guidance>`;
}
