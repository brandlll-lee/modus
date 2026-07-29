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

  const codeBg = token(styles, "--color-code-bg", isLight ? "#ffffff" : "#131314");
  const codeFg = token(styles, "--color-code-fg", isLight ? "#1f2328" : "#d4d4d4");
  const lineNumber = token(styles, "--color-code-line-number", isLight ? "#6e7781" : "#858585");
  const activeLineNumber = token(
    styles,
    "--color-code-line-number-active",
    isLight ? "#24292f" : "#b8b8b8",
  );
  const activeLine = token(styles, "--color-code-active-line", isLight ? "#0000000e" : "#ffffff09");
  const indentGuide = token(
    styles,
    "--color-code-indent-guide",
    isLight ? "#0000002e" : "#ffffff1f",
  );
  const comment = token(styles, "--color-code-comment", isLight ? "#008000" : "#7f8a77");
  const keyword = token(styles, "--color-code-keyword", isLight ? "#af00db" : "#c586c0");
  const string = token(styles, "--color-code-string", isLight ? "#a31515" : "#ce9178");
  const number = token(styles, "--color-code-number", isLight ? "#098658" : "#b5cea8");
  const type = token(styles, "--color-code-type", isLight ? "#0000ff" : "#4fc1ff");
  const fgSubtle = token(styles, "--color-fg-subtle", isLight ? "#6a6c72" : "#8a8a87");
  const selection = token(styles, "--color-selection", "#853ff46b");
  const hairline = token(styles, "--color-hairline", isLight ? "#00000017" : "#ffffff0d");
  const diffAddBg = token(styles, "--color-diff-add-bg", isLight ? "#e5f0e1" : "#23352b");
  const diffDelBg = token(styles, "--color-diff-del-bg", isLight ? "#ffe8df" : "#3a2824");
  const diffAddGutter = token(styles, "--color-diff-add-gutter", isLight ? "#d4e6ce" : "#2d4637");
  const diffDelGutter = token(styles, "--color-diff-del-gutter", isLight ? "#ffd9cc" : "#4b302a");

  monaco.editor.defineTheme(MONACO_THEME, {
    base: isLight ? "vs" : "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: comment.slice(1) },
      { token: "string", foreground: string.slice(1) },
      { token: "keyword", foreground: keyword.slice(1) },
      { token: "number", foreground: number.slice(1) },
      { token: "type", foreground: type.slice(1) },
    ],
    colors: {
      "editor.background": codeBg,
      "editor.foreground": codeFg,
      "editorIndentGuide.background1": indentGuide,
      "editorLineNumber.foreground": lineNumber,
      "editorLineNumber.activeForeground": activeLineNumber,
      "editor.selectionBackground": selection,
      "editor.lineHighlightBackground": activeLine,
      "editor.lineHighlightBorder": "#00000000",
      "editor.bracketMatch.background": isLight ? "#00000014" : "#ffffff14",
      "editor.bracketMatch.border": isLight ? "#00000033" : "#ffffff33",
      "editorBracketGuide.background1": indentGuide,
      "editorBracketGuide.activeBackground1": isLight ? "#00000040" : "#ffffff40",
      "editorGutter.background": codeBg,
      "editorWidget.background": codeBg,
      "editorWidget.border": hairline,
      "scrollbarSlider.background": isLight ? "#00000026" : "#ffffff1f",
      "scrollbarSlider.hoverBackground": isLight ? "#00000040" : "#ffffff33",
      "scrollbarSlider.activeBackground": isLight ? "#00000040" : "#ffffff33",
      "diffEditor.insertedTextBackground": diffAddBg,
      "diffEditor.removedTextBackground": diffDelBg,
      "diffEditor.insertedLineBackground": diffAddBg,
      "diffEditor.removedLineBackground": diffDelBg,
      "diffEditorGutter.insertedLineBackground": diffAddGutter,
      "diffEditorGutter.removedLineBackground": diffDelGutter,
      "diffEditor.diagonalFill": "#00000000",
      "diffEditor.unchangedRegionBackground": codeBg,
      "diffEditor.unchangedRegionForeground": fgSubtle,
      "diffEditor.unchangedCodeBackground": "#00000000",
    },
  });
  monaco.editor.setTheme(MONACO_THEME);
}

/**
 * Keep the monaco theme in lock-step with the app's `data-theme` attribute.
 * Defines the theme from the CURRENT theme immediately (so an editor mounting
 * after a theme change — or after monaco was first loaded under the other theme —
 * paints with the right palette, not a stale one), then re-defines on every
 * future `data-theme` flip. Returns a disposer; safe to call from multiple
 * components (cheap re-define + global setTheme).
 */
export function watchModusTheme(monaco: Monaco): () => void {
  defineModusTheme(monaco);
  const observer = new MutationObserver(() => defineModusTheme(monaco));
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}
