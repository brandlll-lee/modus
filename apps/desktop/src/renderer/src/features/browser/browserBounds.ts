import type { BrowserBounds } from "../../../../shared/contracts";

type BrowserHostRect = Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">;

export function computeBrowserViewBounds(rect: BrowserHostRect): BrowserBounds {
  return {
    x: Math.max(0, Math.round(rect.left)),
    y: Math.max(0, Math.round(rect.top)),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  };
}

export function sameBrowserBounds(
  previous: BrowserBounds | null | undefined,
  next: BrowserBounds,
): boolean {
  return Boolean(
    previous &&
      previous.x === next.x &&
      previous.y === next.y &&
      previous.width === next.width &&
      previous.height === next.height,
  );
}
