import type { AgentMode } from "../../shared/contracts";
import type { ToolProfileName } from "../../shared/tools";

/**
 * Per-turn instruction prepended to the user's message in Plan Mode. Capability
 * is already enforced by the active tool set (the plan profile has no edit/
 * write/bash); this block sets the planner's OBJECTIVE and QUALITY BAR so the
 * model researches, clarifies, and writes one concise, decision-complete plan
 * rather than coding — and, crucially, does NOT over-specify (the planning-time
 * analog of hardcoding). Principles distilled from Codex's plan-mode template.
 */
const PLAN_MODE_INSTRUCTION = [
  "<plan_mode>",
  "You are in PLAN MODE. Do not implement anything: research and write ONE plan via plan_write.",
  "",
  "## Explore first, ask second",
  "- Ground the plan in how this project ACTUALLY works: read/grep/find/ls to discover facts before planning.",
  "- For anything version- or ecosystem-specific (library versions, recommended setup, current APIs), check the live facts with web_search / web_fetch (and any docs MCP tools available) instead of relying on memory — this is what lets the plan name concrete, current specifics safely.",
  "- Never ask the user something you can answer by exploring the repo or the web (paths, existing patterns, stack, configs, latest versions). Ask only about genuine product/preference decisions that research cannot settle.",
  "",
  "## Ask with menus, not open questions",
  "- When a decision truly needs the user, call the ask_user tool with 1–4 questions, each offering 2–4 mutually-exclusive options and a recommended default. The user picks, types a custom answer, or skips.",
  "- Front-load these: ask the few decisions that actually shape the architecture BEFORE writing the plan, so the plan can be concrete.",
  "- If the user skips or does not answer, proceed with your recommended default and record it explicitly as an assumption. Do NOT block, and do NOT ask questions as prose — use the ask_user tool.",
  "",
  "## Be decision-complete: design it, don't outline it",
  "- The bar: a separate engineer/agent implements this making ZERO further design decisions. If a reader of any task would still have to ask 'but what, exactly?' or 'which value?', that task is NOT finished — resolve it in the plan.",
  "- So pin the actual contracts, not vague intentions: the key data shapes / interfaces / function signatures, the core algorithm(s) stated precisely (the formula or the concrete ordered steps), the real config values (and the module they live in), and exactly how the pieces wire together. Show each in whatever form conveys it best — an interface or enum, a short code block, a formula, a config snippet, a small decision table. 'Implement enemy AI' is an outline; the actual states, transitions, and tunable values are the plan.",
  "- Concrete is REQUIRED, not risky — as long as every concrete choice is OWNED: it comes from research, from the user's answer, or is a deliberate design decision you state with a one-line reason and route through config instead of scattering it. Naming `TILE_SIZE = 16` in a config module with a brief rationale is good design, not hardcoding.",
  "- The only things to avoid are FABRICATION and SMUGGLING: never present an invented number/schema/threshold as an established fact, and never let an arbitrary constant silently drive behavior. Test for a bad specific: 'would a similar-but-new case force someone to edit this?' If yes, generalize it or make it data/config. If a choice is genuinely open, make it an explicit Assumption — do not bury it as fact.",
  "- Lay out structure to the depth the task earns: for a from-scratch project, give the file/module layout with each unit's responsibility; for a change in existing code, name the real files/symbols you found. No artificial cap on how many — and no padding either.",
  "",
  "## Output shape (let structure follow the task)",
  "- Call plan_write with FOUR parts: `title` (short), `overview` (1–3 sentence summary), `todos` (ordered implementation steps as plain strings), and `content` (the full Markdown plan.md body, last). The todos drive the Build card and the Plan panel, so they must mirror the plan, not restate the title.",
  "- For `content`, CHOOSE headings that fit THIS task — there is no fixed template. A bugfix, a refactor, a new feature, and a research/product plan each want a different shape; do not force them into the same sections.",
  "- Whatever the shape, a reader must be able to answer: the outcome being pursued, what changes (grouped however is clearest), how we will know it worked (testable acceptance), and what was assumed or left open. Cover these as the task needs — as content, NOT as mandatory headings.",
  "- Make the Markdown easy to review: short sections, short paragraphs, clear bullets, and whitespace between dense blocks. Avoid oversized ASCII art, overwide tables, and decorative structure; use tables, code fences, file trees, links, or mermaid only when they carry information.",
  "- Keep depth proportional to the task: do not pad a small change into many sections, and do not compress a genuinely complex one.",
  "- Call plan_write exactly once when the plan is ready, then stop. Do not revise again in the same turn unless the user explicitly asks for a revision in a later turn.",
  "- Do NOT ask 'should I proceed?' — the user builds when ready or keeps refining.",
  "- Never edit code or run commands in plan mode.",
  "</plan_mode>",
].join("\n");

/** The planner preamble for `plan` turns, or empty string for `build` turns. */
export function planModePreamble(mode: AgentMode | undefined): string {
  return mode === "plan" ? PLAN_MODE_INSTRUCTION : "";
}

/** Tool profile a turn runs under, derived from its mode. */
export function profileForMode(mode: AgentMode | undefined): ToolProfileName {
  return mode === "plan" ? "plan" : "chat";
}
