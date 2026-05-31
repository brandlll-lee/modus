import * as monaco from "monaco-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FileChange } from "../../../../shared/contracts";

type DiffPanelProps = {
  cwd?: string | undefined;
};

export function DiffPanel({ cwd }: DiffPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | undefined>();

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const editor = monaco.editor.createDiffEditor(containerRef.current, {
      automaticLayout: true,
      readOnly: true,
      theme: "vs-dark",
      minimap: { enabled: false },
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
    <section className="flex min-h-80 flex-col border-zinc-800 border-t">
      <div className="flex items-center justify-between px-4 py-2">
        <h2 className="font-medium text-sm text-zinc-100">Diff Review</h2>
        <button
          className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-300 disabled:opacity-40"
          disabled={!cwd}
          onClick={() => void refreshChanges(cwd)}
          type="button"
        >
          Refresh
        </button>
      </div>
      <div className="flex min-h-72 flex-1">
        <div className="w-44 overflow-auto border-zinc-800 border-r p-2">
          {changes.length === 0 ? (
            <div className="text-xs text-zinc-500">No changes</div>
          ) : (
            changes.map((change) => (
              <button
                className="mb-2 w-full rounded-lg border border-zinc-800 p-2 text-left text-xs text-zinc-300"
                key={`${change.status}:${change.path}`}
                onClick={() => setSelectedPath(change.path)}
                type="button"
              >
                <span className="text-zinc-500">{change.status}</span> {change.path}
              </button>
            ))
          )}
        </div>
        <div className="min-h-72 flex-1" ref={containerRef} />
      </div>
    </section>
  );
}
