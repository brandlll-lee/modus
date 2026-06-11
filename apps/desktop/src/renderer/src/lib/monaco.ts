/**
 * Monaco loader + Modus theme bridge.
 *
 * Monaco is heavy (~3 MB), so it is loaded once, on demand, via dynamic
 * import — the app shell never pays for it. Themes are derived from the live
 * design tokens (the same CSS custom properties every component uses), so the
 * editor always matches the active `data-theme` without a second source of
 * color truth.
 */
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

export type Monaco = typeof import("monaco-editor");

export const MONACO_THEME = "modus";

let monacoPromise: Promise<Monaco> | undefined;

/** Load (and memoize) the monaco module with workers + theme wired up. */
export function loadMonaco(): Promise<Monaco> {
  if (!monacoPromise) {
    self.MonacoEnvironment = {
      // Diff computation, tokenization helpers etc. all run on the base
      // editor worker; we register no language services, so it is the only
      // worker monaco ever requests.
      getWorker: () => new editorWorker(),
    };
    monacoPromise = import("monaco-editor").then((monaco) => {
      defineModusTheme(monaco);
      return monaco;
    });
  }
  return monacoPromise;
}

function token(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return toHexColor(styles.getPropertyValue(name).trim()) ?? fallback;
}

/**
 * Normalize a CSS color token to the #RRGGBB(AA) form monaco requires.
 * Handles raw hex and rgb()/rgba() (the two formats our tokens use).
 */
export function toHexColor(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.startsWith("#")) {
    return value;
  }
  const match = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (!match) {
    return undefined;
  }
  const toHex = (component: number) =>
    Math.max(0, Math.min(255, Math.round(component)))
      .toString(16)
      .padStart(2, "0");
  const [, r, g, b, a] = match;
  const alpha = a === undefined ? "" : toHex(Number.parseFloat(a) * 255);
  return `#${toHex(Number(r))}${toHex(Number(g))}${toHex(Number(b))}${alpha}`;
}

/**
 * (Re)define the Modus editor theme from the current design tokens. Called on
 * load and again whenever `data-theme` flips, so a single theme name stays
 * permanently in sync with the app.
 */
export function defineModusTheme(monaco: Monaco): void {
  const styles = getComputedStyle(document.documentElement);
  const isLight = document.documentElement.getAttribute("data-theme") === "light";

  const canvas = token(styles, "--color-canvas", isLight ? "#f7f7f6" : "#131314");
  const fg = token(styles, "--color-fg", isLight ? "#1b1b1d" : "#e4e4e3");
  const fgMuted = token(styles, "--color-fg-muted", isLight ? "#44464a" : "#b4b4b1");
  const fgSubtle = token(styles, "--color-fg-subtle", isLight ? "#6a6c72" : "#8a8a87");
  const fgFaint = token(styles, "--color-fg-faint", isLight ? "#9a9ca2" : "#5a5a5d");
  const selection = token(styles, "--color-selection", "#853ff46b");
  const success = token(styles, "--color-success", isLight ? "#1f9d6b" : "#3fae87");
  const danger = token(styles, "--color-danger", isLight ? "#d63a4f" : "#e5687a");
  const link = token(styles, "--color-link", isLight ? "#2563eb" : "#7bbcff");
  const hairline = token(styles, "--color-hairline", isLight ? "#00000017" : "#ffffff0d");

  monaco.editor.defineTheme(MONACO_THEME, {
    base: isLight ? "vs" : "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: fgFaint.slice(1), fontStyle: "italic" },
      { token: "string", foreground: success.slice(1) },
      { token: "keyword", foreground: link.slice(1) },
      { token: "number", foreground: danger.slice(1) },
      { token: "type", foreground: fgMuted.slice(1) },
    ],
    colors: {
      "editor.background": canvas,
      "editor.foreground": fg,
      "editorLineNumber.foreground": fgFaint,
      "editorLineNumber.activeForeground": fgSubtle,
      "editor.selectionBackground": selection,
      "editor.lineHighlightBackground": "#00000000",
      "editor.lineHighlightBorder": "#00000000",
      "editorGutter.background": canvas,
      "editorWidget.background": canvas,
      "editorWidget.border": hairline,
      "scrollbarSlider.background": isLight ? "#00000026" : "#ffffff1f",
      "scrollbarSlider.hoverBackground": isLight ? "#00000040" : "#ffffff33",
      "scrollbarSlider.activeBackground": isLight ? "#00000040" : "#ffffff33",
      "diffEditor.insertedTextBackground": `${success}${isLight ? "18" : "1f"}`,
      "diffEditor.removedTextBackground": `${danger}${isLight ? "17" : "1f"}`,
      "diffEditor.insertedLineBackground": `${success}${isLight ? "09" : "0f"}`,
      "diffEditor.removedLineBackground": `${danger}${isLight ? "08" : "0f"}`,
      "diffEditorGutter.insertedLineBackground": `${success}${isLight ? "30" : "3a"}`,
      "diffEditorGutter.removedLineBackground": `${danger}${isLight ? "2e" : "3a"}`,
      "diffEditor.diagonalFill": hairline,
      "diffEditor.unchangedRegionBackground": canvas,
      "diffEditor.unchangedRegionForeground": fgSubtle,
      "diffEditor.unchangedCodeBackground": "#00000000",
    },
  });
  monaco.editor.setTheme(MONACO_THEME);
}

/**
 * Keep the monaco theme in lock-step with the app's `data-theme` attribute.
 * Returns a disposer; safe to call from multiple components (cheap re-define).
 */
export function watchModusTheme(monaco: Monaco): () => void {
  const observer = new MutationObserver(() => defineModusTheme(monaco));
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}
