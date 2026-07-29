import { useEffect, useRef, useState } from "react";
import type { PreviewEngineProps } from "../registry";

/** PowerPoint (.pptx) preview via @aiden0z/pptx-renderer PptxViewer. */
export default function PptxEngine({ bytes }: PreviewEngineProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let viewer: { destroy?: () => void } | undefined;

    void (async () => {
      try {
        const { PptxViewer } = await import("@aiden0z/pptx-renderer");
        if (cancelled || !hostRef.current) return;
        host.replaceChildren();
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        viewer = await PptxViewer.open(copy, host, {
          renderMode: "list",
          listOptions: { windowed: true, batchSize: 8 },
        });
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      viewer?.destroy?.();
      host.replaceChildren();
    };
  }, [bytes]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-fg-faint text-xs">
        {error}
      </div>
    );
  }
  return <div className="scroll-thin h-full overflow-auto bg-canvas p-3" ref={hostRef} />;
}
