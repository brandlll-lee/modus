import { useEffect, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { materialIconForFile } from "../files/fileIcons";

/** Soft gate before FS resolve — not an extension allowlist. */
export function looksLikeFileRef(text: string): boolean {
  const core = fileRefCore(text);
  if (!core || /\s/.test(core)) {
    return false;
  }
  return core.includes(".") || core.includes("/") || core.includes("\\");
}

export function fileRefCore(text: string): string {
  return text.trim();
}

function joinWorkspacePath(cwd: string, ref: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(ref) || ref.startsWith("/") || ref.startsWith("\\\\")) {
    return ref;
  }
  const sep = cwd.includes("\\") ? "\\" : "/";
  return `${cwd.replace(/[\\/]+$/, "")}${sep}${ref.replace(/^[\\/]+/, "").replace(/\//g, sep)}`;
}

function isBareBasename(ref: string): boolean {
  return !ref.includes("/") && !ref.includes("\\") && !/^[a-zA-Z]:/.test(ref);
}

/** Bound for basename walk — resource cap, not a judgment heuristic. */
const BASENAME_WALK_MAX = 400;

/**
 * Exact-name walk via `files.list` when the model cites a bare basename.
 * Authority is directory listing equality, not path guessing.
 */
async function findByExactBasename(cwd: string, name: string): Promise<string | undefined> {
  const queue: Array<string | undefined> = [undefined];
  let visits = 0;
  while (queue.length > 0 && visits < BASENAME_WALK_MAX) {
    const dir = queue.shift();
    visits += 1;
    let entries;
    try {
      entries = await window.modus.files.list({ cwd, ...(dir ? { dir } : {}) });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.kind === "file" && entry.name === name) {
        return entry.path;
      }
      if (entry.kind === "directory") {
        queue.push(entry.relativePath);
      }
    }
  }
  return undefined;
}

const resolveCache = new Map<string, string | null>();

/** Resolve a path-like ref against the workspace; null means "not a file here". */
export async function resolveWorkspaceFileRef(
  cwd: string,
  ref: string,
): Promise<string | undefined> {
  const core = fileRefCore(ref);
  const key = `${cwd}::${core}`;
  if (resolveCache.has(key)) {
    const cached = resolveCache.get(key);
    return cached ?? undefined;
  }
  const candidates = [joinWorkspacePath(cwd, core), core];
  for (const path of candidates) {
    try {
      const result = await window.modus.files.read({ cwd, path });
      if (!result.binary) {
        resolveCache.set(key, result.path);
        return result.path;
      }
    } catch {
      // try next candidate
    }
  }
  if (isBareBasename(core)) {
    const found = await findByExactBasename(cwd, core);
    if (found) {
      resolveCache.set(key, found);
      return found;
    }
  }
  resolveCache.set(key, null);
  return undefined;
}

type FileRefChipProps = {
  path: string;
  label?: string;
  onOpen(path: string): void;
  className?: string;
};

/** Same blue atom as markdown links / composer context tokens — not a filled chip. */
export function FileRefChip({ path, label, onOpen, className }: FileRefChipProps) {
  const name = label ?? path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
  const iconUrl = materialIconForFile(name);
  return (
    <a
      className={cn(
        "inline-flex max-w-[260px] cursor-pointer items-center gap-1 align-[-0.15em] text-sm font-medium",
        className,
      )}
      href={`#file=${encodeURIComponent(path)}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen(path);
      }}
      title={path}
    >
      {iconUrl ? (
        <img alt="" className="size-3 shrink-0" draggable={false} src={iconUrl} />
      ) : null}
      <span className="truncate">{name}</span>
    </a>
  );
}

type MarkdownFileCodeProps = {
  children: ReactNode;
  className?: string | undefined;
  cwd: string | undefined;
  onOpenFile: ((path: string) => void) | undefined;
};

/**
 * Upgrade path-like inline code to a FileRefChip when the workspace can resolve it.
 * Otherwise keep the ordinary inline code styling.
 */
export function MarkdownFileCode({
  children,
  className,
  cwd,
  onOpenFile,
  ...props
}: MarkdownFileCodeProps & Record<string, unknown>) {
  const text = String(children ?? "");
  const [resolved, setResolved] = useState<string | undefined>();

  useEffect(() => {
    if (!cwd || !onOpenFile || !looksLikeFileRef(text)) {
      setResolved(undefined);
      return;
    }
    let cancelled = false;
    void resolveWorkspaceFileRef(cwd, text).then((path) => {
      if (!cancelled) {
        setResolved(path);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [cwd, onOpenFile, text]);

  if (resolved && onOpenFile) {
    return <FileRefChip onOpen={onOpenFile} path={resolved} />;
  }

  return (
    <code className={cn("modus-markdown-inline-code", className)} {...props}>
      {children}
    </code>
  );
}
