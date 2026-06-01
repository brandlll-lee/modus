import { IconFileDiff, IconRefresh } from "@tabler/icons-react";
import * as monaco from "monaco-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FileChange } from "../../../../shared/contracts";
import { EmptyState, PanelHeader } from "../../components/ui/Panel";
import { cn } from "../../lib/cn";

type DiffPanelProps = {
  cwd?: string | undefined;
};

let themeDefined = false;
function ensureTheme(): void {
  if (themeDefined) {
    return;
  }
  // 自定义 Monaco 主题，背景与 inspector 面板对齐，diff 高亮保持低饱和
  monaco.editor.defineTheme("modus-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#171718",
      "editorGutter.background": "#171718",
      "minimap.background": "#171718",
      "editor.lineHighlightBackground": "#ffffff08",
      "editorLineNumber.foreground": "#4c4c50",
      "diffEditor.insertedTextBackground": "#ffffff10",
      "diffEditor.removedTextBackground": "#00000033",
      "diffEditor.insertedLineBackground": "#ffffff08",
      "diffEditor.removedLineBackground": "#0000001f",
    },
  });
  themeDefined = true;
}

export function DiffPanel({ cwd }: DiffPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | undefined>();

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    ensureTheme();
    const editor = monaco.editor.createDiffEditor(containerRef.current, {
      automaticLayout: true,
      readOnly: true,
      theme: "modus-dark",
      minimap: { enabled: false },
      fontSize: 12,
      fontFamily: "JetBrains Mono, Consolas, monospace",
      renderOverviewRuler: false,
      scrollBeyondLastLine: false,
    });
    editorRef.current = editor;

    return () => {
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  const refreshChanges = useCallback(async (targetCwd: string | undefined): Promise<void> => {
    if (!targetCwd) {
      setChanges([]);
      return;
    }

    const nextChanges = await window.modus.diff.list(targetCwd);
    setChanges(nextChanges);
    setSelectedPath(nextChanges[0]?.path);
  }, []);

  useEffect(() => {
    void refreshChanges(cwd);
  }, [cwd, refreshChanges]);

  useEffect(() => {
    if (!cwd || !selectedPath || !editorRef.current) {
      return;
    }

    void window.modus.diff.read({ cwd, path: selectedPath }).then((fileDiff: { diff: string }) => {
      const original = monaco.editor.createModel("", "diff");
      const modified = monaco.editor.createModel(fileDiff.diff || "No unstaged diff.", "diff");
      editorRef.current?.setModel({ original, modified });
    });
  }, [cwd, selectedPath]);

  return (
    <section className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Changes">
        <button
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-subtle transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
          disabled={!cwd}
          onClick={() => void refreshChanges(cwd)}
          type="button"
        >
          <IconRefresh size={13} stroke={1.6} /> Refresh
        </button>
      </PanelHeader>

      <div className="flex min-h-0 flex-1">
        <div className="scroll-thin w-44 shrink-0 overflow-y-auto px-2 pb-2">
          {changes.length === 0 ? (
            <div className="px-1 py-2 text-2xs text-fg-faint">No changes</div>
          ) : (
            changes.map((change) => {
              const selected = selectedPath === change.path;
              return (
                <button
                  className={cn(
                    "mb-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                    selected ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
                  )}
                  key={`${change.status}:${change.path}`}
                  onClick={() => setSelectedPath(change.path)}
                  type="button"
                >
                  <span className="font-mono text-fg-faint">{change.status}</span>
                  <span className="truncate">{change.path}</span>
                </button>
              );
            })
          )}
        </div>
        <div className="relative min-h-0 flex-1">
          {changes.length === 0 ? (
            <EmptyState
              className="absolute inset-0"
              hint={cwd ? "Working tree is clean." : "Open a workspace to review changes."}
              icon={<IconFileDiff size={22} stroke={1.4} />}
            />
          ) : null}
          <div className="h-full w-full" ref={containerRef} />
        </div>
      </div>
    </section>
  );
}
