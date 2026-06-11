import { IconColumns2, IconFileUnknown, IconTextWrap } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import type { DiffFileVersions, FileChange } from "../../../../shared/contracts";
import { DiffViewer } from "../../components/code/DiffViewer";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";

/** Sticky viewer preferences, shared by every file preview across sessions. */
function usePersistentToggle(key: string, fallback: boolean): [boolean, () => void] {
  const [value, setValue] = useState(() => {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === "true";
  });
  const toggle = useCallback(() => {
    setValue((previous) => {
      localStorage.setItem(key, String(!previous));
      return !previous;
    });
  }, [key]);
  return [value, toggle];
}

type FileDiffPreviewProps = {
  cwd: string;
  change: FileChange;
  /** Bumped by the parent after stage/unstage/discard so contents refetch. */
  refreshToken?: number;
};

/**
 * The expanded body of one changed file: a real (monaco) diff with
 * side-by-side / inline and word-wrap toggles. Replaces the old plain-text
 * unified diff preview.
 */
export function FileDiffPreview({ cwd, change, refreshToken = 0 }: FileDiffPreviewProps) {
  const [versions, setVersions] = useState<DiffFileVersions | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [sideBySide, toggleSideBySide] = usePersistentToggle("modus.diff.sideBySide", true);
  const [wordWrap, toggleWordWrap] = usePersistentToggle("modus.diff.wordWrap", false);

  // Show the staged version pair only when the file has no unstaged edits left.
  const mode = change.staged && !change.unstaged ? "staged" : "unstaged";

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken is a deliberate refetch trigger bumped by the parent after stage/unstage/discard.
  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    void window.modus.diff
      .fileVersions({
        cwd,
        path: change.path,
        mode,
        ...(change.renamedFrom !== undefined ? { originalPath: change.renamedFrom } : {}),
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
  }, [cwd, change.path, change.renamedFrom, mode, refreshToken]);

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

  return (
    <div className="relative flex flex-col">
      <div className="pointer-events-none absolute top-1.5 right-2 z-10 flex items-center gap-1">
        {versions.truncated ? (
          <span className="rounded bg-elevated/90 px-1.5 py-0.5 text-2xs text-fg-faint shadow-popup">
            Large file — preview truncated
          </span>
        ) : null}
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-md border border-hairline bg-elevated/90 p-0.5 shadow-popup">
          <ViewerToggle
            active={sideBySide}
            label={sideBySide ? "Switch to inline view" : "Switch to side-by-side view"}
            onClick={toggleSideBySide}
          >
            <IconColumns2 size={14} stroke={1.7} />
          </ViewerToggle>
          <ViewerToggle
            active={wordWrap}
            label={wordWrap ? "Disable word wrap" : "Enable word wrap"}
            onClick={toggleWordWrap}
          >
            <IconTextWrap size={14} stroke={1.7} />
          </ViewerToggle>
        </div>
      </div>
      <DiffViewer
        className="h-[420px]"
        modified={versions.modified}
        original={versions.original}
        originalPath={change.renamedFrom}
        path={change.path}
        sideBySide={sideBySide}
        wordWrap={wordWrap}
      />
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="px-6 py-3 text-fg-faint text-xs">{children}</div>;
}

function ViewerToggle({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={label} side="bottom" sideOffset={6}>
      <button
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "flex size-6 items-center justify-center rounded transition-colors",
          active ? "bg-chip text-fg" : "text-fg-faint hover:bg-hover hover:text-fg-subtle",
        )}
        onClick={onClick}
        type="button"
      >
        {children}
      </button>
    </Tooltip>
  );
}
