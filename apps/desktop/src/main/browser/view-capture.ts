import type { WebContents } from "electron";

/**
 * Visible-view screenshots via Electron `webContents.capturePage`.
 *
 * Design Mode must NOT use CDP `Page.captureScreenshot({ clip })`: Chromium
 * translates the clip to the viewport origin for one frame (Playwright #29487),
 * which flashes the embedded WebContentsView. VS Code (PR #298080, 2026)
 * switched the same class of bug to `capturePage` — we follow that authority.
 *
 * Rects are viewport CSS/DIP pixels (same space as getBoundingClientRect).
 */

export type ViewRect = { x: number; y: number; width: number; height: number };

const MAX_CLIP_EDGE = 2400;
const ELEMENT_CONTEXT_RATIO = 0.45;
const MIN_ELEMENT_CONTEXT = 24;
const MAX_ELEMENT_CONTEXT = 320;
const MIN_CAPTURE_EDGE = 360;

/** Clamp a viewport rect inside the visible view (1:1 lens / annotation). */
export function clampViewportRect(rect: ViewRect, viewport: ViewRect): ViewRect {
  const viewW = Math.max(1, Math.floor(viewport.width));
  const viewH = Math.max(1, Math.floor(viewport.height));
  let width = Math.max(1, Math.floor(rect.width));
  let height = Math.max(1, Math.floor(rect.height));
  let x = Math.floor(rect.x);
  let y = Math.floor(rect.y);
  x = Math.max(0, Math.min(x, Math.max(0, viewW - 1)));
  y = Math.max(0, Math.min(y, Math.max(0, viewH - 1)));
  width = Math.min(MAX_CLIP_EDGE, Math.max(1, Math.min(width, viewW - x)));
  height = Math.min(MAX_CLIP_EDGE, Math.max(1, Math.min(height, viewH - y)));
  return { x, y, width, height };
}

/**
 * Grow a viewport rect with surrounding context for element thumbnails.
 * Stays in viewport space (capturePage cannot see off-screen document pixels).
 */
export function growViewportRect(rect: ViewRect, viewport: ViewRect): ViewRect {
  const viewW = Math.max(1, Math.floor(viewport.width));
  const viewH = Math.max(1, Math.floor(viewport.height));
  const elementWidth = Math.max(1, rect.width);
  const elementHeight = Math.max(1, rect.height);
  const context = Math.min(
    MAX_ELEMENT_CONTEXT,
    Math.max(
      MIN_ELEMENT_CONTEXT,
      Math.round(Math.max(elementWidth, elementHeight) * ELEMENT_CONTEXT_RATIO),
    ),
  );
  let width = Math.min(MAX_CLIP_EDGE, viewW, Math.max(elementWidth + context * 2, MIN_CAPTURE_EDGE));
  let height = Math.min(
    MAX_CLIP_EDGE,
    viewH,
    Math.max(elementHeight + context * 2, MIN_CAPTURE_EDGE),
  );
  let x = Math.floor(rect.x + elementWidth / 2 - width / 2);
  let y = Math.floor(rect.y + elementHeight / 2 - height / 2);
  x = Math.max(0, Math.min(x, Math.max(0, viewW - width)));
  y = Math.max(0, Math.min(y, Math.max(0, viewH - height)));
  width = Math.max(1, Math.floor(width));
  height = Math.max(1, Math.floor(height));
  return { x, y, width, height };
}

export type ViewCaptureResult = {
  base64: string;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
};

/** Capture a viewport DIP rect without CDP clip (no compositor translate flash). */
export async function captureViewRect(
  webContents: WebContents,
  rect: ViewRect,
): Promise<ViewCaptureResult> {
  if (webContents.isDestroyed()) {
    throw new Error("Cannot capture a destroyed webContents.");
  }
  const clip = {
    x: Math.max(0, Math.round(rect.x)),
    y: Math.max(0, Math.round(rect.y)),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
  // stayHidden: same contract VS Code uses — don't bump capturer visibility.
  const image = await webContents.capturePage(clip, { stayHidden: true });
  const size = image.getSize();
  if (size.width < 1 || size.height < 1) {
    throw new Error("View capture returned an empty image.");
  }
  return {
    base64: image.toPNG().toString("base64"),
    width: clip.width,
    height: clip.height,
    imageWidth: size.width,
    imageHeight: size.height,
  };
}
