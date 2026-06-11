import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { RuleFileInfo, RuleMode, RuleSource } from "../../shared/contracts";

/**
 * Project rules (M0) — Cursor-compatible automatic instructions.
 *
 * Detected sources, in precedence order:
 *   - AGENTS.md / CLAUDE.md at the workspace root (always applied)
 *   - .cursorrules (legacy, always applied)
 *   - .cursor/rules/**.mdc with frontmatter (`alwaysApply`, `globs`,
 *     `description`) — only `alwaysApply: true` rules are auto-injected;
 *     glob/intelligent/manual rules are listed for visibility and remain
 *     available through the manual `@rules` context attachment.
 *
 * Always-apply rules are injected into the session system prompt at session
 * assembly (create + resume), so they never bloat per-turn context.
 */

/** Per-file cap so one runaway rule can't eat the context window. */
const MAX_RULE_BYTES = 24 * 1024;
/** Total cap across all injected rules. */
const MAX_TOTAL_BYTES = 64 * 1024;
const MAX_RULE_FILES = 50;

type ParsedFrontmatter = {
  data: Record<string, string>;
  body: string;
};

/** Minimal .mdc frontmatter parser (string/boolean scalars only). Exported for tests. */
export function parseMdcFrontmatter(text: string): ParsedFrontmatter {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { data: {}, body: text };
  }
  const data: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key) {
      data[key] = value;
    }
  }
  return { data, body: text.slice(match[0].length) };
}

function ruleModeFor(data: Record<string, string>): RuleMode {
  if ((data.alwaysApply ?? "").toLowerCase() === "true") {
    return "always";
  }
  if (data.globs?.trim()) {
    return "glob";
  }
  if (data.description?.trim()) {
    return "intelligent";
  }
  return "manual";
}

function safeStatSize(path: string): number | undefined {
  try {
    const info = statSync(path);
    return info.isFile() ? info.size : undefined;
  } catch {
    return undefined;
  }
}

function collectMdcFiles(dir: string, depth = 0): string[] {
  if (depth > 3) {
    return [];
  }
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const name = String(entry.name);
    const path = join(dir, name);
    if (entry.isDirectory()) {
      files.push(...collectMdcFiles(path, depth + 1));
    } else if (entry.isFile() && name.endsWith(".mdc")) {
      files.push(path);
    }
  }
  return files.sort();
}

/** Every detected rule file with its apply mode — powers the Settings panel. */
export function listRuleFiles(cwd: string): RuleFileInfo[] {
  const rules: RuleFileInfo[] = [];

  const plain: Array<{ name: string; source: RuleSource }> = [
    { name: "AGENTS.md", source: "agents-md" },
    { name: "CLAUDE.md", source: "claude-md" },
    { name: ".cursorrules", source: "cursorrules" },
  ];
  for (const { name, source } of plain) {
    const path = join(cwd, name);
    const size = safeStatSize(path);
    if (size !== undefined) {
      rules.push({ path, relPath: name, source, mode: "always", size });
    }
  }

  for (const path of collectMdcFiles(join(cwd, ".cursor", "rules")).slice(0, MAX_RULE_FILES)) {
    const size = safeStatSize(path);
    if (size === undefined) {
      continue;
    }
    let data: Record<string, string> = {};
    try {
      ({ data } = parseMdcFrontmatter(readFileSync(path, "utf8")));
    } catch {
      // Unreadable rule files still show up in the list as manual.
    }
    const entry: RuleFileInfo = {
      path,
      relPath: relative(cwd, path).replaceAll("\\", "/"),
      source: "cursor-rule",
      mode: ruleModeFor(data),
      size,
    };
    if (data.description?.trim()) {
      entry.description = data.description.trim();
    }
    if (data.globs?.trim()) {
      entry.globs = data.globs.trim();
    }
    rules.push(entry);
  }

  return rules;
}

/**
 * The system-prompt block of always-applied rules, or undefined when the
 * workspace defines none. Re-read at every session create/resume.
 */
export function resolveAlwaysRulesPrompt(cwd: string): string | undefined {
  const sections: string[] = [];
  let total = 0;

  for (const rule of listRuleFiles(cwd)) {
    if (rule.mode !== "always") {
      continue;
    }
    let body: string;
    try {
      body = readFileSync(rule.path, "utf8");
    } catch {
      continue;
    }
    if (rule.source === "cursor-rule") {
      body = parseMdcFrontmatter(body).body;
    }
    body = body.trim();
    if (!body) {
      continue;
    }
    if (Buffer.byteLength(body, "utf8") > MAX_RULE_BYTES) {
      body = `${body.slice(0, MAX_RULE_BYTES)}\n…(rule truncated)`;
    }
    const section = `<rule source="${rule.relPath}">\n${body}\n</rule>`;
    total += Buffer.byteLength(section, "utf8");
    if (total > MAX_TOTAL_BYTES) {
      break;
    }
    sections.push(section);
  }

  if (sections.length === 0) {
    return undefined;
  }
  return `<project_rules>\nThe user has provided the following project instructions. Always follow them.\n${sections.join("\n\n")}\n</project_rules>`;
}
