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
    description:
      "Prefer html for operable widgets; use svg only for a small static relationship inset.",
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
  "Build a working model the user operates, not a document illustration, architecture poster, layered equal-box board, or phase deck that only swaps prose.",
  "Compose one dominant visual stage with clear hierarchy and generous space. When interactive, controls must manipulate that same model rather than become a settings form, equal-card dashboard, stat strip, or text-only page switcher.",
  "Write visible structure and styles first; put interactive <script> blocks at the end of content so streaming preview can paint before scripts run.",
  "Use natural height and responsive width; avoid fixed-width page wrappers and overflow-hidden outer layouts. Animate only interaction feedback with transform and opacity, support keyboard focus and prefers-reduced-motion, and never run an idle animation loop.",
] as const;

const visualTool: ToolDefinition<typeof visualParams> = defineTool({
  name: VISUAL_TOOL_NAME,
  label: "Stage / update visual",
  description:
    "Update an existing chat visual via visualId. Channel for new live chat visuals: see " +
    "response_formatting (fenced html/svg).",
  promptSnippet:
    "visual_write(title, kind, content, visualId?) — update an existing chat visual via visualId. " +
    "New live chat visuals: fenced html/svg per response_formatting.",
  promptGuidelines: [
    "Channel selection for new chat visuals is defined in response_formatting — do not restate it here.",
    "Use this tool in chat to update an existing visual via visualId.",
    ...VISUAL_AUTHORING_GUIDELINES,
    "Prefer HTML with inline CSS/JS for operable models (sliders, toggles, live calculations). Use SVG only for a small static relationship inset — never as a full-page architecture poster standing in for the primary visual.",
    "For charts, label axes, units, ticks, and legends clearly.",
    "When changing an existing visual in this session, reuse its visualId and send the full updated HTML/SVG.",
    "Return complete HTML/SVG in content.",
  ],
  parameters: visualParams,
  execute: async (_toolCallId, params: Static<typeof visualParams>) => {
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
      profiles: ["chat"],
      permission: { danger: "safe" },
      capabilities: ["write"],
      readOnly: false,
      ui: VISUAL_TOOL_UI,
    },
    definition: visualTool,
  });
}
