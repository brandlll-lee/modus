import type { CdpSession } from "./session";

/**
 * CSS-pixel screenshots via CDP `Page.captureScreenshot`.
 *
 * The old `webContents.capturePage().toPNG()` path emitted *physical* pixels:
 * on the 125%/150% display scaling common on Windows, the image the model saw
 * was 1.25–1.5× larger than the CSS coordinate space that mouse input uses, so
 * coordinates read off the screenshot missed their target by 25–50%. Capturing
 * through CDP with an explicit CSS-pixel clip at scale 1 makes
 * image pixels == CSS pixels == input coordinates, eliminating the DPR
 * mismatch by construction. `captureBeyondViewport` provides real full-page
 * capture (the Puppeteer implementation strategy).
 */

interface LayoutMetrics {
  cssLayoutViewport?: { clientWidth?: number; clientHeight?: number };
  cssContentSize?: { width?: number; height?: number };
  layoutViewport?: { clientWidth?: number; clientHeight?: number };
  contentSize?: { width?: number; height?: number };
}

export interface ScreenshotResult {
  /** Base64 PNG/JPEG data, sized in CSS pixels. */
  base64: string;
  width: number;
  height: number;
  fullPage: boolean;
}

const MAX_FULL_PAGE_HEIGHT = 16384;

export async function captureScreenshot(
  session: CdpSession,
  options: { fullPage?: boolean; format?: "png" | "jpeg" } = {},
): Promise<ScreenshotResult> {
  await session.ensureAttached();
  const fullPage = options.fullPage === true;
  const format = options.format ?? "png";

  const metrics = await session.send<LayoutMetrics>("Page.getLayoutMetrics");
  const viewport = metrics.cssLayoutViewport ?? metrics.layoutViewport;
  const content = metrics.cssContentSize ?? metrics.contentSize;

  const width = Math.max(1, Math.floor((fullPage ? content?.width : viewport?.clientWidth) ?? 0));
  const height = Math.max(
    1,
    Math.min(
      MAX_FULL_PAGE_HEIGHT,
      Math.floor((fullPage ? content?.height : viewport?.clientHeight) ?? 0),
    ),
  );

  const result = await session.send<{ data?: string }>("Page.captureScreenshot", {
    format,
    ...(format === "jpeg" ? { quality: 90 } : {}),
    captureBeyondViewport: fullPage,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });

  if (!result.data) {
    throw new Error("Screenshot capture returned no data.");
  }
  return { base64: result.data, width, height, fullPage };
}

/** Upper bound on an element clip so a giant element can't produce a huge PNG. */
const MAX_CLIP_EDGE = 2400;

/**
 * Extra page context captured around the selected element, as a fraction of its
 * larger edge (clamped). The element shouldn't be cropped flush to its own box
 * (Cursor parity): a margin of surrounding page makes the thumbnail readable
 * and gives the model spatial context.
 */
const ELEMENT_CONTEXT_RATIO = 0.45;
const MIN_ELEMENT_CONTEXT = 24;
const MAX_ELEMENT_CONTEXT = 320;
/**
 * Floor on the captured region's CSS edges. A tiny element (a logo, an icon,
 * a one-line label) captured flush to its own box yields only a handful of
 * pixels and looks badly blurry once shown at thumbnail/lightbox size. Forcing
 * a minimum captured slice of the page guarantees enough pixels to stay sharp.
 */
const MIN_CAPTURE_EDGE = 360;
/**
 * Capture small regions at 2× device pixels for crispness; leave already-large
 * regions at 1× so the PNG payload stays bounded.
 */
const ELEMENT_HIDPI_THRESHOLD = 720;

/**
 * Capture a selected element with surrounding page context, centered in the
 * clip (root-viewport CSS pixels). Used by Design Mode to attach an element
 * thumbnail to the chat context.
 *
 * Rather than cropping flush to the element's box — which leaves tiny elements
 * with too few pixels to read once enlarged — the clip is grown by a context
 * margin and floored to {@link MIN_CAPTURE_EDGE}, then centered on the element
 * and clamped inside the page. Small clips are captured at 2× so they stay
 * crisp; large clips stay at 1× and are bounded by {@link MAX_CLIP_EDGE}.
 */
export async function captureElementClip(
  session: CdpSession,
  rect: { x: number; y: number; width: number; height: number },
  options: { format?: "png" | "jpeg" } = {},
): Promise<ScreenshotResult> {
  await session.ensureAttached();
  const format = options.format ?? "png";

  // Page box (document CSS size) to clamp the grown region against, so we never
  // capture blank margin past the page edges. Unknown sizes fall back to no
  // clamp (Infinity), preserving capture for pages that don't report metrics.
  const metrics = await session.send<LayoutMetrics>("Page.getLayoutMetrics");
  const content = metrics.cssContentSize ?? metrics.contentSize;
  const pageWidth = Math.floor(content?.width ?? 0) || Number.POSITIVE_INFINITY;
  const pageHeight = Math.floor(content?.height ?? 0) || Number.POSITIVE_INFINITY;

  const elementWidth = Math.max(1, rect.width);
  const elementHeight = Math.max(1, rect.height);

  const context = Math.min(
    MAX_ELEMENT_CONTEXT,
    Math.max(
      MIN_ELEMENT_CONTEXT,
      Math.round(Math.max(elementWidth, elementHeight) * ELEMENT_CONTEXT_RATIO),
    ),
  );

  // Desired region: element + context on every side, floored so small elements
  // still capture a meaningful slice of page, capped so it can't blow up.
  let width = Math.min(
    MAX_CLIP_EDGE,
    pageWidth,
    Math.max(elementWidth + context * 2, MIN_CAPTURE_EDGE),
  );
  let height = Math.min(
    MAX_CLIP_EDGE,
    pageHeight,
    Math.max(elementHeight + context * 2, MIN_CAPTURE_EDGE),
  );

  // Center on the element, then slide the region fully inside the page box
  // (preferred over shrinking it, so the element keeps its surrounding context).
  const centerX = rect.x + elementWidth / 2;
  const centerY = rect.y + elementHeight / 2;
  let x = centerX - width / 2;
  let y = centerY - height / 2;
  const maxX = pageWidth === Number.POSITIVE_INFINITY ? x : Math.max(0, pageWidth - width);
  const maxY = pageHeight === Number.POSITIVE_INFINITY ? y : Math.max(0, pageHeight - height);
  x = Math.max(0, Math.min(x, maxX));
  y = Math.max(0, Math.min(y, maxY));

  x = Math.floor(x);
  y = Math.floor(y);
  width = Math.max(1, Math.floor(width));
  height = Math.max(1, Math.floor(height));

  // Upscale only small clips, so a logo isn't blurry but a full hero section
  // doesn't produce a multi-megabyte PNG.
  const scale = Math.max(width, height) <= ELEMENT_HIDPI_THRESHOLD ? 2 : 1;

  const result = await session.send<{ data?: string }>("Page.captureScreenshot", {
    format,
    ...(format === "jpeg" ? { quality: 90 } : {}),
    captureBeyondViewport: true,
    clip: { x, y, width, height, scale },
  });
  if (!result.data) {
    throw new Error("Element screenshot capture returned no data.");
  }
  return { base64: result.data, width, height, fullPage: false };
}
