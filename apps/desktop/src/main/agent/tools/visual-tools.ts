import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { VISUAL_TOOL_NAME, VISUAL_TOOL_UI } from "../../../shared/tools";
import { toolRegistry } from "./registry";

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

const visualTool: ToolDefinition<typeof visualParams> = defineTool({
  name: VISUAL_TOOL_NAME,
  label: "Create visual",
  description:
    "Render a temporary inline custom visual in the chat when a chart, diagram, or small interactive " +
    "widget explains the answer better than text. The visual is sandboxed and ephemeral, like Claude " +
    "Custom Visuals in chat.",
  promptSnippet:
    "visual_write(title, kind, content, visualId?) — show or update a self-contained inline HTML/SVG visual in the chat.",
  promptGuidelines: [
    "Use visual_write for charts, diagrams, simulations, comparison widgets, and interactive explainers.",
    "Keep content self-contained: no external scripts, stylesheets, images, fonts, fetch, XHR, or WebSocket.",
    "Do not rely on persistent browser storage; localStorage/sessionStorage may only be temporary in the sandbox.",
    "Prefer SVG for static diagrams and HTML with inline CSS/JS for sliders, buttons, and live calculations.",
    "For charts, label axes, units, ticks, and legends clearly.",
    "When changing an existing visual in this session, reuse its visualId and send the full updated HTML/SVG.",
    "Use Modus CSS variables for theme-dependent text, surfaces, controls, and borders: var(--color-fg), var(--color-fg-muted), var(--color-fg-subtle), var(--color-canvas), var(--color-surface), var(--color-elevated), var(--color-hairline), var(--color-chip), and var(--color-link). Do not hard-code light/dark text or surface colors; reserve fixed colors only for semantic chart series, success/error states, or data meaning.",
    "Render as a skinless inline visual: do not add an outer card shell, outer border, outer shadow, or outer background. Let Modus provide the surrounding chat surface; use borders/backgrounds only for internal panels and controls.",
    "Let inline visuals use natural height and responsive width; fullscreen opens in a Modus web preview viewport, so avoid fixed max-width page shells, centered outer wrappers, or overflow:hidden layouts.",
    "Return complete HTML/SVG in content; Modus renders it after the tool completes.",
  ],
  parameters: visualParams,
  execute: async (_toolCallId, params: Static<typeof visualParams>) => ({
    content: [{ type: "text", text: `Rendered visual: ${params.title}` }],
    details: { title: params.title, kind: params.kind },
  }),
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
      profiles: ["chat"],
      permission: { danger: "safe" },
      capabilities: ["write"],
      readOnly: false,
      ui: VISUAL_TOOL_UI,
    },
    definition: visualTool,
  });
}
