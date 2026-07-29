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
import type { FileEntry, FileReadResult, FilesChangeEvent, ContextItem } from "../../../../shared/contracts";
import { CodeViewer, type CodeSelectionRange } from "../../components/code/CodeViewer";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";
import { MarkdownExcerptPreview } from "../preview/MarkdownExcerptPreview";
import { PreviewHost } from "../preview/PreviewHost";
import { materialIconForEntry } from "./fileIcons";
import { hasLiveFilesWatch } from "./hasLiveFilesWatch";

/**
 * VS-Code-style file panel: a lazy directory tree on the left, Monaco editor
 * on the right for code (Markdown still uses the shared renderer).
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
  onAddToChat?: ((item: ContextItem) => void) | undefined;
  /** Absolute or workspace-relative path to open (from chat file chips). */
  revealPath?: string | undefined;
  /** Cleared by parent after reveal is consumed so the same path can re-trigger. */
  onRevealConsumed?: (() => void) | undefined;
};

type FlatNode = { entry: FileEntry; depth: number };

const DEFAULT_TREE_WIDTH = 240;
const MIN_TREE_WIDTH = 180;
const MAX_TREE_WIDTH = 480;
const TREE_TRANSITION = { duration: 0.2, ease: [0.22, 1, 0.36, 1] } as const;

function isMarkdown(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path);
}

function joinWorkspacePath(cwd: string, rel: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith("/") || rel.startsWith("\\\\")) {
    return rel;
  }
  const sep = cwd.includes("\\") ? "\\" : "/";
  return `${cwd.replace(/[\\/]+$/, "")}${sep}${rel.replace(/^[\\/]+/, "").replace(/\//g, sep)}`;
}

function normPath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

function samePath(a: string, b: string): boolean {
  return normPath(a) === normPath(b);
}

/** True when the open buffer should reload from disk for this change burst. */
function openFileAffected(openPath: string, changed: string[]): boolean {
  if (changed.length === 0) {
    return true;
  }
  const open = normPath(openPath);
  return changed.some((p) => {
    const hit = normPath(p);
    return open === hit || open.startsWith(`${hit}/`);
  });
}

export function FilesPanel({ cwd, onAddToChat, revealPath, onRevealConsumed }: FilesPanelProps) {
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [childrenByPath, setChildrenByPath] = useState<Map<string, FileEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<FileReadResult | undefined>();
  /** Disk snapshot after last successful read/write — dirty iff draft !== this. */
  const [savedContent, setSavedContent] = useState<string | undefined>();
  const [draftContent, setDraftContent] = useState<string | undefined>();
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
  const selectedPathRef = useRef<string | undefined>(undefined);
  const childrenKeysRef = useRef<string[]>([]);
  const savedContentRef = useRef<string | undefined>(undefined);
  selectedPathRef.current = selectedFile?.path;
  childrenKeysRef.current = [...childrenByPath.keys()];
  savedContentRef.current = savedContent;

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
    setSavedContent(undefined);
    setDraftContent(undefined);
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

  // Live workspace sync. Conflict policy: disk / AI wins — overwrite dirty drafts.
  // Preload may lag renderer HMR (Electron must restart to refresh contextBridge).
  // Missing watch API must degrade to snapshot mode — never crash the shell.
  useEffect(() => {
    if (!cwd) {
      return;
    }
    const filesApi = window.modus.files;
    if (!hasLiveFilesWatch(filesApi)) {
      return;
    }
    let watchedRoot: string | undefined;
    let cancelled = false;
    void filesApi.watch(cwd).then((root: string) => {
      if (!cancelled) {
        watchedRoot = root;
      }
    });
    const off = filesApi.onChanged((event: FilesChangeEvent) => {
      if (watchedRoot) {
        if (!samePath(event.cwd, watchedRoot)) {
          return;
        }
      } else if (!samePath(event.cwd, cwd)) {
        return;
      }

      void (async () => {
        try {
          const nextRoot = await window.modus.files.list({ cwd });
          if (cancelled) {
            return;
          }
          setRootEntries(nextRoot);

          const dirs = childrenKeysRef.current;
          if (dirs.length > 0) {
            const results = await Promise.all(
              dirs.map(async (dir) => {
                try {
                  const entries = await window.modus.files.list({ cwd, dir });
                  return [dir, entries] as const;
                } catch {
                  return [dir, [] as FileEntry[]] as const;
                }
              }),
            );
            if (cancelled) {
              return;
            }
            setChildrenByPath((prev) => {
              const next = new Map(prev);
              for (const [dir, entries] of results) {
                if (next.has(dir)) {
                  next.set(dir, entries);
                }
              }
              return next;
            });
          }

          const openPath = selectedPathRef.current;
          if (!openPath || !openFileAffected(openPath, event.paths)) {
            return;
          }
          try {
            const file = await window.modus.files.read({ cwd, path: openPath });
            if (cancelled) {
              return;
            }
            const nextText = file.binary || file.truncated ? undefined : file.content;
            // Skip echo of our own write / no-op disk bursts so post-save keystrokes
            // are not clobbered. Real external edits change content vs last snapshot.
            if (
              nextText !== undefined &&
              nextText === savedContentRef.current &&
              !file.binary &&
              !file.truncated
            ) {
              return;
            }
            setSelectedFile(file);
            setSavedContent(nextText);
            setDraftContent(nextText);
            setFileError(undefined);
          } catch (error: unknown) {
            if (cancelled) {
              return;
            }
            setSelectedFile(undefined);
            setSavedContent(undefined);
            setDraftContent(undefined);
            setFileError(error instanceof Error ? error.message : String(error));
          }
        } catch {
          // list failed — leave UI as-is for this burst
        }
      })();
    });
    return () => {
      cancelled = true;
      off();
      void filesApi.unwatch(cwd);
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
        .then((file: FileReadResult) => {
          setSelectedFile(file);
          setSavedContent(file.binary || file.truncated ? undefined : file.content);
          setDraftContent(file.binary || file.truncated ? undefined : file.content);
        })
        .catch((error: unknown) => {
          setSelectedFile(undefined);
          setSavedContent(undefined);
          setDraftContent(undefined);
          setFileError(error instanceof Error ? error.message : String(error));
        });
    },
    [cwd],
  );

  // External reveal (chat file chip): expand ancestors + open the file.
  useEffect(() => {
    if (!cwd || !revealPath) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const file = await window.modus.files.read({ cwd, path: revealPath });
        if (cancelled) {
          return;
        }
        const parts = file.relativePath.split("/").filter(Boolean);
        let acc = "";
        for (let i = 0; i < parts.length - 1; i += 1) {
          acc = acc ? `${acc}/${parts[i]}` : (parts[i] ?? "");
          const entries = await window.modus.files.list({ cwd, dir: acc });
          if (cancelled) {
            return;
          }
          const dirAbs = joinWorkspacePath(cwd, acc);
          setChildrenByPath((map) => new Map(map).set(dirAbs, entries));
          setExpanded((set) => new Set(set).add(dirAbs));
        }
        setSelectedFile(file);
        setSavedContent(file.binary || file.truncated ? undefined : file.content);
        setDraftContent(file.binary || file.truncated ? undefined : file.content);
        setFileError(undefined);
      } catch (error: unknown) {
        if (!cancelled) {
          setFileError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          onRevealConsumed?.();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, revealPath, onRevealConsumed]);

  const dirty =
    selectedFile !== undefined &&
    savedContent !== undefined &&
    draftContent !== undefined &&
    draftContent !== savedContent;

  const saveFile = useCallback(async () => {
    if (!cwd || !selectedFile || draftContent === undefined) {
      return;
    }
    if (selectedFile.binary || selectedFile.truncated) {
      return;
    }
    const result = await window.modus.files.write({
      cwd,
      path: selectedFile.path,
      content: draftContent,
    });
    setSavedContent(draftContent);
    setSelectedFile({
      ...selectedFile,
      content: draftContent,
      size: result.size,
      truncated: false,
      binary: false,
    });
  }, [cwd, draftContent, selectedFile]);

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
        <FileBreadcrumb cwd={cwd} dirty={dirty} file={selectedFile} />
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
          <FileViewer
            cwd={cwd}
            error={fileError}
            file={selectedFile}
            onChange={setDraftContent}
            onSave={() => void saveFile()}
            wordWrap={wordWrap}
            {...(onAddToChat ? { onAddToChat } : {})}
          />
        </div>
      </div>
    </div>
  );
}

function FileBreadcrumb({
  cwd,
  dirty,
  file,
}: {
  cwd: string | undefined;
  dirty: boolean;
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
            {last && dirty ? (
              <span
                aria-label="Unsaved changes"
                className="size-1.5 shrink-0 rounded-full bg-fg-muted/70"
              />
            ) : null}
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
        // Cursor-like density: airy row (36px) + 12px muted label so text floats with breathing room.
        "flex h-9 w-full min-w-0 items-center gap-1.5 rounded-sm pr-2 text-left text-[11px] font-normal leading-none transition-colors",
        selected ? "bg-active text-fg" : "text-fg hover:bg-hover",
      )}
      onClick={onActivate}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
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
          size={12}
          stroke={1.5}
        />
      ) : (
        <span className="w-3 shrink-0" />
      )}
      {iconUrl ? (
        <img alt="" className="size-3.5 shrink-0 opacity-85" draggable={false} src={iconUrl} />
      ) : isDir ? (
        <DirIcon className="shrink-0 text-fg-faint" size={14} stroke={1.4} />
      ) : (
        <FileIcon className="shrink-0 text-fg-faint" size={14} stroke={1.4} />
      )}
      <span className="min-w-0 flex-1 truncate tracking-normal">{entry.name}</span>
    </button>
  );
}

function FileViewer({
  cwd,
  file,
  error,
  wordWrap,
  onChange,
  onSave,
  onAddToChat,
}: {
  cwd: string | undefined;
  file: FileReadResult | undefined;
  error: string | undefined;
  wordWrap: boolean;
  onChange(value: string): void;
  onSave(): void;
  onAddToChat?(item: ContextItem): void;
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
    if (!cwd) {
      return <Centered>Binary file — no preview.</Centered>;
    }
    return (
      <PreviewHost
        cwd={cwd}
        path={file.path}
        {...(onAddToChat ? { onAddToChat } : {})}
      />
    );
  }
  if (isMarkdown(file.path)) {
    return (
      <MarkdownExcerptPreview
        content={file.content}
        path={file.path}
        {...(onAddToChat ? { onAddToChat } : {})}
      />
    );
  }
  // Truncated reads must stay read-only — saving would clobber the unread tail.
  const readOnly = file.truncated;
  return (
    <CodeViewer
      absolutePath={file.path}
      className="h-full"
      content={file.content}
      {...(onAddToChat
        ? {
            onAddToChat: ({ path, range }: { path: string; range: CodeSelectionRange }) =>
              onAddToChat({ type: "file", path, range }),
          }
        : {})}
      onChange={readOnly ? undefined : onChange}
      onSave={readOnly ? undefined : onSave}
      path={file.relativePath}
      readOnly={readOnly}
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
