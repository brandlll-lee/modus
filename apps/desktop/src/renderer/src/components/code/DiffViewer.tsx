import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { loadMonaco, MONACO_THEME, type Monaco, watchModusTheme } from "../../lib/monaco";

type MonacoDiffEditor = import("monaco-editor").editor.IStandaloneDiffEditor;
type MonacoTextModel = import("monaco-editor").editor.ITextModel;

export type DiffViewerProps = {
  /** Left side contents (index / HEAD version). */
  original: string;
  /** Right side contents (working tree / index version). */
  modified: string;
  /** Workspace-relative file path — drives language detection via its extension. */
  path: string;
  /** Previous path for renames so the original side highlights correctly. */
  originalPath?: string | undefined;
  /** Side-by-side (true) or inline/unified (false). */
  sideBySide: boolean;
  wordWrap: boolean;
  /** Treat trailing/leading whitespace-only changes as equal (Monaco ignoreTrimWhitespace). */
  ignoreWhitespace?: boolean | undefined;
  /**
   * When set, the viewer sizes itself to its (collapsed) diff content up to
   * `maxHeight`, instead of filling a fixed `className` height — the inline,
   * stacked feel of Cursor's Source Control diffs.
   */
  autoHeight?: boolean | undefined;
  maxHeight?: number | undefined;
  className?: string | undefined;
};

let instanceCounter = 0;

/**
 * Live registry of mounted diff editors. Lets the Source Control panel's
 * "Find in Diff" act on the diff the user is actually looking at (focused),
 * falling back to the first mounted one — Monaco owns the find widget, we just
 * route the command to a real target.
 */
const mountedDiffEditors = new Set<MonacoDiffEditor>();

export function triggerFindInActiveDiff(): boolean {
  let target: MonacoDiffEditor | undefined;
  for (const editor of mountedDiffEditors) {
    if (editor.getModifiedEditor().hasTextFocus() || editor.getOriginalEditor().hasTextFocus()) {
      target = editor;
      break;
    }
  }
  if (!target) {
    const [first] = mountedDiffEditors;
    target = first;
  }
  if (!target) return false;
  const code = target.getModifiedEditor();
  code.focus();
  code.getAction("actions.find")?.run();
  return true;
}

/** Model URI that keeps the real file extension last so monaco auto-detects the language. */
function modelUri(monaco: Monaco, instance: number, side: "original" | "modified", path: string) {
  return monaco.Uri.from({
    scheme: "modus-diff",
    path: `/${instance}/${side}/${path.replace(/\\/g, "/")}`,
  });
}

/**
 * Read-only monaco diff with Modus theming. Loads monaco lazily (first mount
 * pays the import once, app start never does), auto-detects the language from
 * the file extension, and collapses unchanged regions like Cursor's review UI.
 */
export function DiffViewer({
  original,
  modified,
  path,
  originalPath,
  sideBySide,
  wordWrap,
  ignoreWhitespace,
  autoHeight,
  maxHeight = 600,
  className,
}: DiffViewerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MonacoDiffEditor | null>(null);
  const modelsRef = useRef<{ original: MonacoTextModel; modified: MonacoTextModel } | null>(null);
  const [ready, setReady] = useState(false);
  // Measured content height when autoHeight is on (collapsed diff dictates it).
  const [contentHeight, setContentHeight] = useState<number | undefined>();

  // Create the editor once per mounted file; content updates reuse the models.
  // biome-ignore lint/correctness/useExhaustiveDependencies: original/modified/options are applied by the follow-up effects below.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let disposeTheme: (() => void) | undefined;
    const measureDisposers: import("monaco-editor").IDisposable[] = [];
    const instance = ++instanceCounter;

    void loadMonaco().then((monaco) => {
      if (cancelled || !hostRef.current) return;

      const styles = getComputedStyle(document.documentElement);
      const fontMono =
        styles.getPropertyValue("--font-mono").trim() ||
        '"JetBrains Mono Variable", ui-monospace, monospace';

      const originalModel = monaco.editor.createModel(
        original,
        undefined,
        modelUri(monaco, instance, "original", originalPath ?? path),
      );
      const modifiedModel = monaco.editor.createModel(
        modified,
        undefined,
        modelUri(monaco, instance, "modified", path),
      );
      modelsRef.current = { original: originalModel, modified: modifiedModel };

      const editor = monaco.editor.createDiffEditor(host, {
        theme: MONACO_THEME,
        automaticLayout: true,
        readOnly: true,
        originalEditable: false,
        renderSideBySide: sideBySide,
        useInlineViewWhenSpaceIsLimited: true,
        diffAlgorithm: "advanced",
        renderIndicators: false,
        renderGutterMenu: false,
        ignoreTrimWhitespace: ignoreWhitespace ?? false,
        hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 6 },
        renderOverviewRuler: false,
        renderMarginRevertIcon: false,
        glyphMargin: false,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
          alwaysConsumeMouseWheel: false,
        },
        lineNumbersMinChars: 4,
        lineDecorationsWidth: 16,
        folding: false,
        contextmenu: false,
        occurrencesHighlight: "off",
        selectionHighlight: false,
        renderLineHighlight: "none",
        fontFamily: fontMono,
        fontSize: 12.5,
        lineHeight: 22,
        wordWrap: wordWrap ? "on" : "off",
        guides: { indentation: false },
        padding: { top: 12, bottom: 14 },
      });
      editor.setModel({ original: originalModel, modified: modifiedModel });
      editorRef.current = editor;
      mountedDiffEditors.add(editor);
      disposeTheme = watchModusTheme(monaco);

      if (autoHeight) {
        // Size to the collapsed diff. Measuring on every content-size tick
        // caused a setState storm during tokenization (each re-render relays
        // out Monaco, which fires another tick). Instead: measure once the diff
        // is computed, and debounce any later size changes (e.g. the user
        // expanding a hidden region) so we settle without thrashing.
        let raf = 0;
        let debounce: ReturnType<typeof setTimeout> | undefined;
        const measure = (): void => {
          const modifiedHeight = editor.getModifiedEditor().getContentHeight();
          const originalHeight = editor.getOriginalEditor().getContentHeight();
          const next = Math.min(maxHeight, Math.max(modifiedHeight, originalHeight) + 2);
          if (next > 0) setContentHeight(next);
        };
        const measureSoon = (): void => {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(measure);
        };
        const measureDebounced = (): void => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(measureSoon, 120);
        };
        measureDisposers.push(
          editor.onDidUpdateDiff(measureSoon),
          editor.getModifiedEditor().onDidContentSizeChange(measureDebounced),
          {
            dispose: () => {
              cancelAnimationFrame(raf);
              if (debounce) clearTimeout(debounce);
            },
          },
        );
      }

      setReady(true);
    });

    return () => {
      cancelled = true;
      disposeTheme?.();
      for (const disposer of measureDisposers) disposer.dispose();
      if (editorRef.current) mountedDiffEditors.delete(editorRef.current);
      editorRef.current?.dispose();
      editorRef.current = null;
      modelsRef.current?.original.dispose();
      modelsRef.current?.modified.dispose();
      modelsRef.current = null;
      setReady(false);
    };
  }, [path, originalPath]);

  // Contents changed for the same file (refresh after stage/agent edit).
  useEffect(() => {
    const models = modelsRef.current;
    if (!models) return;
    if (models.original.getValue() !== original) models.original.setValue(original);
    if (models.modified.getValue() !== modified) models.modified.setValue(modified);
  }, [original, modified]);

  // Presentation toggles never recreate the editor.
  useEffect(() => {
    editorRef.current?.updateOptions({
      renderSideBySide: sideBySide,
      wordWrap: wordWrap ? "on" : "off",
      ignoreTrimWhitespace: ignoreWhitespace ?? false,
    });
  }, [sideBySide, wordWrap, ignoreWhitespace]);

  return (
    <div
      className={cn("relative min-h-0", className)}
      style={autoHeight ? { height: contentHeight ?? 120 } : undefined}
    >
      <div className="absolute inset-0" ref={hostRef} />
      {!ready ? (
        <div className="absolute inset-0 flex items-center justify-center text-fg-faint text-xs">
          Loading diff…
        </div>
      ) : null}
    </div>
  );
}
