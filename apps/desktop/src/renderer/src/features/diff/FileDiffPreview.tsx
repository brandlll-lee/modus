import { IconFileUnknown } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { DiffFileVersions, FileChange } from "../../../../shared/contracts";
import { CodeViewer } from "../../components/code/CodeViewer";
import { DiffViewer } from "../../components/code/DiffViewer";

type FileDiffPreviewProps = {
  cwd: string;
  change: FileChange;
  /** Bumped by the parent after stage/unstage/discard so contents refetch. */
  refreshToken?: number;
  /** When set, diff this commit against its parent instead of the working tree. */
  commit?: string | undefined;
  /** Layout + whitespace come from the panel-level "…" menu (shared by all rows). */
  sideBySide: boolean;
  ignoreWhitespace: boolean;
};

/**
 * The expanded body of one changed file: a real (monaco) diff that sizes itself
 * to its (collapsed) content, stacked inline like Cursor's Source Control. View
 * preferences (layout / ignore-whitespace) are owned by the panel and shared by
 * every row, so the menu controls them all at once.
 */
export function FileDiffPreview({
  cwd,
  change,
  refreshToken = 0,
  commit,
  sideBySide,
  ignoreWhitespace,
}: FileDiffPreviewProps) {
  const [versions, setVersions] = useState<DiffFileVersions | undefined>();
  const [error, setError] = useState<string | undefined>();

  // Working-tree pair: show the staged version only when nothing remains unstaged.
  const mode = change.staged && !change.unstaged ? "staged" : "unstaged";
  const requestKey = previewRequestKey({
    cwd,
    path: change.path,
    mode,
    originalPath: change.renamedFrom,
    commit,
  });
  const previousRequestKeyRef = useRef(requestKey);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken is a deliberate refetch trigger bumped by the parent after stage/unstage/discard.
  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    if (previousRequestKeyRef.current !== requestKey) {
      setVersions(undefined);
      previousRequestKeyRef.current = requestKey;
    }
    void window.modus.diff
      .fileVersions({
        cwd,
        path: change.path,
        mode,
        ...(change.renamedFrom !== undefined ? { originalPath: change.renamedFrom } : {}),
        ...(commit !== undefined ? { commit } : {}),
      })
      .then((next: DiffFileVersions) => {
        if (!cancelled) setVersions(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, change.path, change.renamedFrom, mode, commit, refreshToken, requestKey]);

  if (error) {
    return <Notice>{error}</Notice>;
  }
  if (!versions) {
    return <Notice>Loading diff…</Notice>;
  }
  if (versions.binary) {
    return (
      <Notice>
        <IconFileUnknown className="mr-1.5 inline-block align-text-bottom" size={14} stroke={1.7} />
        Binary file — no text preview.
      </Notice>
    );
  }

  // Whole-file add/delete: one side is empty, so there is nothing to *compare*.
  // A diff editor would model the empty side as a lone empty line and render it
  // as a phantom red (removed) line. Render the non-empty side in a plain editor
  // washed entirely added/removed — the authoritative, phantom-free view.
  const wholeAdd = versions.original === "" && versions.modified !== "";
  const wholeDelete = versions.modified === "" && versions.original !== "";
  if (wholeAdd || wholeDelete) {
    return (
      <div className="relative mx-1 mb-1 flex flex-col overflow-hidden rounded-lg bg-code-bg">
        {versions.truncated ? (
          <span className="pointer-events-none absolute top-1.5 right-2 z-10 rounded bg-elevated/90 px-1.5 py-0.5 text-2xs text-fg-faint shadow-popup">
            Large file — preview truncated
          </span>
        ) : null}
        <CodeViewer
          autoHeight
          content={wholeAdd ? versions.modified : versions.original}
          maxHeight={560}
          path={change.path}
          tint={wholeAdd ? "added" : "removed"}
        />
      </div>
    );
  }

  return (
    <div className="relative mx-1 mb-1 flex flex-col overflow-hidden rounded-lg bg-code-bg">
      {versions.truncated ? (
        <span className="pointer-events-none absolute top-1.5 right-2 z-10 rounded bg-elevated/90 px-1.5 py-0.5 text-2xs text-fg-faint shadow-popup">
          Large file — preview truncated
        </span>
      ) : null}
      <DiffViewer
        autoHeight
        ignoreWhitespace={ignoreWhitespace}
        maxHeight={560}
        modified={versions.modified}
        original={versions.original}
        originalPath={change.renamedFrom}
        path={change.path}
        sideBySide={sideBySide}
        wordWrap={false}
      />
    </div>
  );
}

export function previewRequestKey(input: {
  cwd: string;
  path: string;
  mode: "unstaged" | "staged";
  originalPath?: string | undefined;
  commit?: string | undefined;
}): string {
  return [input.cwd, input.path, input.mode, input.originalPath ?? "", input.commit ?? ""].join(
    "\0",
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-1 mb-1 rounded-lg bg-code-bg px-4 py-3 text-fg-faint text-xs">
      {children}
    </div>
  );
}
