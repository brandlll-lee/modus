import type { ContextItem } from "../../../../shared/contracts";
import {
  createAddToChatWidget,
  placeAddToChatWidget,
  type DomExcerptHit,
} from "./domExcerptChrome";

export type ClientRectBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type PdfRectExcerptOptions = {
  getPath(): string;
  getOnAdd(): ((item: Extract<ContextItem, { type: "excerpt" }>) => void) | undefined;
  locatorFromAnchor?(anchor: Element): string | undefined;
};

export function rectsOverlap(a: ClientRectBox, b: ClientRectBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Collect TextLayer span text whose boxes intersect `box` (document order). */
export function textInClientRect(
  host: HTMLElement,
  box: ClientRectBox,
  locatorFromAnchor?: (anchor: Element) => string | undefined,
): DomExcerptHit | undefined {
  const parts: string[] = [];
  let first: Element | undefined;
  for (const span of host.querySelectorAll<HTMLElement>(".textLayer span")) {
    const r = span.getBoundingClientRect();
    if (r.width < 0.5 || r.height < 0.5) continue;
    if (!rectsOverlap(box, r)) continue;
    const t = span.textContent ?? "";
    if (!t) continue;
    parts.push(t);
    first ??= span;
  }
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  if (!text || !first) return undefined;
  const locator = locatorFromAnchor?.(first);
  return {
    text,
    ...(locator ? { locator } : {}),
    rect: new DOMRect(box.left, box.top, box.right - box.left, box.bottom - box.top),
  };
}

/**
 * PDF excerpt via user rectangle (authoritative region). Tool button toggles
 * marquee mode; intersecting TextLayer spans supply the excerpt text.
 */
export function attachPdfRectExcerpt(
  host: HTMLElement,
  toolButton: HTMLButtonElement,
  options: PdfRectExcerptOptions,
): () => void {
  const { getPath, getOnAdd, locatorFromAnchor } = options;
  let active = false;
  let dragging = false;
  let originX = 0;
  let originY = 0;
  let box: ClientRectBox | undefined;

  const widget = createAddToChatWidget();
  const marquee = document.createElement("div");
  marquee.className = "pdf-marquee";
  marquee.setAttribute("aria-hidden", "true");
  document.body.appendChild(marquee);

  const paintMarquee = (): void => {
    if (!box) {
      marquee.style.display = "none";
      return;
    }
    marquee.style.display = "block";
    marquee.style.left = `${box.left}px`;
    marquee.style.top = `${box.top}px`;
    marquee.style.width = `${Math.max(0, box.right - box.left)}px`;
    marquee.style.height = `${Math.max(0, box.bottom - box.top)}px`;
  };

  const clearBox = (): void => {
    box = undefined;
    paintMarquee();
    widget.style.display = "none";
  };

  const syncWidget = (): void => {
    if (!box || dragging || !getOnAdd() || !textInClientRect(host, box, locatorFromAnchor)) {
      widget.style.display = "none";
      return;
    }
    placeAddToChatWidget(widget, box);
  };

  const setActive = (next: boolean): void => {
    active = next;
    toolButton.setAttribute("aria-pressed", next ? "true" : "false");
    toolButton.classList.toggle("is-active", next);
    host.classList.toggle("pdf-rect-selecting", next);
    if (!next) clearBox();
  };

  const emitAdd = (): void => {
    if (!box) return;
    const hit = textInClientRect(host, box, locatorFromAnchor);
    const add = getOnAdd();
    if (!hit || !add) return;
    add({
      type: "excerpt",
      path: getPath(),
      text: hit.text,
      ...(hit.locator ? { locator: hit.locator } : {}),
    });
    clearBox();
  };

  const onToolClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    setActive(!active);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (!active || event.button !== 0) return;
    if (event.target instanceof Node && toolButton.contains(event.target)) return;
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    dragging = true;
    originX = event.clientX;
    originY = event.clientY;
    box = { left: originX, top: originY, right: originX, bottom: originY };
    paintMarquee();
    widget.style.display = "none";
    host.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    box = {
      left: Math.min(originX, event.clientX),
      top: Math.min(originY, event.clientY),
      right: Math.max(originX, event.clientX),
      bottom: Math.max(originY, event.clientY),
    };
    paintMarquee();
  };

  const onPointerUp = (): void => {
    if (!dragging) return;
    dragging = false;
    if (!box || box.right - box.left < 4 || box.bottom - box.top < 4) {
      clearBox();
      return;
    }
    syncWidget();
  };

  const onWidgetMouseDown = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    emitAdd();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      if (box || active) {
        event.preventDefault();
        setActive(false);
      }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "l") {
      if (!box || !getOnAdd()) return;
      event.preventDefault();
      emitAdd();
    }
  };

  const onScrollOrResize = (): void => {
    if (box) clearBox();
  };

  toolButton.addEventListener("click", onToolClick);
  widget.addEventListener("mousedown", onWidgetMouseDown);
  host.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("keydown", onKeyDown);
  host.addEventListener("scroll", onScrollOrResize, { passive: true });
  window.addEventListener("resize", onScrollOrResize);

  return () => {
    setActive(false);
    toolButton.removeEventListener("click", onToolClick);
    widget.removeEventListener("mousedown", onWidgetMouseDown);
    host.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("keydown", onKeyDown);
    host.removeEventListener("scroll", onScrollOrResize);
    window.removeEventListener("resize", onScrollOrResize);
    widget.remove();
    marquee.remove();
  };
}
