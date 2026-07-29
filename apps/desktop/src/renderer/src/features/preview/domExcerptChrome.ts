import type { ContextItem } from "../../../../shared/contracts";

export type DomExcerptHit = {
  text: string;
  locator?: string;
  rect: DOMRect;
};

export type DomExcerptChromeOptions = {
  getPath(): string;
  getOnAdd(): ((item: Extract<ContextItem, { type: "excerpt" }>) => void) | undefined;
  /** Optional locator from the selection anchor (e.g. PDF `data-page` → `p.3`). */
  locatorFromAnchor?(anchor: Element): string | undefined;
};

/** Resolve a non-empty text selection that lives inside `host`. */
export function selectionHitInsideHost(
  host: HTMLElement,
  locatorFromAnchor?: (anchor: Element) => string | undefined,
): DomExcerptHit | undefined {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    return undefined;
  }
  const range = sel.getRangeAt(0);
  const anchor =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement;
  if (!anchor || !host.contains(anchor)) {
    return undefined;
  }
  const text = sel.toString().replace(/\s+/g, " ").trim();
  if (!text) {
    return undefined;
  }
  const locator = locatorFromAnchor?.(anchor);
  return {
    text,
    ...(locator ? { locator } : {}),
    rect: range.getBoundingClientRect(),
  };
}

/**
 * Shared “Add to Chat” chrome for any DOM-selectable preview (PDF TextLayer,
 * docx-preview HTML, rendered markdown). Emits `excerpt` context items.
 */
export function attachDomExcerptChrome(
  host: HTMLElement,
  options: DomExcerptChromeOptions,
): () => void {
  let pointerSelecting = false;
  const { getPath, getOnAdd, locatorFromAnchor } = options;

  const shortcut =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
      ? "⌘L"
      : "Ctrl+L";
  const widget = document.createElement("button");
  widget.type = "button";
  widget.className = "modus-add-to-chat";
  widget.innerHTML = `<span class="label">Add to Chat</span><span class="hint">${shortcut}</span>`;
  widget.style.display = "none";
  widget.style.position = "fixed";
  widget.style.zIndex = "60";
  document.body.appendChild(widget);

  const hit = (): DomExcerptHit | undefined =>
    selectionHitInsideHost(host, locatorFromAnchor);

  const syncWidget = (): void => {
    const current = hit();
    const canAdd = Boolean(current && !pointerSelecting && getOnAdd());
    if (!canAdd || !current) {
      widget.style.display = "none";
      return;
    }
    widget.style.display = "inline-flex";
    widget.style.top = `${Math.max(8, current.rect.top - 32)}px`;
    widget.style.left = `${Math.min(Math.max(8, current.rect.left), window.innerWidth - 140)}px`;
  };

  const emitAdd = (): void => {
    const current = hit();
    const add = getOnAdd();
    if (!current || !add) return;
    add({
      type: "excerpt",
      path: getPath(),
      text: current.text,
      ...(current.locator ? { locator: current.locator } : {}),
    });
  };

  const onWidgetMouseDown = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    emitAdd();
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button === 0) {
      pointerSelecting = true;
      syncWidget();
    }
  };
  const onPointerUp = (): void => {
    pointerSelecting = false;
    syncWidget();
  };
  const onSelectionChange = (): void => {
    if (!pointerSelecting) {
      syncWidget();
    }
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "l") {
      if (!hit() || !getOnAdd()) return;
      event.preventDefault();
      emitAdd();
    }
  };

  widget.addEventListener("mousedown", onWidgetMouseDown);
  host.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);
  document.addEventListener("selectionchange", onSelectionChange);
  window.addEventListener("keydown", onKeyDown);

  return () => {
    widget.removeEventListener("mousedown", onWidgetMouseDown);
    host.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("selectionchange", onSelectionChange);
    window.removeEventListener("keydown", onKeyDown);
    widget.remove();
  };
}

/** PDF / docx-preview page markers → `p.N` locator. */
export function pageLocatorFromAnchor(anchor: Element): string | undefined {
  const page = anchor.closest("[data-page]")?.getAttribute("data-page");
  return page ? `p.${page}` : undefined;
}
