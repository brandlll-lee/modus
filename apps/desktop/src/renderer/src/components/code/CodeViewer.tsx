import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { loadMonaco, MONACO_THEME, type Monaco, watchModusTheme } from "../../lib/monaco";

type MonacoEditor = import("monaco-editor").editor.IStandaloneCodeEditor;
type MonacoTextModel = import("monaco-editor").editor.ITextModel;

export type CodeViewerProps = {
  /** File contents to display. */
  content: string;
  /** Workspace-relative path — drives language detection via its extension. */
  path: string;
  wordWrap?: boolean;
  /**
   * Wash every line as added/removed. Used for whole-file add/delete previews
   * where there is no original/modified pair to diff (one side is empty), so a
   * diff editor would fabricate a phantom empty changed line.
   */
  tint?: "added" | "removed" | undefined;
  /** Size to content (up to maxHeight) instead of filling a fixed height. */
  autoHeight?: boolean | undefined;
  maxHeight?: number | undefined;
  className?: string | undefined;
};

let instanceCounter = 0;

/** Model URI keeping the real extension last so monaco auto-detects the language. */
function modelUri(monaco: Monaco, instance: number, path: string) {
  return monaco.Uri.from({
    scheme: "modus-file",
    path: `/${instance}/${path.replace(/\\/g, "/")}`,
  });
}

/**
 * Read-only Monaco viewer for a single file — VS-Code-grade syntax highlighting
 * with Modus theming, reusing the same lazily-loaded monaco the diff viewer
 * uses (the app shell never pays for it; the panel does, once, on first open).
 * Editing is intentionally off for now; flipping `readOnly` is all it takes to
 * make this an in-panel editor later.
 */
export function CodeViewer({
  content,
  path,
  wordWrap = false,
  tint,
  autoHeight,
  maxHeight = 560,
  className,
}: CodeViewerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MonacoEditor | null>(null);
  const modelRef = useRef<MonacoTextModel | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<ReturnType<MonacoEditor["createDecorationsCollection"]> | null>(
    null,
  );
  const [ready, setReady] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | undefined>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: content/wordWrap/tint are applied by the follow-up effects below.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    let cancelled = false;
    let disposeTheme: (() => void) | undefined;
    const measureDisposers: import("monaco-editor").IDisposable[] = [];
    const instance = ++instanceCounter;

    void loadMonaco().then((monaco) => {
      if (cancelled || !hostRef.current) {
        return;
      }
      monacoRef.current = monaco;
      const styles = getComputedStyle(document.documentElement);
      const fontMono =
        styles.getPropertyValue("--font-mono").trim() ||
        '"JetBrains Mono Variable", ui-monospace, monospace';

      const model = monaco.editor.createModel(content, undefined, modelUri(monaco, instance, path));
      modelRef.current = model;

      const editor = monaco.editor.create(host, {
        model,
        theme: MONACO_THEME,
        automaticLayout: true,
        readOnly: true,
        domReadOnly: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
          alwaysConsumeMouseWheel: false,
        },
        lineNumbersMinChars: 4,
        lineDecorationsWidth: 16,
        glyphMargin: false,
        folding: !autoHeight,
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
        stickyScroll: { enabled: false },
      });
      editorRef.current = editor;
      decorationsRef.current = editor.createDecorationsCollection();
      disposeTheme = watchModusTheme(monaco);

      if (autoHeight) {
        // Measure once content lays out, then debounce later size changes —
        // avoids the per-tick setState storm during tokenization.
        let raf = 0;
        let debounce: ReturnType<typeof setTimeout> | undefined;
        const measure = (): void => {
          const next = Math.min(maxHeight, editor.getContentHeight() + 2);
          if (next > 0) setContentHeight(next);
        };
        const measureDebounced = (): void => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(measure);
          }, 120);
        };
        raf = requestAnimationFrame(measure);
        measureDisposers.push(editor.onDidContentSizeChange(measureDebounced), {
          dispose: () => {
            cancelAnimationFrame(raf);
            if (debounce) clearTimeout(debounce);
          },
        });
      }
      setReady(true);
    });

    return () => {
      cancelled = true;
      disposeTheme?.();
      for (const disposer of measureDisposers) disposer.dispose();
      decorationsRef.current = null;
      editorRef.current?.dispose();
      editorRef.current = null;
      modelRef.current?.dispose();
      modelRef.current = null;
      monacoRef.current = null;
      setReady(false);
    };
  }, [path]);

  // Same file, new contents (external refresh): update in place, keep view.
  useEffect(() => {
    const model = modelRef.current;
    if (model && model.getValue() !== content) {
      model.setValue(content);
    }
  }, [content]);

  // Whole-line add/remove wash, reapplied when content or tint changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: content + ready are deliberate re-apply triggers (decorations are reset after the editor mounts and on every content refresh).
  useEffect(() => {
    const monaco = monacoRef.current;
    const model = modelRef.current;
    const decorations = decorationsRef.current;
    if (!monaco || !model || !decorations) return;
    if (!tint) {
      decorations.clear();
      return;
    }
    const kind = tint === "added" ? "add" : "del";
    decorations.set([
      {
        range: new monaco.Range(1, 1, model.getLineCount(), 1),
        options: {
          isWholeLine: true,
          className: `modus-wholeline-${kind}`,
          marginClassName: `modus-wholeline-${kind}-margin`,
        },
      },
    ]);
  }, [content, tint, ready]);

  useEffect(() => {
    editorRef.current?.updateOptions({ wordWrap: wordWrap ? "on" : "off" });
  }, [wordWrap]);

  return (
    <div
      className={cn("relative min-h-0", className)}
      style={autoHeight ? { height: contentHeight ?? 120 } : undefined}
    >
      <div className="absolute inset-0" ref={hostRef} />
      {!ready ? (
        <div className="absolute inset-0 flex items-center justify-center text-fg-faint text-xs">
          Loading…
        </div>
      ) : null}
    </div>
  );
}
