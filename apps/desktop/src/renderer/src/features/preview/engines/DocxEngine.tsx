import { renderAsync } from "docx-preview";
import { useEffect, useRef, useState } from "react";
import { attachDomExcerptChrome, pageLocatorFromAnchor } from "../domExcerptChrome";
import type { PreviewEngineProps } from "../registry";

/** Word (.docx) preview via docx-preview → HTML + shared excerpt Add-to-Chat. */
export default function DocxEngine({ bytes, path, onAddToChat }: PreviewEngineProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onAddRef = useRef(onAddToChat);
  const pathRef = useRef(path);
  const [error, setError] = useState<string | undefined>();

  onAddRef.current = onAddToChat;
  pathRef.current = path;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    host.replaceChildren();

    const detachChrome = attachDomExcerptChrome(host, {
      getPath: () => pathRef.current,
      getOnAdd: () => onAddRef.current,
      locatorFromAnchor: pageLocatorFromAnchor,
    });

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
      detachChrome();
      host.replaceChildren();
    };
  }, [bytes, path]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-fg-faint text-xs">
        {error}
      </div>
    );
  }
  return (
    <div
      className="scroll-thin modus-docx-host h-full overflow-auto bg-canvas px-4 py-3 text-fg"
      ref={hostRef}
    />
  );
}
