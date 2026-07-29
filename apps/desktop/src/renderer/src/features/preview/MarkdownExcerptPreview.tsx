import { useEffect, useRef } from "react";
import type { ContextItem } from "../../../../shared/contracts";
import { MarkdownMessage } from "../agent/MarkdownMessage";
import { attachDomExcerptChrome } from "./domExcerptChrome";

type MarkdownExcerptPreviewProps = {
  path: string;
  content: string;
  onAddToChat?: ((item: ContextItem) => void) | undefined;
};

function headingLocatorFromAnchor(anchor: Element): string | undefined {
  const heading = anchor.closest("h1, h2, h3, h4, h5, h6");
  const text = heading?.textContent?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/**
 * Files-panel markdown preview with the same DOM → excerpt Add-to-Chat chrome
 * as PDF/DOCX. Chat timeline MarkdownMessage stays untouched (no onAddToChat).
 */
export function MarkdownExcerptPreview({
  path,
  content,
  onAddToChat,
}: MarkdownExcerptPreviewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onAddRef = useRef(onAddToChat);
  const pathRef = useRef(path);
  onAddRef.current = onAddToChat;
  pathRef.current = path;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    return attachDomExcerptChrome(host, {
      getPath: () => pathRef.current,
      getOnAdd: () => onAddRef.current,
      locatorFromAnchor: headingLocatorFromAnchor,
    });
  }, []);

  return (
    <div className="scroll-thin h-full overflow-auto px-4 py-3" ref={hostRef}>
      <MarkdownMessage content={content} />
    </div>
  );
}
