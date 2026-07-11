import type { CdpSession } from "./session";

/**
 * Full-page / viewport screenshots via CDP `Page.captureScreenshot`.
 *
 * Design Mode region captures intentionally do NOT live here — CDP clip
 * flashes the compositor in a visible WebContentsView (see view-capture.ts).
 * Agent/tool full-page shots still use this path.
 */

interface LayoutMetrics {
  cssLayoutViewport?: { clientWidth?: number; clientHeight?: number };
  cssContentSize?: { width?: number; height?: number };
  layoutViewport?: { clientWidth?: number; clientHeight?: number };
  contentSize?: { width?: number; height?: number };
}

export interface ScreenshotResult {
  /** Base64 PNG/JPEG data. `width`/`height` are CSS pixels for CDP input. */
  base64: string;
  width: number;
  height: number;
  imageWidth?: number;
  imageHeight?: number;
  deviceScaleFactor?: number;
  fullPage: boolean;
}

const MAX_FULL_PAGE_HEIGHT = 16384;

function pngSize(base64: string): { width: number; height: number } | undefined {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG") {
    return undefined;
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function deviceScaleFactor(session: CdpSession): Promise<number | undefined> {
  try {
    const result = await session.send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
      expression: "window.devicePixelRatio",
      returnByValue: true,
    });
    return typeof result.result?.value === "number" ? result.result.value : undefined;
  } catch {
    return undefined;
  }
}

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
  const imageSize = pngSize(result.data);
  const scaleFactor = await deviceScaleFactor(session);
  return {
    base64: result.data,
    width,
    height,
    ...(imageSize ? { imageWidth: imageSize.width, imageHeight: imageSize.height } : {}),
    ...(scaleFactor !== undefined ? { deviceScaleFactor: scaleFactor } : {}),
    fullPage,
  };
}
