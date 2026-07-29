import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { loadMonaco, MONACO_THEME, type Monaco, watchModusTheme } from "../../lib/monaco";

type MonacoEditor = import("monaco-editor").editor.IStandaloneCodeEditor;
type MonacoTextModel = import("monaco-editor").editor.ITextModel;
type MonacoSelection = import("monaco-editor").Selection;

export type CodeSelectionRange = {
  fromLine: number;
  toLine: number;
};

export type CodeViewerProps = {
  /** File contents to display / edit. */
  content: string;
  /** Workspace-relative path — drives language detection via its extension. */
  path: string;
  /** Absolute path for Add-to-Chat context items. */
  absolutePath?: string | undefined;
  wordWrap?: boolean;
  /** When false (default), the buffer is editable. */
  readOnly?: boolean;
  /** Fires on every model content change with the latest buffer value. */
  onChange?: ((value: string) => void) | undefined;
  /** Fires on Ctrl/Cmd+S with the current buffer value. */
  onSave?: ((value: string) => void) | undefined;
  /** Fires when the user adds the current selection to chat (button or Ctrl/Cmd+L). */
  onAddToChat?:
    | ((input: { path: string; range: CodeSelectionRange }) => void)
    | undefined;
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

function selectionRange(selection: MonacoSelection | null): CodeSelectionRange | undefined {
  if (!selection || selection.isEmpty()) {
    return undefined;
  }
  const start = Math.min(selection.startLineNumber, selection.endLineNumber);
  const end = Math.max(selection.startLineNumber, selection.endLineNumber);
  return { fromLine: start, toLine: end };
}

/**
 * Monaco editor for a single workspace file — VS-Code-grade syntax highlighting
 * with Modus theming, lazily loaded once on first open.
 */
export function CodeViewer({
  content,
  path,
  absolutePath,
  wordWrap = false,
  readOnly = false,
  onChange,
  onSave,
  onAddToChat,
  className,
}: CodeViewerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MonacoEditor | null>(null);
  const modelRef = useRef<MonacoTextModel | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onAddToChatRef = useRef(onAddToChat);
  const absolutePathRef = useRef(absolutePath);
  const [ready, setReady] = useState(false);

  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onAddToChatRef.current = onAddToChat;
  absolutePathRef.current = absolutePath;

  // biome-ignore lint/correctness/useExhaustiveDependencies: content/wordWrap/readOnly applied by follow-up effects; callbacks via refs.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    let cancelled = false;
    let disposeTheme: (() => void) | undefined;
    const disposers: import("monaco-editor").IDisposable[] = [];
    const instance = ++instanceCounter;

    void loadMonaco().then((monaco) => {
      if (cancelled || !hostRef.current) {
        return;
      }
      const styles = getComputedStyle(document.documentElement);
      const fontFamily =
        styles.getPropertyValue("--font-mono").trim() ||
        'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

      const model = monaco.editor.createModel(content, undefined, modelUri(monaco, instance, path));
      modelRef.current = model;

      const editor = monaco.editor.create(host, {
        model,
        theme: MONACO_THEME,
        automaticLayout: true,
        readOnly,
        domReadOnly: readOnly,
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
        folding: true,
        contextmenu: !readOnly,
        occurrencesHighlight: "off",
        selectionHighlight: false,
        renderLineHighlight: "line",
        matchBrackets: "always",
        fontFamily,
        fontSize: 13,
        fontWeight: "400",
        lineHeight: 20,
        wordWrap: wordWrap ? "on" : "off",
        guides: { indentation: true, bracketPairs: true },
        padding: { top: 12, bottom: 14 },
        stickyScroll: { enabled: false },
      });
      editorRef.current = editor;
      disposeTheme = watchModusTheme(monaco);

      const shortcut =
        typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
          ? "⌘L"
          : "Ctrl+L";
      const widgetNode = document.createElement("button");
      widgetNode.type = "button";
      widgetNode.className = "modus-add-to-chat";
      widgetNode.innerHTML = `<span class="label">Add to Chat</span><span class="hint">${shortcut}</span>`;
      widgetNode.style.display = "none";

      let widgetMounted = false;
      /** Authoritative: widget only after pointer-up (or keyboard selection). */
      let pointerSelecting = false;
      const widget: import("monaco-editor").editor.IContentWidget = {
        getId: () => `modus.addToChat.${instance}`,
        getDomNode: () => widgetNode,
        getPosition: () => {
          const selection = editor.getSelection();
          if (!selection || selection.isEmpty()) {
            return null;
          }
          return {
            position: {
              lineNumber: Math.min(selection.startLineNumber, selection.endLineNumber),
              column: Math.max(selection.startColumn, selection.endColumn),
            },
            preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE],
          };
        },
      };

      const emitAddToChat = (): void => {
        const filePath = absolutePathRef.current;
        const range = selectionRange(editor.getSelection());
        if (!filePath || !range || !onAddToChatRef.current) {
          return;
        }
        onAddToChatRef.current({ path: filePath, range });
      };

      const syncWidget = (): void => {
        const range = selectionRange(editor.getSelection());
        const canAdd = Boolean(
          range && !pointerSelecting && absolutePathRef.current && onAddToChatRef.current,
        );
        widgetNode.style.display = canAdd ? "inline-flex" : "none";
        if (canAdd && !widgetMounted) {
          editor.addContentWidget(widget);
          widgetMounted = true;
        } else if (canAdd && widgetMounted) {
          editor.layoutContentWidget(widget);
        } else if (!canAdd && widgetMounted) {
          editor.removeContentWidget(widget);
          widgetMounted = false;
        }
      };

      widgetNode.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        emitAddToChat();
      });

      disposers.push(
        model.onDidChangeContent(() => {
          onChangeRef.current?.(model.getValue());
        }),
        editor.onMouseDown((event) => {
          if (event.event.leftButton) {
            pointerSelecting = true;
            syncWidget();
          }
        }),
        editor.onMouseUp(() => {
          pointerSelecting = false;
          syncWidget();
        }),
        editor.onDidChangeCursorSelection(() => {
          // During drag, stay hidden; keyboard / programmatic selection still syncs.
          if (!pointerSelecting) {
            syncWidget();
          }
        }),
        editor.addAction({
          id: "modus.saveFile",
          label: "Save File",
          keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
          run: (ed) => {
            onSaveRef.current?.(ed.getValue());
          },
        }),
        editor.addAction({
          id: "modus.addSelectionToChat",
          label: "Add Selection to Chat",
          keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL],
          precondition: "editorHasSelection",
          run: () => {
            emitAddToChat();
          },
        }),
        {
          dispose: () => {
            if (widgetMounted) {
              editor.removeContentWidget(widget);
              widgetMounted = false;
            }
            widgetNode.remove();
          },
        },
      );
      setReady(true);
    });

    return () => {
      cancelled = true;
      disposeTheme?.();
      for (const disposer of disposers) disposer.dispose();
      editorRef.current?.dispose();
      editorRef.current = null;
      modelRef.current?.dispose();
      modelRef.current = null;
      setReady(false);
    };
  }, [path]);

  // External content refresh (re-open / save ack): replace text without wiping undo.
  useEffect(() => {
    const model = modelRef.current;
    if (!model || model.getValue() === content) {
      return;
    }
    model.pushEditOperations(
      [],
      [{ range: model.getFullModelRange(), text: content }],
      () => null,
    );
  }, [content]);

  useEffect(() => {
    editorRef.current?.updateOptions({ wordWrap: wordWrap ? "on" : "off" });
  }, [wordWrap]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly, domReadOnly: readOnly, contextmenu: !readOnly });
  }, [readOnly]);

  return (
    <div className={cn("relative min-h-0", className)}>
      <div className="absolute inset-0" ref={hostRef} />
      {!ready ? (
        <div className="absolute inset-0 flex items-center justify-center text-fg-faint text-xs">
          Loading…
        </div>
      ) : null}
    </div>
  );
}
