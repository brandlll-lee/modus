import { Menu } from "@base-ui/react/menu";
import {
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconDots,
  IconExternalLink,
  IconFile,
  IconFileText,
  IconFolder,
  IconFolderOpen,
  IconFolders,
  IconSearch,
} from "@tabler/icons-react";
import { animate, m, useMotionValue } from "motion/react";
import {
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FileEntry, FileReadResult } from "../../../../shared/contracts";
import { CodeViewer } from "../../components/code/CodeViewer";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";
import { MarkdownMessage } from "../agent/MarkdownMessage";
import { materialIconForEntry } from "./fileIcons";

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
 */

type FilesPanelProps = {
  cwd: string | undefined;
};

type FlatNode = { entry: FileEntry; depth: number };

const DEFAULT_TREE_WIDTH = 240;
const MIN_TREE_WIDTH = 180;
const MAX_TREE_WIDTH = 480;
const TREE_TRANSITION = { duration: 0.2, ease: [0.22, 1, 0.36, 1] } as const;

function isMarkdown(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path);
}

export function FilesPanel({ cwd }: FilesPanelProps) {
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [childrenByPath, setChildrenByPath] = useState<Map<string, FileEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<FileReadResult | undefined>();
  const [fileError, setFileError] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [wordWrap, setWordWrap] = useState(false);

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

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(({ entry }) =>
      `${entry.name} ${entry.relativePath}`.toLowerCase().includes(needle),
    );
  }, [rows, query]);

  const selectedPath = selectedFile?.path;
  const viewerNote = selectedFile?.truncated ? "preview truncated" : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="toolbar-row flex shrink-0 items-center gap-2 border-hairline border-b pr-1.5 pl-3">
        <FileBreadcrumb cwd={cwd} file={selectedFile} />
        {viewerNote ? <span className="shrink-0 text-2xs text-fg-faint">{viewerNote}</span> : null}
        <FileActions
          cwd={cwd}
          file={selectedFile}
          onToggleWordWrap={() => setWordWrap((value) => !value)}
          wordWrap={wordWrap}
        />
        <Tooltip content={treeOpen ? "Hide file tree" : "Show file tree"} side="bottom">
          <button
            aria-label="Toggle file tree"
            aria-pressed={treeOpen}
            className={cn(
              "toolbar-icon-button flex shrink-0 items-center justify-center rounded-md transition-colors hover:bg-hover",
              treeOpen && "bg-active",
            )}
            data-active={treeOpen}
            onClick={() => setTreeOpen((open) => !open)}
            type="button"
          >
            <IconFolders size={18} stroke={1.7} />
          </button>
        </Tooltip>
      </div>

      <div className="flex min-h-0 flex-1">
        <m.div
          className="shrink-0 overflow-hidden border-hairline border-r"
          style={{ width: treeW }}
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className="shrink-0 px-2 pt-2 pb-1">
              <label className="relative block">
                <IconSearch
                  className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 toolbar-icon"
                  size={16}
                  stroke={1.7}
                />
                <input
                  className="h-8 w-full rounded-lg border border-hairline bg-surface pr-2.5 pl-8 text-fg text-sm outline-none transition-colors placeholder:text-fg-faint focus:border-hairline-strong focus:bg-elevated"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter files..."
                  spellCheck={false}
                  type="search"
                  value={query}
                />
              </label>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1.5 py-1">
              {rows.length === 0 ? (
                <div className="px-3 py-2 text-fg-faint text-xs">
                  {cwd ? "Empty" : "No workspace"}
                </div>
              ) : visibleRows.length === 0 ? (
                <div className="px-3 py-2 text-fg-faint text-xs">No matches</div>
              ) : (
                visibleRows.map(({ entry, depth }) => (
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
          <FileViewer error={fileError} file={selectedFile} wordWrap={wordWrap} />
        </div>
      </div>
    </div>
  );
}

function FileBreadcrumb({
  cwd,
  file,
}: {
  cwd: string | undefined;
  file: FileReadResult | undefined;
}) {
  const root = cwd?.split(/[\\/]/).filter(Boolean).at(-1) ?? "workspace";
  const parts = file?.relativePath.split("/").filter(Boolean) ?? [];
  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-sm"
      title={file?.relativePath ?? root}
    >
      <span className="shrink-0 truncate text-fg-muted">{root}</span>
      {parts.map((part, index) => {
        const last = index === parts.length - 1;
        const key = parts.slice(0, index + 1).join("/");
        return (
          <span className="flex min-w-0 items-center gap-1.5" key={key}>
            <IconChevronRight className="toolbar-icon shrink-0" size={15} stroke={1.8} />
            <span
              className={cn("min-w-0 truncate", last ? "font-medium text-fg" : "text-fg-muted")}
            >
              {part}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function FileActions({
  cwd,
  file,
  wordWrap,
  onToggleWordWrap,
}: {
  cwd: string | undefined;
  file: FileReadResult | undefined;
  wordWrap: boolean;
  onToggleWordWrap(): void;
}) {
  const disabled = !cwd || !file;
  const openFile = (): void => {
    if (!cwd || !file) return;
    void window.modus.file.open({ cwd, path: file.path });
  };
  const openFolder = (): void => {
    if (!cwd || !file) return;
    void window.modus.file.open({ cwd, path: parentPath(file.path) });
  };
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1">
      <Menu.Root>
        <Menu.Trigger
          aria-label="File options"
          className="toolbar-icon-button flex items-center justify-center rounded-md outline-none transition-colors hover:bg-hover data-popup-open:bg-hover disabled:opacity-35"
          disabled={disabled}
        >
          <IconDots size={18} stroke={1.8} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="end" side="bottom" sideOffset={6}>
            <Menu.Popup className="origin-(--transform-origin) min-w-[190px] popup-chrome p-1">
              <MenuAction
                icon={<IconCopy size={16} stroke={1.75} />}
                onClick={() => file && void navigator.clipboard.writeText(file.path)}
              >
                Copy Path
              </MenuAction>
              <MenuAction
                disabled={!file || file.binary}
                icon={<IconFileText size={16} stroke={1.75} />}
                onClick={() => file && void navigator.clipboard.writeText(file.content)}
              >
                Copy File Contents
              </MenuAction>
              <MenuAction
                closeOnClick={false}
                icon={wordWrap ? <IconCheck size={16} stroke={1.8} /> : <span className="size-4" />}
                onClick={onToggleWordWrap}
              >
                Word Wrap
              </MenuAction>
              <div className="my-1 h-px bg-hairline" />
              <MenuAction icon={<IconFolderOpen size={16} stroke={1.75} />} onClick={openFolder}>
                Open Containing Folder
              </MenuAction>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <button
        className="flex h-8 items-center gap-1.5 rounded-lg border border-hairline bg-surface px-2.5 text-fg text-xs outline-none transition-colors hover:bg-hover disabled:opacity-35"
        disabled={disabled}
        onClick={openFile}
        type="button"
      >
        <IconExternalLink size={16} stroke={1.75} />
        Open
      </button>
      <Tooltip content="Open containing folder" side="bottom">
        <button
          aria-label="Open containing folder"
          className="toolbar-icon-button flex items-center justify-center rounded-md transition-colors hover:bg-hover disabled:opacity-35"
          disabled={disabled}
          onClick={openFolder}
          type="button"
        >
          <IconFolderOpen size={18} stroke={1.7} />
        </button>
      </Tooltip>
    </div>
  );
}

function MenuAction({
  children,
  closeOnClick,
  disabled,
  icon,
  onClick,
}: {
  children: ReactNode;
  closeOnClick?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  onClick(): void;
}) {
  return (
    <Menu.Item
      className="flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 text-fg text-sm outline-none select-none data-disabled:opacity-35 data-highlighted:bg-hover"
      closeOnClick={closeOnClick}
      disabled={disabled}
      onClick={onClick}
    >
      {icon ? (
        <span className="flex size-4 items-center justify-center text-fg-muted">{icon}</span>
      ) : null}
      <span className="flex-1">{children}</span>
    </Menu.Item>
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
  const iconUrl = materialIconForEntry(entry, expanded);
  return (
    <button
      className={cn(
        "flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-sm transition-colors",
        selected ? "bg-active text-fg" : "text-fg hover:bg-hover",
      )}
      onClick={onActivate}
      style={{ paddingLeft: `${7 + depth * 14}px` }}
      title={entry.relativePath}
      type="button"
    >
      {isDir ? (
        <IconChevronRight
          className={cn(
            "toolbar-icon shrink-0 transition-transform duration-150",
            expanded && "rotate-90",
            loading && "animate-pulse",
          )}
          size={15}
          stroke={2}
        />
      ) : (
        <span className="w-[15px] shrink-0" />
      )}
      {iconUrl ? (
        <img alt="" className="size-[18px] shrink-0" draggable={false} src={iconUrl} />
      ) : isDir ? (
        <DirIcon className="toolbar-icon shrink-0" size={18} stroke={1.7} />
      ) : (
        <FileIcon className="toolbar-icon shrink-0" size={18} stroke={1.7} />
      )}
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
    </button>
  );
}

function FileViewer({
  file,
  error,
  wordWrap,
}: {
  file: FileReadResult | undefined;
  error: string | undefined;
  wordWrap: boolean;
}) {
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
    <CodeViewer
      className="h-full"
      content={file.content}
      path={file.relativePath}
      wordWrap={wordWrap}
    />
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-fg-faint text-xs">
      {children}
    </div>
  );
}

function parentPath(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index > 0 ? path.slice(0, index) : ".";
}
