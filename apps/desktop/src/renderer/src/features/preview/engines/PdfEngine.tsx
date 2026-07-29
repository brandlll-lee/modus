import { memo, useEffect, useRef, useState } from "react";
import { attachDomExcerptChrome, pageLocatorFromAnchor } from "../domExcerptChrome";
import type { PreviewEngineProps } from "../registry";
import { shouldSkipPdfRefit } from "./pdfFit";

const PAGE_PAD_X = 24;
const MIN_FIT_SCALE = 0.85;
const MAX_FIT_SCALE = 2.75;

/** Wait until the scroller has a real layout width (side panel may mount at 0). */
function waitForLayoutWidth(el: HTMLElement, signal: { cancelled: boolean }): Promise<number> {
  if (el.clientWidth > 0) {
    return Promise.resolve(el.clientWidth);
  }
  return new Promise((resolve) => {
    const ro = new ResizeObserver(() => {
      if (signal.cancelled) {
        ro.disconnect();
        resolve(0);
        return;
      }
      if (el.clientWidth > 0) {
        ro.disconnect();
        resolve(el.clientWidth);
      }
    });
    ro.observe(el);
  });
}

/**
 * PDF preview via pdf.js — HiDPI canvas + TextLayer + imperative page chrome.
 *
 * Pages and the page indicator are owned outside React state on purpose: any
 * `setState` (or parent re-render) would reconcile the empty scroller div and
 * wipe imperative children, which with ResizeObserver became a flicker loop.
 */
function PdfEngine({ bytes, path, onAddToChat }: PreviewEngineProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const onAddRef = useRef(onAddToChat);
  const pathRef = useRef(path);
  const [error, setError] = useState<string | undefined>();

  onAddRef.current = onAddToChat;
  pathRef.current = path;

  useEffect(() => {
    const host = scrollerRef.current;
    const indicator = indicatorRef.current;
    if (!host || !indicator) return;
    const signal = { cancelled: false };
    let intersection: IntersectionObserver | undefined;
    let lastFitWidth = 0;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let renderGen = 0;
    let painting = false;

    const setIndicator = (text: string | undefined): void => {
      if (!text) {
        indicator.style.display = "none";
        indicator.textContent = "";
        return;
      }
      indicator.textContent = text;
      indicator.style.display = "";
    };

    const detachChrome = attachDomExcerptChrome(host, {
      getPath: () => pathRef.current,
      getOnAdd: () => onAddRef.current,
      locatorFromAnchor: pageLocatorFromAnchor,
    });

    const watchVisiblePage = (pageCount: number): void => {
      intersection?.disconnect();
      const ratios = new Map<number, number>();
      intersection = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const page = Number((entry.target as HTMLElement).dataset.page);
            if (!Number.isFinite(page)) continue;
            ratios.set(page, entry.isIntersecting ? entry.intersectionRatio : 0);
          }
          let bestPage = 1;
          let bestRatio = -1;
          for (const [page, ratio] of ratios) {
            if (ratio > bestRatio) {
              bestRatio = ratio;
              bestPage = page;
            }
          }
          setIndicator(`Page ${bestPage} / ${pageCount}`);
        },
        { root: host, threshold: [0, 0.15, 0.35, 0.55, 0.75, 1] },
      );
      for (const pageEl of host.querySelectorAll<HTMLElement>(".pdf-page[data-page]")) {
        intersection.observe(pageEl);
      }
    };

    const renderDocument = async (): Promise<void> => {
      if (painting) return;
      try {
        const layoutWidth = await waitForLayoutWidth(host, signal);
        if (signal.cancelled) return;
        const fitWidth = Math.max(layoutWidth - PAGE_PAD_X, 200);
        // Skip before bumping renderGen (aborted mid-paint + early return = stub).
        // Only skip when pages are still in the DOM. React re-renders of this
        // component wipe imperative children; skipping then leaves a blank pane.
        if (
          shouldSkipPdfRefit(lastFitWidth, fitWidth) &&
          host.querySelector(".pdf-page")
        ) {
          return;
        }

        const gen = ++renderGen;
        painting = true;
        const pdfjs = await import("pdfjs-dist");
        const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        const doc = await pdfjs.getDocument({ data: copy }).promise;
        if (signal.cancelled || gen !== renderGen) {
          await doc.cleanup();
          return;
        }

        const pageCount = Math.min(doc.numPages, 100);
        const first = await doc.getPage(1);
        const baseViewport = first.getViewport({ scale: 1 });
        const fitScale = fitWidth / baseViewport.width;
        const scale = Math.min(MAX_FIT_SCALE, Math.max(MIN_FIT_SCALE, fitScale));
        const outputScale = window.devicePixelRatio || 1;

        host.replaceChildren();
        intersection?.disconnect();

        for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
          const page = pageNum === 1 ? first : await doc.getPage(pageNum);
          if (signal.cancelled || gen !== renderGen) break;
          const viewport = page.getViewport({ scale });
          const cssWidth = Math.floor(viewport.width);
          const cssHeight = Math.floor(viewport.height);

          const pageEl = document.createElement("div");
          pageEl.className = "pdf-page mx-auto mb-3 shadow-sm";
          pageEl.dataset.page = String(pageNum);
          pageEl.style.width = `${cssWidth}px`;
          pageEl.style.height = `${cssHeight}px`;

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(cssWidth * outputScale);
          canvas.height = Math.floor(cssHeight * outputScale);
          canvas.style.width = `${cssWidth}px`;
          canvas.style.height = `${cssHeight}px`;
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          const transform =
            outputScale !== 1 ? ([outputScale, 0, 0, outputScale, 0, 0] as const) : undefined;
          await page.render({
            canvasContext: ctx,
            viewport,
            canvas,
            ...(transform ? { transform: [...transform] } : {}),
          }).promise;
          if (signal.cancelled || gen !== renderGen) break;
          pageEl.appendChild(canvas);

          const textLayerDiv = document.createElement("div");
          textLayerDiv.className = "textLayer";
          textLayerDiv.style.setProperty("--total-scale-factor", String(viewport.scale));
          pageEl.appendChild(textLayerDiv);

          const textLayer = new pdfjs.TextLayer({
            textContentSource: page.streamTextContent({ includeMarkedContent: true }),
            container: textLayerDiv,
            viewport,
          });
          await textLayer.render();

          host.appendChild(pageEl);
        }

        await doc.cleanup();
        if (signal.cancelled || gen !== renderGen) return;
        lastFitWidth = fitWidth;
        setIndicator(`Page 1 / ${pageCount}`);
        watchVisiblePage(pageCount);
      } catch (err: unknown) {
        if (!signal.cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        painting = false;
      }
    };

    void renderDocument();

    const resizeObserver = new ResizeObserver(() => {
      if (painting) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!signal.cancelled && !painting) {
          void renderDocument();
        }
      }, 180);
    });
    resizeObserver.observe(host);

    return () => {
      signal.cancelled = true;
      clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      intersection?.disconnect();
      detachChrome();
      host.replaceChildren();
      setIndicator(undefined);
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
    <div className="relative h-full min-h-0">
      <div
        className="scroll-thin pdf-scroller h-full overflow-auto bg-canvas p-3"
        ref={scrollerRef}
      />
      <div
        aria-live="polite"
        className="pdf-page-indicator"
        ref={indicatorRef}
        style={{ display: "none" }}
      />
    </div>
  );
}

export default memo(PdfEngine);
