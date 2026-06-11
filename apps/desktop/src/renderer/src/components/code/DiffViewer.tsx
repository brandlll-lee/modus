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
  className?: string | undefined;
};

let instanceCounter = 0;

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
  className,
}: DiffViewerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MonacoDiffEditor | null>(null);
  const modelsRef = useRef<{ original: MonacoTextModel; modified: MonacoTextModel } | null>(null);
  const [ready, setReady] = useState(false);

  // Create the editor once per mounted file; content updates reuse the models.
  // biome-ignore lint/correctness/useExhaustiveDependencies: original/modified/options are applied by the follow-up effects below.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let disposeTheme: (() => void) | undefined;
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
        renderIndicators: true,
        renderGutterMenu: false,
        hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 6 },
        renderOverviewRuler: false,
        renderMarginRevertIcon: false,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        scrollbar: { verticalScrollbarSize: 7, horizontalScrollbarSize: 7 },
        lineNumbersMinChars: 3,
        lineDecorationsWidth: 6,
        folding: false,
        contextmenu: false,
        occurrencesHighlight: "off",
        selectionHighlight: false,
        renderLineHighlight: "none",
        fontFamily: fontMono,
        fontSize: 12.5,
        lineHeight: 21,
        wordWrap: wordWrap ? "on" : "off",
        guides: { indentation: false },
        padding: { top: 8, bottom: 10 },
      });
      editor.setModel({ original: originalModel, modified: modifiedModel });
      editorRef.current = editor;
      disposeTheme = watchModusTheme(monaco);
      setReady(true);
    });

    return () => {
      cancelled = true;
      disposeTheme?.();
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
    });
  }, [sideBySide, wordWrap]);

  return (
    <div className={cn("relative min-h-0", className)}>
      <div className="absolute inset-0" ref={hostRef} />
      {!ready ? (
        <div className="absolute inset-0 flex items-center justify-center text-fg-faint text-xs">
          Loading diff…
        </div>
      ) : null}
    </div>
  );
}
