import {
  IconChevronRight,
  IconFile,
  IconFileText,
  IconFolder,
  IconFolderOpen,
  IconFolders,
} from "@tabler/icons-react";
import { animate, m, useMotionValue } from "motion/react";
import { type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileEntry, FileReadResult } from "../../../../shared/contracts";
import { CodeViewer } from "../../components/code/CodeViewer";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";
import { MarkdownMessage } from "../agent/MarkdownMessage";

/**
 * VS-Code-style file panel: a lazy directory tree on the left, a read-only
 * viewer on the right (Monaco for code, the shared Markdown renderer for `.md`).
 *
 * The tree column is resizable (drag the divider) and collapsible (the folder
 * toggle in the toolbar animates its width to 0 and back), mirroring the
 * Inspector's own motion-value resize so dragging never re-renders the tree.
 *
 * Lazy by design — only the root and the children of expanded folders are ever
 * fetched/mounted, so a large repo stays smooth without a virtualization layer.
 *
 * `activeDoc` lets a caller show a document that isn't in the workspace tree
 * (e.g. a plan.md stored outside the repo); it takes precedence over the tree
 * selection until the user clicks a file.
 */

type ActiveDoc = { path: string; title: string; content: string };

type FilesPanelProps = {
  cwd: string | undefined;
  activeDoc?: ActiveDoc | undefined;
};

type FlatNode = { entry: FileEntry; depth: number };

const DEFAULT_TREE_WIDTH = 240;
const MIN_TREE_WIDTH = 180;
const MAX_TREE_WIDTH = 480;
const TREE_TRANSITION = { duration: 0.2, ease: [0.22, 1, 0.36, 1] } as const;

function isMarkdown(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path);
}

export function FilesPanel({ cwd, activeDoc }: FilesPanelProps) {
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [childrenByPath, setChildrenByPath] = useState<Map<string, FileEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<FileReadResult | undefined>();
  const [fileError, setFileError] = useState<string | undefined>();
  // The injected doc overrides the tree selection until the user picks a file.
  const [docActive, setDocActive] = useState(false);

  // Tree width as a motion value (live drag writes straight to the DOM, no React
  // re-render per frame) + the committed width that the open animation targets.
  const [treeOpen, setTreeOpen] = useState(true);
  const [treeWidth, setTreeWidth] = useState(DEFAULT_TREE_WIDTH);
  const treeW = useMotionValue(DEFAULT_TREE_WIDTH);
  const dragRef = useRef<{ x: number; width: number } | null>(null);
  const latestWidthRef = useRef(DEFAULT_TREE_WIDTH);

  // Animate the column open/closed; never re-animate mid-drag (pointer owns it).
  useEffect(() => {
    if (dragRef.current) {
      return;
    }
    const controls = animate(treeW, treeOpen ? treeWidth : 0, TREE_TRANSITION);
    return () => controls.stop();
  }, [treeOpen, treeWidth, treeW]);

  // (Re)load the root whenever the workspace changes; reset all tree state.
  useEffect(() => {
    setRootEntries([]);
    setChildrenByPath(new Map());
    setExpanded(new Set());
    setSelectedFile(undefined);
    setFileError(undefined);
    if (!cwd) {
      return;
    }
    let active = true;
    void window.modus.files
      .list({ cwd })
      .then((entries: FileEntry[]) => {
        if (active) {
          setRootEntries(entries);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [cwd]);

  // A new injected doc (e.g. a freshly written plan) takes over the viewer.
  useEffect(() => {
    if (activeDoc) {
      setDocActive(true);
    }
  }, [activeDoc]);

  function startResize(event: PointerEvent<HTMLButtonElement>): void {
    event.preventDefault();
    dragRef.current = { x: event.clientX, width: treeWidth };
    latestWidthRef.current = treeWidth;
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function resize(event: PointerEvent<HTMLButtonElement>): void {
    if (!dragRef.current) {
      return;
    }
    // Tree is on the left, so dragging the divider right widens it.
    const next = Math.min(
      MAX_TREE_WIDTH,
      Math.max(MIN_TREE_WIDTH, dragRef.current.width + event.clientX - dragRef.current.x),
    );
    latestWidthRef.current = next;
    treeW.set(next);
  }

  function stopResize(): void {
    if (!dragRef.current) {
      return;
    }
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setTreeWidth(latestWidthRef.current);
  }

  const toggleDir = useCallback(
    (entry: FileEntry) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(entry.path)) {
          next.delete(entry.path);
          return next;
        }
        next.add(entry.path);
        if (!childrenByPath.has(entry.path) && cwd) {
          setLoading((l) => new Set(l).add(entry.path));
          void window.modus.files
            .list({ cwd, dir: entry.path })
            .then((entries: FileEntry[]) => {
              setChildrenByPath((map) => new Map(map).set(entry.path, entries));
            })
            .catch(() => {
              setChildrenByPath((map) => new Map(map).set(entry.path, []));
            })
            .finally(() => {
              setLoading((l) => {
                const n = new Set(l);
                n.delete(entry.path);
                return n;
              });
            });
        }
        return next;
      });
    },
    [childrenByPath, cwd],
  );

  const openFile = useCallback(
    (entry: FileEntry) => {
      if (!cwd) {
        return;
      }
      setDocActive(false);
      setFileError(undefined);
      void window.modus.files
        .read({ cwd, path: entry.path })
        .then(setSelectedFile)
        .catch((error: unknown) => {
          setSelectedFile(undefined);
          setFileError(error instanceof Error ? error.message : String(error));
        });
    },
    [cwd],
  );

  // Flatten the expanded tree into the visible rows (DFS, dirs already sorted).
  const rows = useMemo<FlatNode[]>(() => {
    const out: FlatNode[] = [];
    const walk = (entries: FileEntry[], depth: number): void => {
      for (const entry of entries) {
        out.push({ entry, depth });
        if (entry.kind === "directory" && expanded.has(entry.path)) {
          const children = childrenByPath.get(entry.path);
          if (children) {
            walk(children, depth + 1);
          }
        }
      }
    };
    walk(rootEntries, 0);
    return out;
  }, [rootEntries, expanded, childrenByPath]);

  const selectedPath = docActive ? activeDoc?.path : selectedFile?.path;
  const viewerLabel = docActive ? activeDoc?.title : selectedFile?.relativePath;
  const viewerNote = !docActive && selectedFile?.truncated ? "preview truncated" : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-hairline border-b pr-1.5 pl-3">
        <span
          className="min-w-0 flex-1 truncate font-mono text-fg-muted text-xs"
          title={viewerLabel}
        >
          {viewerLabel ?? ""}
        </span>
        {viewerNote ? <span className="shrink-0 text-2xs text-fg-faint">{viewerNote}</span> : null}
        <Tooltip content={treeOpen ? "Hide file tree" : "Show file tree"} side="bottom">
          <button
            aria-label="Toggle file tree"
            aria-pressed={treeOpen}
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-hover",
              treeOpen ? "text-fg-subtle" : "text-fg-faint hover:text-fg-subtle",
            )}
            onClick={() => setTreeOpen((open) => !open)}
            type="button"
          >
            <IconFolders size={15} stroke={1.65} />
          </button>
        </Tooltip>
      </div>

      <div className="flex min-h-0 flex-1">
        <m.div
          className="shrink-0 overflow-hidden border-hairline border-r"
          style={{ width: treeW }}
        >
          <div className="scroll-thin h-full overflow-y-auto overflow-x-hidden py-1">
            {rows.length === 0 ? (
              <div className="px-3 py-2 text-fg-faint text-xs">
                {cwd ? "Empty" : "No workspace"}
              </div>
            ) : (
              rows.map(({ entry, depth }) => (
                <FileRow
                  depth={depth}
                  entry={entry}
                  expanded={expanded.has(entry.path)}
                  key={entry.path}
                  loading={loading.has(entry.path)}
                  onActivate={() =>
                    entry.kind === "directory" ? toggleDir(entry) : openFile(entry)
                  }
                  selected={entry.path === selectedPath}
                />
              ))
            )}
          </div>
        </m.div>

        {treeOpen ? (
          <button
            aria-label="Resize file tree"
            className="-ml-px relative z-10 w-1 shrink-0 cursor-col-resize transition-colors hover:bg-chip-strong"
            onPointerCancel={stopResize}
            onPointerDown={startResize}
            onPointerMove={resize}
            onPointerUp={stopResize}
            type="button"
          />
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <FileViewer
            activeDoc={docActive ? activeDoc : undefined}
            error={fileError}
            file={docActive ? undefined : selectedFile}
          />
        </div>
      </div>
    </div>
  );
}

function FileRow({
  entry,
  depth,
  expanded,
  loading,
  selected,
  onActivate,
}: {
  entry: FileEntry;
  depth: number;
  expanded: boolean;
  loading: boolean;
  selected: boolean;
  onActivate: () => void;
}) {
  const isDir = entry.kind === "directory";
  const DirIcon = expanded ? IconFolderOpen : IconFolder;
  const FileIcon = isMarkdown(entry.path) ? IconFileText : IconFile;
  return (
    <button
      className={cn(
        "flex h-[26px] w-full min-w-0 items-center gap-1 rounded-md pr-2 text-left text-[13px] transition-colors",
        selected ? "bg-active text-fg" : "text-fg-subtle hover:bg-hover hover:text-fg-muted",
      )}
      onClick={onActivate}
      style={{ paddingLeft: `${6 + depth * 12}px` }}
      title={entry.relativePath}
      type="button"
    >
      {isDir ? (
        <IconChevronRight
          className={cn(
            "shrink-0 text-fg-faint transition-transform duration-150",
            expanded && "rotate-90",
            loading && "animate-pulse",
          )}
          size={13}
          stroke={2}
        />
      ) : (
        <span className="w-[13px] shrink-0" />
      )}
      {isDir ? (
        <DirIcon className="shrink-0 text-fg-faint" size={14} stroke={1.7} />
      ) : (
        <FileIcon className="shrink-0 text-fg-faint" size={14} stroke={1.7} />
      )}
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
    </button>
  );
}

function FileViewer({
  activeDoc,
  file,
  error,
}: {
  activeDoc: ActiveDoc | undefined;
  file: FileReadResult | undefined;
  error: string | undefined;
}) {
  if (activeDoc) {
    return (
      <div className="scroll-thin h-full overflow-auto px-4 py-3">
        <MarkdownMessage content={activeDoc.content} />
      </div>
    );
  }
  if (error) {
    return <Centered>{error}</Centered>;
  }
  if (!file) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <IconFolders className="text-fg-faint/55" size={30} stroke={1.4} />
        <div className="font-medium text-fg-subtle text-sm">No file open</div>
        <div className="text-fg-faint text-xs">Select a file from the workspace tree</div>
      </div>
    );
  }
  if (file.binary) {
    return <Centered>Binary file — no preview.</Centered>;
  }
  return isMarkdown(file.path) ? (
    <div className="scroll-thin h-full overflow-auto px-4 py-3">
      <MarkdownMessage content={file.content} />
    </div>
  ) : (
    <CodeViewer className="h-full" content={file.content} path={file.relativePath} />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-fg-faint text-xs">
      {children}
    </div>
  );
}
