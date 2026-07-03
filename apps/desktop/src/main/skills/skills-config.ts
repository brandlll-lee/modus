import { existsSync, readdirSync, readFileSync, type Stats, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { SkillDetail, SkillInfo, SkillScope } from "../../shared/contracts";

/**
 * Agent Skills discovery — pure functions, unit-testable without Electron.
 *
 * On-disk format is the portable `SKILL.md` standard so skills authored for
 * Claude / Cursor / opencode work verbatim:
 *
 *   ---
 *   name: code-review
 *   description: Review a diff for correctness and security
 *   ---
 *   <markdown instructions…>
 *
 * A skill is either a folder `<root>/<name>/SKILL.md` (preferred) or a flat
 * file `<root>/<name>.md`. Roots are scanned per workspace and per user.
 *
 * Search order (later sources win on name conflicts → workspace beats user,
 * and `.modus` beats interop folders). Built-in skills load first as Modus
 * defaults, then disappear when a user/workspace skill has the same name:
 *   builtin:   Modus bundled resources/skills
 *   user:      ~/.claude/skills, ~/.modus/skills
 *   workspace: .agents/skills, .opencode/skills, .claude/skills,
 *              .cursor/skills, .modus/skills
 */

/** Skill root families, lowest precedence first. */
const USER_SKILL_FAMILIES = [".claude", ".modus"] as const;
const WORKSPACE_SKILL_FAMILIES = [".agents", ".opencode", ".claude", ".cursor", ".modus"] as const;
const MAX_SKILL_SCAN_DEPTH = 8;
const MAX_SKILL_SCAN_DIRS = 2000;
const BUILTIN_SKILL_SOURCE = "builtin";

export type ParsedSkill = {
  name: string;
  description: string;
  body: string;
  allowImplicitInvocation: boolean;
  allowedTools?: string[];
};

type FrontmatterValue = string | string[];

/**
 * Minimal, dependency-free frontmatter parser for the small subset SKILL.md
 * files use: `key: value` scalars, `key: [a, b]` inline lists, `-` block
 * lists, and indented multiline scalars. Anything else in the block is ignored
 * rather than throwing.
 */
export function parseFrontmatter(text: string): {
  data: Record<string, FrontmatterValue>;
  body: string;
} {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) {
    return { data: {}, body: text.replace(/^\uFEFF/, "") };
  }
  const [, block, body] = match;
  const data: Record<string, FrontmatterValue> = {};
  const lines = (block ?? "").split(/\r?\n/);
  let pendingKey: string | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      continue;
    }
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && pendingKey) {
      const current = data[pendingKey];
      const value = unquote(listItem[1] ?? "");
      data[pendingKey] = Array.isArray(current) ? [...current, value] : [value];
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) {
      continue;
    }
    const key = (kv[1] ?? "").toLowerCase();
    const rest = (kv[2] ?? "").trim();
    if (isBlockScalarMarker(rest)) {
      const scalar = collectIndentedBlock(lines, index + 1);
      data[key] = rest.startsWith(">")
        ? foldBlockScalar(scalar.lines)
        : scalar.lines.join("\n").trim();
      pendingKey = undefined;
      index = scalar.nextIndex - 1;
      continue;
    }
    if (rest === "") {
      const scalar = collectIndentedBlock(lines, index + 1);
      if (scalar.lines.length > 0 && !scalar.lines.some((item) => /^\s*-\s+/.test(item))) {
        data[key] = foldPlainScalar(scalar.lines);
        pendingKey = undefined;
        index = scalar.nextIndex - 1;
        continue;
      }
      // A bare "key:" begins a block list on following lines.
      pendingKey = key;
      data[key] = [];
      continue;
    }
    pendingKey = undefined;
    if (rest.startsWith("[") && rest.endsWith("]")) {
      data[key] = rest
        .slice(1, -1)
        .split(",")
        .map((item) => unquote(item.trim()))
        .filter(Boolean);
      continue;
    }
    data[key] = unquote(rest);
  }

  return { data, body: (body ?? "").trim() };
}

function isBlockScalarMarker(value: string): boolean {
  return /^[|>][+-]?$/.test(value);
}

function collectIndentedBlock(
  lines: string[],
  startIndex: number,
): { lines: string[]; nextIndex: number } {
  const collected: string[] = [];
  let minIndent: number | undefined;
  let index = startIndex;

  for (; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    if (!raw.trim()) {
      if (collected.length > 0) {
        collected.push("");
      }
      continue;
    }
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;
    if (indent === 0) {
      break;
    }
    minIndent = Math.min(minIndent ?? indent, indent);
    collected.push(raw.replace(/\s+$/, ""));
  }

  const indent = minIndent ?? 0;
  return {
    lines: collected.map((line) => (line ? line.slice(Math.min(indent, line.length)) : line)),
    nextIndex: index,
  };
}

function foldBlockScalar(lines: string[]): string {
  return lines
    .join("\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, " "))
    .join("\n\n")
    .trim();
}

function foldPlainScalar(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function asStringArray(value: FrontmatterValue | undefined): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.filter((item) => item.trim().length > 0);
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

function asBoolean(value: FrontmatterValue | undefined, fallback: boolean): boolean {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return fallback;
}

/** Parse a SKILL.md document. `fallbackName` is used when frontmatter omits `name`. */
export function parseSkill(text: string, fallbackName: string): ParsedSkill {
  const { data, body } = parseFrontmatter(text);
  const name = normalizeSkillName(
    (typeof data.name === "string" && data.name.trim()) || fallbackName,
  );
  const description =
    (typeof data.description === "string" && foldPlainScalar(data.description.split(/\r?\n/))) ||
    firstNonHeadingLine(body) ||
    "";
  const allowedTools = asStringArray(data["allowed-tools"] ?? data.tools);
  const allowImplicitInvocation = asBoolean(data["allow-implicit-invocation"], true);
  return {
    name,
    description,
    body,
    allowImplicitInvocation,
    ...(allowedTools ? { allowedTools } : {}),
  };
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

/** Normalize any human name to a kebab-case slash name. */
export function normalizeSkillName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type SkillRoot = { dir: string; source: string; scope: SkillScope };

export function defaultBuiltinSkillsDir(): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    resourcesPath ? join(resourcesPath, "skills") : undefined,
    join(process.cwd(), "resources", "skills"),
    join(process.cwd(), "apps", "desktop", "resources", "skills"),
  ].filter((dir): dir is string => Boolean(dir));
  return candidates.find((dir) => existsSync(dir)) ?? join(process.cwd(), "resources", "skills");
}

/** Candidate skill roots for a workspace, lowest precedence first. */
export function skillRoots(
  cwd: string,
  home: string = homedir(),
  builtinDir: string = defaultBuiltinSkillsDir(),
): SkillRoot[] {
  const roots: SkillRoot[] = [{ dir: builtinDir, source: BUILTIN_SKILL_SOURCE, scope: "builtin" }];
  for (const family of USER_SKILL_FAMILIES) {
    roots.push({ dir: join(home, family, "skills"), source: family, scope: "user" });
  }
  for (const family of WORKSPACE_SKILL_FAMILIES) {
    roots.push({ dir: join(cwd, family, "skills"), source: family, scope: "workspace" });
  }
  return roots;
}

/** Locate skill files inside a root, supporting top-level flat files plus nested SKILL.md. */
function skillFilesIn(root: SkillRoot): Array<{ path: string; fallbackName: string }> {
  if (!existsSync(root.dir)) {
    return [];
  }
  const files: Array<{ path: string; fallbackName: string }> = [];
  const pending: Array<{ dir: string; depth: number }> = [{ dir: root.dir, depth: 0 }];
  let visited = 0;

  while (pending.length > 0 && visited < MAX_SKILL_SCAN_DIRS) {
    const current = pending.shift();
    if (!current) {
      break;
    }
    visited += 1;
    let currentEntries: string[];
    try {
      currentEntries = readdirSync(current.dir);
    } catch {
      continue;
    }

    for (const entry of currentEntries) {
      const full = join(current.dir, entry);
      let stat: Stats;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }

      if (!stat.isDirectory()) {
        if (
          current.depth === 0 &&
          entry.toLowerCase().endsWith(".md") &&
          entry.toLowerCase() !== "readme.md"
        ) {
          files.push({ path: full, fallbackName: basename(entry, ".md") });
        }
        continue;
      }

      const skillFile = join(full, "SKILL.md");
      if (existsSync(skillFile)) {
        files.push({ path: skillFile, fallbackName: entry });
      }
      if (current.depth < MAX_SKILL_SCAN_DEPTH) {
        pending.push({ dir: full, depth: current.depth + 1 });
      }
    }
  }
  return files;
}

function loadSkillFromFile(
  file: { path: string; fallbackName: string },
  root: SkillRoot,
): SkillDetail | undefined {
  let text: string;
  try {
    text = readFileSync(file.path, "utf8");
  } catch {
    return undefined;
  }
  const parsed = parseSkill(text, file.fallbackName);
  if (!parsed.name) {
    return undefined;
  }
  return {
    name: parsed.name,
    description: parsed.description,
    scope: root.scope,
    source: root.source,
    path: file.path,
    enabled: true,
    allowImplicitInvocation: parsed.allowImplicitInvocation,
    ...(parsed.allowedTools ? { allowedTools: parsed.allowedTools } : {}),
    body: parsed.body,
  };
}

/** Discover + merge every skill visible from this workspace (and the user home). */
export function loadWorkspaceSkills(
  cwd: string,
  home: string = homedir(),
  builtinDir: string = defaultBuiltinSkillsDir(),
): SkillDetail[] {
  const skills: SkillDetail[] = [];
  for (const root of skillRoots(cwd, home, builtinDir)) {
    for (const file of skillFilesIn(root)) {
      const skill = loadSkillFromFile(file, root);
      if (skill) {
        skills.push(skill);
      }
    }
  }
  const overriddenBuiltinNames = new Set(
    skills.filter((skill) => skill.scope !== "builtin").map((skill) => skill.name),
  );
  return skills
    .filter((skill) => skill.scope !== "builtin" || !overriddenBuiltinNames.has(skill.name))
    .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}

export function toSkillInfo(skill: SkillDetail): SkillInfo {
  const { body: _body, ...info } = skill;
  return info;
}
