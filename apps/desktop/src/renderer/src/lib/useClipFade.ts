import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * Authoritative "is this content taller than its clipped box" signal.
 *
 * Uses real layout metrics (scrollHeight vs clientHeight). Pass `active=false`
 * while the clip surface is unmounted (e.g. edit composer swapped in) so the
 * effect cleans up; flipping back to `true` rebinds and remeasures. A mount-once
 * `useEffect([])` fails that remount path — detached ResizeObserver callbacks
 * can clear `clipped` and nothing remeasures.
 *
 * Apply `.clip-fade` to the clipped viewport (`boxRef`), not the tall inner
 * content — mask percentages resolve against the masked element's own box.
 */
export function useClipFade(active = true): {
  boxRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  clipped: boolean;
} {
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    if (!active) return;
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content) return;

    const measure = () => {
      if (!box.isConnected) return;
      const next = box.scrollHeight - box.clientHeight > 1;
      setClipped((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [active]);

  return { boxRef, contentRef, clipped };
}
