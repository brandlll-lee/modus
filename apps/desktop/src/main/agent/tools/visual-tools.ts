import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { VISUAL_TOOL_NAME, VISUAL_TOOL_UI } from "../../../shared/tools";
import { toolRegistry } from "./registry";
import { resolveAgentToolContext } from "./tool-context";

const visualParams = Type.Object({
  visualId: Type.Optional(
    Type.String({
      description:
        "Stable id for updating an earlier inline visual in the current chat session. Reuse it when modifying the same visual.",
    }),
  ),
  title: Type.String({
    description: "Short title for the inline visual.",
  }),
  kind: Type.Union([Type.Literal("html"), Type.Literal("svg")], {
    description: "Use svg for static diagrams; use html for interactive widgets.",
  }),
  content: Type.String({
    description:
      "Self-contained HTML fragment/document or SVG. Inline all CSS/JS. Do not fetch external resources.",
  }),
});

export const VISUAL_AUTHORING_GUIDELINES = [
  "Keep content self-contained: no external scripts, stylesheets, images, fonts, fetch, XHR, WebSocket, or persistent browser storage.",
  "Use Modus CSS variables for theme-dependent text, surfaces, controls, and borders: var(--color-fg), var(--color-fg-muted), var(--color-fg-subtle), var(--color-canvas), var(--color-surface), var(--color-elevated), var(--color-hairline), var(--color-chip), and var(--color-link). Do not hard-code light/dark text or surface colors; reserve fixed colors only for semantic data or status.",
  "Render content only: Modus owns the surrounding surface, title, menu, and fullscreen action. Do not add an outer card shell, page header, outer border, shadow, background, or duplicate fullscreen control.",
  "Compose one dominant visual stage with clear hierarchy and generous space. When interactive, controls must manipulate that same model rather than become a settings form, equal-card dashboard, stat strip, or text-only page switcher.",
  "Use natural height and responsive width; avoid fixed-width page wrappers and overflow-hidden outer layouts. Animate only interaction feedback with transform and opacity, support keyboard focus and prefers-reduced-motion, and never run an idle animation loop.",
] as const;

const visualTool: ToolDefinition<typeof visualParams> = defineTool({
  name: VISUAL_TOOL_NAME,
  label: "Create visual",
  description:
    "Create a sandboxed custom visual when a chart, diagram, or interactive widget explains the " +
    "result better than text. Chat renders it inline; Plan Mode stages it for plan_write.",
  promptSnippet:
    "visual_write(title, kind, content, visualId?) — create or update a self-contained inline HTML/SVG visual; Plan Mode returns a visualRef for plan_write.",
  promptGuidelines: [
    "Use visual_write for charts, diagrams, simulations, comparison widgets, and interactive explainers.",
    ...VISUAL_AUTHORING_GUIDELINES,
    "Prefer SVG for static diagrams and HTML with inline CSS/JS for sliders, buttons, and live calculations.",
    "For charts, label axes, units, ticks, and legends clearly.",
    "When changing an existing visual in this session, reuse its visualId and send the full updated HTML/SVG.",
    "Return complete HTML/SVG in content. Chat renders it directly; Plan Mode passes the returned visualRef to plan_write.",
  ],
  parameters: visualParams,
  execute: async (toolCallId, params: Static<typeof visualParams>, _signal, _onUpdate, ctx) => {
    const context = resolveAgentToolContext(ctx.cwd);
    if (context.profile === "plan") {
      const ref = params.visualId?.trim() || toolCallId;
      context.visualDraft = {
        ref,
        title: params.title,
        kind: params.kind,
        content: params.content,
      };
      return {
        content: [
          {
            type: "text",
            text: `Plan visual ready. Reference it as visualRef "${ref}" in plan_write.`,
          },
        ],
        details: { title: params.title, kind: params.kind, visualRef: ref },
      };
    }
    return {
      content: [{ type: "text", text: `Rendered visual: ${params.title}` }],
      details: { title: params.title, kind: params.kind },
    };
  },
});

let registered = false;

/** Register inline visual rendering into the shared tool registry (idempotent). */
export function registerVisualTools(): void {
  if (registered) {
    return;
  }
  registered = true;

  toolRegistry.registerTool({
    entry: {
      name: VISUAL_TOOL_NAME,
      profiles: ["chat", "plan"],
      permission: { danger: "safe" },
      capabilities: ["write"],
      readOnly: false,
      ui: VISUAL_TOOL_UI,
    },
    definition: visualTool,
  });
}
