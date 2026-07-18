import { join } from "node:path";
import {
  type AgentToolResult,
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { app } from "electron";
import { Type } from "typebox";
import { PLAN_TOOL_NAME, PLAN_TOOL_UI } from "../../../shared/tools";
import { writePlan } from "../../plan/plan-store";
import { toolRegistry } from "./registry";
import { resolveAgentToolContext } from "./tool-context";

/**
 * Plan Mode tool. In Plan Mode the agent is read-only on the codebase
 * (read/grep/find/ls) and its single write channel is `plan_write`, which
 * materializes one session-scoped plan artifact. Keeping the plan as the only
 * writable target is what makes Plan Mode safe without guarding every path —
 * the profile simply doesn't include edit/write/bash.
 *
 * Plans live under the app's user-data dir and are removed with their session.
 */

/** Shared plans root (`<userData>/plans`), reused by the runtime's build-state updates. */
export function plansRoot(): string {
  return join(app.getPath("userData"), "plans");
}

function toResult<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details };
}

const planParams = Type.Object(
  {
    title: Type.String({
      minLength: 1,
      description: "Short title for this plan.",
    }),
    overview: Type.String({
      minLength: 1,
      description:
        "One-paragraph summary of the approach (what gets built and how), shown as the plan's " +
        "subtitle in the Review card. Keep it to 1–3 sentences.",
    }),
    todos: Type.Array(
      Type.String({
        minLength: 1,
        description: "One implementation step, action-oriented.",
      }),
      {
        minItems: 1,
        description:
          "Ordered implementation steps as plain strings. These drive execution, so each step " +
          "must be a self-contained unit of work.",
      },
    ),
    blocks: Type.Array(
      Type.Union([
        Type.Object(
          {
            type: Type.Literal("markdown"),
            content: Type.String({ minLength: 1 }),
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            type: Type.Literal("visual"),
            title: Type.String({ minLength: 1 }),
            kind: Type.Union([Type.Literal("svg"), Type.Literal("html")]),
            content: Type.String({
              minLength: 1,
              description: "Complete self-contained SVG or HTML with inline CSS/JS.",
            }),
            fallback: Type.String({
              minLength: 1,
              description:
                "Complete textual description used by the executor without rendering the visual.",
            }),
          },
          { additionalProperties: false },
        ),
      ]),
      {
        minItems: 1,
        description:
          "Ordered plan body. Use markdown for prose and visual only when a diagram or interaction " +
          "communicates the design materially better.",
      },
    ),
  },
  { additionalProperties: false },
);

const planTool: ToolDefinition = defineTool({
  name: PLAN_TOOL_NAME,
  label: "Write plan",
  description:
    "Write or update the implementation plan for the current Plan Mode session. The plan is a " +
    "session-scoped sequence of Markdown and optional visual blocks. Its textual projection is the " +
    "source of truth used for execution. Research the codebase (read/grep/find/ls) " +
    "and resolve open questions with the user BEFORE writing, then call this once with the " +
    "complete plan. After a successful call, stop; only a later user revision request should " +
    "write a new version. Do not implement anything in Plan Mode.",
  promptSnippet:
    "plan_write(title, overview, todos, blocks) — write/update this session's single plan. " +
    "`blocks` is the ordered Markdown/Visual body and must be the final field.",
  promptGuidelines: [
    "Plan Mode is read-only on the codebase: research with read/grep/find/ls, never edit/run. Your only output is plan_write.",
    "Front-load clarifying questions so the plan is self-contained — a separate executor (or two parallel ones) must be able to build from it without asking the user again.",
    "Be decision-complete: pin the actual data shapes, signatures, algorithms (formula or precise steps), and config values an executor would otherwise have to invent — concrete and owned, never fabricated as fact.",
    "Keep the Markdown readable: use short sections, well-spaced lists, and diagrams/tables only when they clarify the plan.",
    "Use a visual block only when it materially improves review of a relationship, flow, dependency, state, comparison, or interaction; prefer one primary visual and never add one as decoration. Use SVG for static relationships and HTML only for real interaction.",
    "All human-readable visual copy — titles, labels, connectors, legends, annotations, controls, and fallback — must use the same language as the surrounding plan and current user request, or the language the user explicitly requested.",
    "Preserve file paths, API names, code identifiers, commands, and product names verbatim; do not translate or rewrite them.",
    "Use a restrained Modus technical-editorial style: strong typographic hierarchy, generous whitespace, precise hairlines, labeled connectors, and one theme-aware accent. Avoid generic rows of identical rounded cards, dashboard chrome, outer card shells, heavy shadows, and decorative gradients.",
    "Derive the composition from the actual relationship being explained. Distinguish primary and secondary paths through stroke weight and opacity, avoid crossings, and never rely on color alone.",
    "Visual content must be self-contained and use Modus theme variables such as var(--color-fg), var(--color-fg-muted), var(--color-fg-subtle), var(--color-canvas), var(--color-surface), var(--color-hairline), and var(--color-link); never fetch external resources. SVG must use a responsive viewBox with width: 100% and height: auto; HTML must use natural height and responsive width.",
    "Visual motion may run once on reveal using only transform and opacity. Do not use infinite animations, and include a prefers-reduced-motion rule that leaves the visual static.",
    "Every visual fallback must preserve all implementation-relevant facts so execution never depends on rendering the visual.",
    "Always include testable Acceptance Criteria: these are what verifies the work later, so phrase them as observable behavior.",
  ],
  parameters: planParams,
  execute: async (toolCallId, params, _signal, _onUpdate, ctx) => {
    const context = resolveAgentToolContext(ctx.cwd);
    if (!context.workspaceId || !context.sessionId) {
      throw new Error("No active Modus workspace for this plan.");
    }
    const plan = writePlan(plansRoot(), {
      workspaceId: context.workspaceId,
      sessionId: context.sessionId,
      title: params.title,
      overview: params.overview,
      blocks: params.blocks,
      todos: params.todos.map((content) => ({ content })),
    });
    context.emit?.({ type: "plan.updated", sessionId: context.sessionId, plan, toolCallId });
    return toResult(`Plan "${plan.title}" written to ${plan.path}.`, plan);
  },
});

let registered = false;

/** Register the plan tool into the shared registry (idempotent). */
export function registerPlanTools(): void {
  if (registered) {
    return;
  }
  registered = true;

  toolRegistry.registerTool({
    entry: {
      name: PLAN_TOOL_NAME,
      profiles: ["plan"],
      permission: { danger: "safe" },
      capabilities: ["write"],
      readOnly: false,
      ui: PLAN_TOOL_UI,
    },
    definition: planTool,
  });
}
