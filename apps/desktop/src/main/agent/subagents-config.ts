import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type {
  ConfigScope,
  CreateSubagentInput,
  SubagentDetail,
  SubagentInfo,
  UpdateSubagentInput,
} from "../../shared/contracts";
import { normalizeSkillName, parseFrontmatter } from "../skills/skills-config";
import { listModels } from "./model-service";

const USER_AGENT_FAMILIES = [".codex", ".claude", ".cursor", ".modus"] as const;
const WORKSPACE_AGENT_FAMILIES = [".codex", ".claude", ".cursor", ".modus"] as const;
const SUBAGENTS_MANIFEST_BUDGET = 8000;

type AgentRoot = { dir: string; source: string; scope: ConfigScope };
type FrontmatterValue = string | string[];

export type ParsedSubagent = {
  name: string;
  description: string;
  model: string;
  readOnly: boolean;
  tools?: string[];
  disallowedTools?: string[];
  isolation: "shared" | "worktree";
  body: string;
};

export function parseSubagent(text: string, fallbackName: string): ParsedSubagent {
  const { data, body } = parseFrontmatter(text);
  const name = normalizeSkillName(
    (typeof data.name === "string" && data.name.trim()) || fallbackName,
  );
  const description =
    (typeof data.description === "string" && foldPlainScalar(data.description.split(/\r?\n/))) ||
    firstNonHeadingLine(body) ||
    "";
  const tools = asStringArray(data.tools);
  const disallowedTools = asStringArray(data.disallowedtools ?? data["disallowed-tools"]);
  return {
    name,
    description,
    model: scalar(data.model)?.trim() || "inherit",
    readOnly: asBoolean(data.readonly, false),
    ...(tools ? { tools } : {}),
    ...(disallowedTools ? { disallowedTools } : {}),
    isolation: asIsolation(data.isolation),
    body,
  };
}

export function subagentRoots(cwd: string, home: string = homedir()): AgentRoot[] {
  const roots: AgentRoot[] = [];
  for (const family of USER_AGENT_FAMILIES) {
    roots.push({ dir: join(home, family, "agents"), source: family, scope: "user" });
  }
  for (const family of WORKSPACE_AGENT_FAMILIES) {
    roots.push({ dir: join(cwd, family, "agents"), source: family, scope: "workspace" });
  }
  return roots;
}

export function loadWorkspaceSubagents(cwd: string, home: string = homedir()): SubagentDetail[] {
  const byName = new Map<string, SubagentDetail>();
  for (const root of subagentRoots(cwd, home)) {
    for (const file of subagentFilesIn(root)) {
      const subagent = loadSubagentFromFile(file, root);
      if (subagent) {
        byName.set(subagent.name, subagent);
      }
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function loadSubagentsForSettings(cwd: string, home: string = homedir()): SubagentDetail[] {
  return subagentRoots(cwd, home)
    .flatMap((root) =>
      subagentFilesIn(root).flatMap((file) => {
        const subagent = loadSubagentFromFile(file, root);
        return subagent ? [subagent] : [];
      }),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveSubagent(cwd: string, name: string): SubagentDetail | undefined {
  const normalized = normalizeSkillName(name);
  return loadWorkspaceSubagents(cwd).find((subagent) => subagent.name === normalized);
}

export function getSubagent(cwd: string, path: string): SubagentDetail | undefined {
  const fullPath = resolve(path);
  if (!isManagedSubagentPath(cwd, fullPath)) {
    return undefined;
  }
  let text: string;
  try {
    text = readFileSync(fullPath, "utf8");
  } catch {
    return undefined;
  }
  const root = subagentRoots(cwd).find((item) => isPathInside(item.dir, fullPath));
  if (!root) {
    return undefined;
  }
  return toSubagentDetail(parseSubagent(text, basename(fullPath, ".md")), fullPath, root);
}

export function createSubagent(input: CreateSubagentInput): SubagentInfo {
  const name = normalizeSkillName(input.name);
  if (!name) {
    throw new Error("Subagent name must contain at least one letter or number.");
  }
  const dir = subagentsDir(input.cwd, input.scope);
  const path = join(dir, `${name}.md`);
  if (existsSync(path)) {
    throw new Error(`A subagent named "${name}" already exists in this location.`);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, renderSubagentFile({ ...input, name }), "utf8");
  const created = getSubagent(input.cwd, path);
  if (!created) {
    throw new Error("Failed to create subagent.");
  }
  return toSubagentInfo(created);
}

export function updateSubagent(input: UpdateSubagentInput): SubagentInfo {
  const existing = getSubagent(input.cwd, input.path);
  if (!existing) {
    throw new Error("Subagent file is not in a known agents directory.");
  }
  writeFileSync(existing.path, renderSubagentFile(input), "utf8");
  const updated = getSubagent(input.cwd, existing.path);
  if (!updated) {
    throw new Error("Failed to update subagent.");
  }
  return toSubagentInfo(updated);
}

export function deleteSubagent(cwd: string, path: string): SubagentInfo[] {
  const existing = getSubagent(cwd, path);
  if (!existing) {
    throw new Error("Subagent file is not in a known agents directory.");
  }
  if (!existing.deletable) {
    throw new Error("Only Modus-managed subagents can be deleted from Settings.");
  }
  unlinkSync(existing.path);
  return listSubagents(cwd);
}

export function listSubagents(cwd: string, home: string = homedir()): SubagentInfo[] {
  return loadSubagentsForSettings(cwd, home).map(toSubagentInfo);
}

function composerModelsForPrompt(): Array<{ id: string; name: string }> {
  try {
    return listModels().map((model) => ({ id: model.id, name: model.name }));
  } catch {
    return [];
  }
}

export function resolveSubagentsPrompt(
  cwd: string,
  models: ReadonlyArray<{ id: string; name: string }> = composerModelsForPrompt(),
): string {
  const subagents = loadWorkspaceSubagents(cwd);
  const modelLines = [
    "### Available models",
    "Optional `task.model` must be an exact catalog id from this composer list; omit to inherit the parent model.",
    ...models.map((model) => `- ${model.id} — ${model.name}`),
  ];
  if (subagents.length === 0) {
    return [
      "## Subagents",
      "No configured subagents are available. Use `task` without the `subagent` field for generic delegation; do not invent subagent names.",
      "`task` starts a child and returns immediately; collect results with `wait` in the same turn — do not block inside `task`.",
      "",
      ...modelLines,
    ].join("\n");
  }
  const lines = [
    "## Subagents",
    "Subagents are local Markdown-defined specialists. Set the `subagent` field only to an exact name listed below; otherwise omit it for generic task delegation.",
    "`task` starts a child and returns immediately; collect results with `wait` in the same turn — do not block inside `task`.",
    "If the user starts a message with `/name` and `name` is listed below, invoke that subagent.",
    "",
    "### Available subagents",
    ...subagents.map((agent) => {
      const flags = [
        agent.model && agent.model !== "inherit" ? `model=${agent.model}` : "model=inherit",
        agent.readOnly ? "readonly" : undefined,
        agent.tools?.length ? `tools=${agent.tools.join("|")}` : undefined,
        agent.disallowedTools?.length ? `disallowed=${agent.disallowedTools.join("|")}` : undefined,
        agent.isolation === "worktree" ? "isolation=worktree" : undefined,
      ].filter(Boolean);
      return agent.description
        ? `- ${agent.name}: ${agent.description} (${flags.join(", ")})`
        : `- ${agent.name}: (${flags.join(", ")})`;
    }),
    "",
    ...modelLines,
  ];
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const next = used + line.length + 1;
    if (next > SUBAGENTS_MANIFEST_BUDGET) break;
    kept.push(line);
    used = next;
  }
  return kept.join("\n");
}

export function subagentsDir(
  cwd: string,
  scope: ConfigScope = "workspace",
  home: string = homedir(),
): string {
  return scope === "user" ? join(home, ".modus", "agents") : join(cwd, ".modus", "agents");
}

export function ensureSubagentsDir(cwd: string, scope: ConfigScope = "workspace"): string {
  const dir = subagentsDir(cwd, scope);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function subagentFilesIn(root: AgentRoot): Array<{ path: string; fallbackName: string }> {
  if (!existsSync(root.dir)) {
    return [];
  }
  let entries: string[];
  try {
    entries = readdirSync(root.dir).sort();
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(root.dir, entry);
    try {
      if (statSync(path).isFile() && entry.toLowerCase().endsWith(".md")) {
        return [{ path, fallbackName: basename(entry, ".md") }];
      }
    } catch {
      return [];
    }
    return [];
  });
}

function loadSubagentFromFile(
  file: { path: string; fallbackName: string },
  root: AgentRoot,
): SubagentDetail | undefined {
  let text: string;
  try {
    text = readFileSync(file.path, "utf8");
  } catch {
    return undefined;
  }
  const parsed = parseSubagent(text, file.fallbackName);
  if (!parsed.name) {
    return undefined;
  }
  return toSubagentDetail(parsed, file.path, root);
}

function toSubagentDetail(parsed: ParsedSubagent, path: string, root: AgentRoot): SubagentDetail {
  return {
    name: parsed.name,
    description: parsed.description,
    scope: root.scope,
    source: root.source,
    path,
    model: parsed.model,
    readOnly: parsed.readOnly,
    ...(parsed.tools ? { tools: parsed.tools } : {}),
    ...(parsed.disallowedTools ? { disallowedTools: parsed.disallowedTools } : {}),
    isolation: parsed.isolation,
    editable: true,
    deletable: root.source === ".modus",
    body: parsed.body,
  };
}

function toSubagentInfo(subagent: SubagentDetail): SubagentInfo {
  const { body: _body, ...info } = subagent;
  return info;
}

function renderSubagentFile(input: CreateSubagentInput): string {
  const name = normalizeSkillName(input.name);
  const model = input.model?.trim() || "inherit";
  const lines = [
    "---",
    `name: ${name}`,
    `description: ${frontmatterScalar(input.description)}`,
    `model: ${frontmatterScalar(model)}`,
    `readonly: ${input.readOnly ? "true" : "false"}`,
  ];
  if (input.tools?.length) {
    lines.push(`tools: [${input.tools.map(frontmatterScalar).join(", ")}]`);
  }
  if (input.disallowedTools?.length) {
    lines.push(`disallowedTools: [${input.disallowedTools.map(frontmatterScalar).join(", ")}]`);
  }
  if (input.isolation === "worktree") {
    lines.push("isolation: worktree");
  }
  lines.push("---", "", input.body.trim(), "");
  return lines.join("\n");
}

function isManagedSubagentPath(cwd: string, path: string): boolean {
  return subagentRoots(cwd).some((root) => isPathInside(root.dir, path));
}

function isPathInside(root: string, path: string): boolean {
  const diff = relative(resolve(root), resolve(path));
  return diff === "" || (!!diff && !diff.startsWith("..") && !isAbsolute(diff));
}

function scalar(value: FrontmatterValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: FrontmatterValue | undefined, fallback: boolean): boolean {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return fallback;
}

function asStringArray(value: FrontmatterValue | undefined): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.map((item) => item.trim()).filter(Boolean);
    return items.length > 0 ? items : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return undefined;
}

function asIsolation(value: FrontmatterValue | undefined): "shared" | "worktree" {
  return scalar(value)?.trim() === "worktree" ? "worktree" : "shared";
}

function foldPlainScalar(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function firstNonHeadingLine(body: string): string | undefined {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      return trimmed.length > 200 ? `${trimmed.slice(0, 197)}…` : trimmed;
    }
  }
  return undefined;
}

function frontmatterScalar(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}
