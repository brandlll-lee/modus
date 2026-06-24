import { join } from "node:path";
import {
  type AgentToolResult,
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { app } from "electron";
import { Type } from "typebox";
import { PLAN_TOOL_NAME, PLAN_TOOL_UI } from "../../../shared/tools";
import { slugify, writePlan } from "../../plan/plan-store";
import { toolRegistry } from "./registry";
import { resolveAgentToolContext } from "./tool-context";

/**
 * Plan Mode tool. In Plan Mode the agent is read-only on the codebase
 * (read/grep/find/ls) and its single write channel is `plan_write`, which
 * materializes one durable `plan.md` artifact. Keeping the plan as the only
 * writable target is what makes Plan Mode safe without guarding every path —
 * the profile simply doesn't include edit/write/bash.
 *
 * Plans live under the app's user-data dir by default (not in the repo); the
 * user opts into "save to workspace" separately.
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
      description: "Short feature title for this plan (also used to name the plan file).",
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
          "Ordered implementation steps as plain strings. These drive the Build card count and " +
          "the Plan panel checklist, so each step must be a self-contained unit of work.",
      },
    ),
    content: Type.String({
      minLength: 1,
      description:
        "The full plan.md body as Markdown. Put the complete decision-ready plan here. Keep this " +
        "as the final field so the long Markdown file content does not split the smaller metadata.",
    }),
  },
  { additionalProperties: false },
);

const planTool: ToolDefinition = defineTool({
  name: PLAN_TOOL_NAME,
  label: "Write plan",
  description:
    "Write or update the implementation plan for the current Plan Mode session. The plan is a " +
    "single Markdown document — the durable source of truth a human reviews and edits, and the " +
    "shared input to single-agent or fusion execution. Research the codebase (read/grep/find/ls) " +
    "and resolve open questions with the user BEFORE writing, then call this once with the " +
    "complete plan. After a successful call, stop; only a later user revision request should " +
    "write a new version. Do not implement anything in Plan Mode.",
  promptSnippet:
    "plan_write(title, overview, todos, content) — write/update the single plan.md artifact for " +
    "this session. `todos` is a plain string array; `content` is the full Markdown file body.",
  promptGuidelines: [
    "Plan Mode is read-only on the codebase: research with read/grep/find/ls, never edit/run. Your only output is plan_write.",
    "Front-load clarifying questions so the plan is self-contained — a separate executor (or two parallel ones) must be able to build from it without asking the user again.",
    "Be decision-complete: pin the actual data shapes, signatures, algorithms (formula or precise steps), and config values an executor would otherwise have to invent — concrete and owned, never fabricated as fact.",
    "Keep the Markdown readable: use short sections, well-spaced lists, and diagrams/tables only when they clarify the plan.",
    "Always include testable Acceptance Criteria: these are what verifies the work later, so phrase them as observable behavior.",
  ],
  parameters: planParams,
  execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
    const context = resolveAgentToolContext(ctx.cwd);
    if (!context.workspaceId) {
      throw new Error("No active Modus workspace for this plan.");
    }
    const plan = writePlan(plansRoot(), {
      workspaceId: context.workspaceId,
      slug: slugify(params.title),
      title: params.title,
      overview: params.overview,
      content: params.content,
      todos: params.todos.map((content) => ({ content })),
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    });
    if (context.sessionId) {
      context.emit?.({ type: "plan.updated", sessionId: context.sessionId, plan });
    }
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
