import { renderAsync } from "docx-preview";
import { useEffect, useRef, useState } from "react";
import type { PreviewEngineProps } from "../registry";

export default function DocxEngine({ bytes }: PreviewEngineProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    host.replaceChildren();

    void renderAsync(bytes, host, undefined, {
      className: "modus-docx-preview",
      inWrapper: true,
      ignoreWidth: false,
      breakPages: true,
    })
      .then(() => {
        if (cancelled) host.replaceChildren();
        // docx-preview page sections often use section.docx; stamp data-page when present.
        if (!cancelled) {
          const sections = host.querySelectorAll("section.docx, .docx-wrapper > section");
          sections.forEach((section, index) => {
            if (!section.getAttribute("data-page")) {
              section.setAttribute("data-page", String(index + 1));
            }
          });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      cancelled = true;
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
  return (
    <div
      className="scroll-thin modus-docx-host preview-excerpt-host h-full overflow-auto bg-canvas px-4 py-3 text-fg"
      ref={hostRef}
    />
  );
}
