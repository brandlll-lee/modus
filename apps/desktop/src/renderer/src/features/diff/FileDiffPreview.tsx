import { IconFileUnknown } from "@tabler/icons-react";
import { type CSSProperties, useState } from "react";
import type { DiffFilePatch, DiffTarget } from "../../../../shared/contracts";
import { useTheme } from "../../lib/theme";

export type DiffPreviewRequest = {
  cwd: string;
  path: string;
  target: DiffTarget;
  originalPath?: string | undefined;
  untracked: boolean;
  ignoreWhitespace: boolean;
};

type FileDiffPreviewProps = {
  request: DiffPreviewRequest;
  sideBySide: boolean;
  changedLines: number;
  binary: boolean;
};

type PatchDiffComponent = typeof import("@pierre/diffs/react").PatchDiff;
type PreviewEntry = {
  promise: Promise<void>;
  value?: DiffFilePatch | undefined;
  error?: string | undefined;
};

const LARGE_CHANGED_LINES = 500;
const LARGE_PREVIEW_BYTES = 2_187_500;
const MAX_LINE_LENGTH = 5_000;
const previewCache = new Map<string, PreviewEntry>();
let PatchDiffView: PatchDiffComponent | undefined;
let rendererPromise: Promise<void> | undefined;
let rendererError: string | undefined;

export function clearDiffPreviewCache(): void {
  previewCache.clear();
}

export async function preloadInlineDiffRenderer(): Promise<void> {
  if (PatchDiffView) return;
  rendererPromise ??= import("@pierre/diffs/react")
    .then((module) => {
      PatchDiffView = module.PatchDiff;
      rendererError = undefined;
    })
    .catch((cause: unknown) => {
      rendererError = messageFrom(cause);
      rendererPromise = undefined;
    });
  await rendererPromise;
}

export async function prepareDiffPreview(request: DiffPreviewRequest): Promise<void> {
  await Promise.all([ensurePreview(request).promise, preloadInlineDiffRenderer()]);
}

export function FileDiffPreview({
  request,
  sideBySide,
  changedLines,
  binary,
}: FileDiffPreviewProps) {
  const [theme] = useTheme();
  const [allowLarge, setAllowLarge] = useState(false);
  const [preparingLarge, setPreparingLarge] = useState(false);

  if (binary) {
    return (
      <Notice actions={<OpenFileButton cwd={request.cwd} path={request.path} />}>
        <IconFileUnknown className="mr-1.5 inline-block align-text-bottom" size={14} stroke={1.7} />
        Binary file — no text preview.
      </Notice>
    );
  }

  if (changedLines > LARGE_CHANGED_LINES && !allowLarge) {
    return (
      <LargeNotice
        busy={preparingLarge}
        detail={`${changedLines.toLocaleString()} changed lines`}
        onOpen={() => void prepareLarge()}
      />
    );
  }

  const entry = previewCache.get(previewRequestKey(request));
  if (entry?.error) return <Notice>{entry.error}</Notice>;
  if (rendererError) return <Notice>{rendererError}</Notice>;
  if (!entry?.value || !PatchDiffView) return <Notice>Preview unavailable.</Notice>;

  const preview = entry.value;
  if (preview.binary || preview.truncated) {
    return (
      <Notice actions={<OpenFileButton cwd={request.cwd} path={request.path} />}>
        <IconFileUnknown className="mr-1.5 inline-block align-text-bottom" size={14} stroke={1.7} />
        {preview.binary
          ? "Binary file — no text preview."
          : "File exceeds 4 MB — open it externally."}
      </Notice>
    );
  }
  if (!preview.patch) return <Notice>No visible line changes.</Notice>;

  if (
    !allowLarge &&
    (preview.bytes > LARGE_PREVIEW_BYTES || preview.maxLineLength > MAX_LINE_LENGTH)
  ) {
    return (
      <LargeNotice
        busy={preparingLarge}
        detail={
          preview.maxLineLength > MAX_LINE_LENGTH
            ? "Contains an exceptionally long line"
            : `${(preview.bytes / 1_000_000).toFixed(1)} MB preview`
        }
        onOpen={() => void prepareLarge()}
      />
    );
  }

  return (
    <div className="relative mx-1 mb-1 overflow-hidden rounded-lg bg-code-bg">
      <PatchDiffView
        options={{
          theme: { dark: "pierre-dark", light: "pierre-light" },
          themeType: theme === "light" ? "light" : "dark",
          diffStyle: sideBySide ? "split" : "unified",
          diffIndicators: "bars",
          disableFileHeader: true,
          overflow: "scroll",
          hunkSeparators: "line-info-basic",
          lineDiffType: sideBySide ? "word-alt" : "none",
          maxLineDiffLength: 1_000,
          tokenizeMaxLineLength: MAX_LINE_LENGTH,
        }}
        patch={preview.patch}
        style={
          {
            "--diffs-font-family": "var(--font-mono)",
            "--diffs-font-size": "13px",
            "--diffs-line-height": "22px",
            "--diffs-tab-size": 2,
          } as CSSProperties
        }
      />
    </div>
  );

  async function prepareLarge(): Promise<void> {
    setPreparingLarge(true);
    try {
      await prepareDiffPreview(request);
      setAllowLarge(true);
    } finally {
      setPreparingLarge(false);
    }
  }
}

function ensurePreview(request: DiffPreviewRequest): PreviewEntry {
  const key = previewRequestKey(request);
  const cached = previewCache.get(key);
  if (cached) return cached;

  const entry: PreviewEntry = { promise: Promise.resolve() };
  entry.promise = window.modus.diff
    .filePatch({
      cwd: request.cwd,
      path: request.path,
      target: request.target,
      ...(request.originalPath !== undefined ? { originalPath: request.originalPath } : {}),
      untracked: request.untracked,
      ignoreWhitespace: request.ignoreWhitespace,
    })
    .then((value: DiffFilePatch) => {
      entry.value = value;
    })
    .catch((cause: unknown) => {
      entry.error = messageFrom(cause);
    });
  previewCache.set(key, entry);
  return entry;
}

export function previewRequestKey(input: DiffPreviewRequest): string {
  return [
    input.cwd,
    input.path,
    JSON.stringify(input.target),
    input.originalPath ?? "",
    input.untracked,
    input.ignoreWhitespace,
  ].join("\0");
}

function LargeNotice({ busy, detail, onOpen }: { busy: boolean; detail: string; onOpen(): void }) {
  return (
    <Notice
      actions={
        <button
          className="rounded-md bg-hover px-2 py-1 text-fg disabled:opacity-50"
          disabled={busy}
          onClick={onOpen}
          type="button"
        >
          {busy ? "Preparing…" : "Render anyway"}
        </button>
      }
    >
      Large diff — {detail}.
    </Notice>
  );
}

function OpenFileButton({ cwd, path }: { cwd: string; path: string }) {
  return (
    <button
      className="rounded-md bg-hover px-2 py-1 text-fg"
      onClick={() => void window.modus.file.open({ cwd, path })}
      type="button"
    >
      Open file
    </button>
  );
}

function Notice({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mx-1 mb-1 flex items-center justify-between gap-3 rounded-lg bg-code-bg px-4 py-3 text-fg-faint text-xs">
      <span>{children}</span>
      {actions}
    </div>
  );
}

function messageFrom(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
