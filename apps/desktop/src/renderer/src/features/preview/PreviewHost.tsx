import { IconExternalLink } from "@tabler/icons-react";
import { type ComponentType, useEffect, useState } from "react";
import type { ContextItem, PreviewKind, PreviewReadResult } from "../../../../shared/contracts";
import { cn } from "../../lib/cn";
import { loadPreviewEngine, type PreviewEngineProps } from "./registry";

type PreviewHostProps = {
  cwd: string;
  path: string;
  className?: string | undefined;
  onAddToChat?: ((item: ContextItem) => void) | undefined;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; preview: PreviewReadResult; Engine: ComponentType<PreviewEngineProps> | null };

/**
 * Single in-app document/image preview surface. Routes on `previewKind` from
 * main-process byte inspection — never on filename extensions.
 */
export function PreviewHost({ cwd, path, className, onAddToChat }: PreviewHostProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void (async () => {
      try {
        const preview = await window.modus.preview.read({ cwd, path });
        if (cancelled) return;
        const loader = loadPreviewEngine(preview.previewKind);
        if (!loader) {
          setState({ status: "ready", preview, Engine: null });
          return;
        }
        const mod = await loader();
        if (cancelled) return;
        setState({ status: "ready", preview, Engine: mod.default });
      } catch (error: unknown) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, path]);

  if (state.status === "loading") {
    return <Centered className={className}>Loading preview…</Centered>;
  }
  if (state.status === "error") {
    return (
      <Unsupported
        className={className}
        cwd={cwd}
        message={state.message}
        path={path}
      />
    );
  }

  const { preview, Engine } = state;
  if (!Engine || preview.previewKind === "unsupported") {
    return (
      <Unsupported
        className={className}
        cwd={cwd}
        kind={preview.previewKind}
        path={path}
      />
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <Engine
        bytes={preview.bytes}
        mime={preview.mime}
        path={preview.path}
        {...(onAddToChat ? { onAddToChat } : {})}
      />
    </div>
  );
}

function Unsupported({
  cwd,
  path,
  kind,
  message,
  className,
}: {
  cwd: string;
  path: string;
  kind?: PreviewKind;
  message?: string;
  className?: string | undefined;
}) {
  const openExternally = (): void => {
    void window.modus.file.open({ cwd, path });
  };
  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center gap-3 px-4 text-center",
        className,
      )}
    >
      <div className="text-fg-faint text-xs">
        {message ??
          (kind && kind !== "unsupported"
            ? `No renderer for ${kind}`
            : "Binary file — no in-app preview.")}
      </div>
      <button
        className="flex h-8 items-center gap-1.5 rounded-lg border border-hairline bg-surface px-2.5 text-fg text-xs outline-none transition-colors hover:bg-hover"
        onClick={openExternally}
        type="button"
      >
        <IconExternalLink size={16} stroke={1.75} />
        Open externally
      </button>
    </div>
  );
}

function Centered({
  children,
  className,
}: {
  children: string;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "flex h-full items-center justify-center px-4 text-center text-fg-faint text-xs",
        className,
      )}
    >
      {children}
    </div>
  );
}
