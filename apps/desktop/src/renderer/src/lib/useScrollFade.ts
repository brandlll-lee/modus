import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * Scroll-edge dissolve flags for a scrollport. Pair with `.scroll-fade` and
 * `data-fade-top` / `data-fade-bottom` — mask lives on the scrollport itself.
 */
export function useScrollFade(): {
  ref: RefObject<HTMLDivElement | null>;
  fadeTop: boolean;
  fadeBottom: boolean;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [fadeTop, setFadeTop] = useState(false);
  const [fadeBottom, setFadeBottom] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      if (!el.isConnected) return;
      const top = el.scrollTop > 1;
      const bottom = el.scrollHeight - el.clientHeight - el.scrollTop > 1;
      setFadeTop((prev) => (prev === top ? prev : top));
      setFadeBottom((prev) => (prev === bottom ? prev : bottom));
    };

    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) {
      observer.observe(child);
    }
    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, []);

  return { ref, fadeTop, fadeBottom };
}
