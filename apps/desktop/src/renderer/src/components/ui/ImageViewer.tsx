import { IconCopy, IconDownload, IconX } from "@tabler/icons-react";
import { AnimatePresence, m } from "motion/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../../lib/cn";
import { useSuppressNativeSurface } from "./nativeSurface";

/** A rect in viewport (CSS px) coordinates — the thumbnail the viewer grows from. */
type OriginRect = { x: number; y: number; width: number; height: number };
type ViewportSize = { width: number; height: number };

type ViewerState = {
  src: string;
  alt: string;
  origin: OriginRect;
  /** Intrinsic image size, so the centered target keeps the true aspect ratio. */
  natural: { width: number; height: number };
};

type ImageViewerContextValue = {
  /**
   * Open the full-size viewer for one image, growing from the clicked
   * thumbnail's rect. Pass `event.currentTarget.getBoundingClientRect()`.
   */
  open(src: string, alt: string | undefined, originRect: DOMRect | OriginRect): void;
};

const ImageViewerContext = createContext<ImageViewerContextValue | null>(null);
const getViewportSize = (): ViewportSize => ({
  width: window.innerWidth,
  height: window.innerHeight,
});

/**
 * App-level image lightbox. Any thumbnail in the app (composer attachments, the
 * Design Mode element token, sent-message images) calls `useImageViewer().open`
 * to pop the full image to the center of the window over a dark backdrop, with
 * a FLIP transform animation that grows from — and on dismiss returns to — the
 * thumbnail. Click the backdrop or press Esc to close. One viewer instance, so
 * the behavior and polish are identical everywhere (Cursor parity).
 */
export function ImageViewerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ViewerState | null>(null);

  const open = useCallback<ImageViewerContextValue["open"]>((src, alt, originRect) => {
    const origin: OriginRect = {
      x: originRect.x,
      y: originRect.y,
      width: originRect.width,
      height: originRect.height,
    };
    // Preload to learn the intrinsic size before showing, so the grow target is
    // exact (no aspect jump). The thumbnail already decoded the data URL, so
    // this resolves immediately from cache in practice.
    const probe = new Image();
    probe.onload = () => {
      setState({
        src,
        alt: alt ?? "image",
        origin,
        natural: {
          width: probe.naturalWidth || origin.width,
          height: probe.naturalHeight || origin.height,
        },
      });
    };
    probe.onerror = () => {
      setState({ src, alt: alt ?? "image", origin, natural: origin });
    };
    probe.src = src;
  }, []);

  const close = useCallback(() => setState(null), []);

  useEffect(() => {
    if (!state) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [state, close]);

  const value = useMemo<ImageViewerContextValue>(() => ({ open }), [open]);

  return (
    <ImageViewerContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {state ? (
          <ImageViewerOverlay
            key="image-viewer"
            onClose={close}
            state={state}
          />
        ) : null}
      </AnimatePresence>
    </ImageViewerContext.Provider>
  );
}

export function useImageViewer(): ImageViewerContextValue {
  const ctx = useContext(ImageViewerContext);
  if (!ctx) {
    throw new Error("useImageViewer must be used within <ImageViewerProvider>");
  }
  return ctx;
}

/**
 * A previewable image thumbnail. Renders the same `<img>` it always did (styled
 * by `className`) and, on click, pops it into the app-level {@link ImageViewer}
 * lightbox growing from this thumbnail's on-screen rect. The wrapping button
 * uses `display: contents` so it adds no box of its own — the image's layout is
 * byte-for-byte what a bare `<img className=...>` would produce — while keeping
 * the thumbnail keyboard-focusable and click-to-zoom. Use this everywhere a
 * previewable thumbnail appears (composer attachments, the Design Mode element
 * token, sent-message images) so the zoom behavior is identical app-wide.
 */
export function ImageThumb({
  src,
  alt,
  className,
  title,
}: {
  src: string;
  alt: string;
  className?: string;
  title?: string | undefined;
}) {
  const { open } = useImageViewer();
  const imgRef = useRef<HTMLImageElement>(null);
  return (
    <button
      aria-label={`Open image: ${alt}`}
      className="contents"
      onClick={(event) => {
        // Don't let the click reach a parent (e.g. a context token that removes
        // itself on click) — opening the viewer is the thumbnail's own action.
        event.stopPropagation();
        const rect = imgRef.current?.getBoundingClientRect();
        if (rect) {
          open(src, alt, rect);
        }
      }}
      type="button"
    >
      <img
        alt={alt}
        className={cn("cursor-zoom-in", className)}
        draggable={false}
        ref={imgRef}
        src={src}
        {...(title ? { title } : {})}
      />
    </button>
  );
}

/** Easing tuned to feel like a soft, decelerating bezier (easeOutExpo-ish). */
const EASE_BEZIER = [0.16, 1, 0.3, 1] as const;

function ImageViewerOverlay({
  state,
  onClose,
}: {
  state: ViewerState;
  onClose(): void;
}) {
  const { src, alt, origin, natural } = state;
  const [viewport, setViewport] = useState(getViewportSize);

  // The lightbox lives in the renderer DOM, but Electron composites embedded
  // browser views above the DOM — so hide them while the viewer (and its exit
  // animation) is mounted, letting the dark backdrop dim everything uniformly.
  useSuppressNativeSurface();

  useEffect(() => {
    const onResize = () => setViewport(getViewportSize());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Center a real visual stage first, then fit the image inside it. This keeps
  // screenshot gutters from visually blending into the backdrop and looking off-center.
  const stage = useMemo(() => {
    const padding = Math.min(28, Math.max(16, viewport.width * 0.015));
    const maxW = Math.max(1, Math.min(viewport.width * 0.82, 1360) - padding * 2);
    const maxH = Math.max(1, viewport.height * 0.66 - padding * 2);
    const scale = Math.min(maxW / natural.width, maxH / natural.height);
    const imageWidth = Math.max(1, natural.width * scale);
    const imageHeight = Math.max(1, natural.height * scale);
    const width = imageWidth + padding * 2;
    const height = imageHeight + padding * 2;
    return {
      width,
      height,
      padding,
      imageWidth,
      imageHeight,
    };
  }, [viewport, natural]);

  // FLIP: animate a transform from the thumbnail rect to the centered target
  // (transform is GPU-cheap and smooth, unlike animating top/left/width/height).
  const centeredLeft = (viewport.width - stage.width) / 2;
  const centeredTop = (viewport.height - stage.height) / 2;
  const fromTransform = {
    x: origin.x - centeredLeft,
    y: origin.y - centeredTop,
    scaleX: origin.width / stage.width,
    scaleY: origin.height / stage.height,
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <m.div
        animate={{ opacity: 1 }}
        aria-hidden="true"
        className="absolute inset-0 bg-black/70"
        exit={{ opacity: 0 }}
        initial={{ opacity: 0 }}
        onClick={onClose}
        transition={{ duration: 0.28, ease: "easeOut" }}
      />
      <m.div
        animate={{ x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 }}
        className="relative z-10 flex items-center justify-center overflow-hidden rounded-xl border border-hairline bg-elevated shadow-popup"
        exit={{ ...fromTransform, opacity: 0 }}
        initial={{ ...fromTransform, opacity: 0.4 }}
        style={{
          width: stage.width,
          height: stage.height,
          padding: stage.padding,
          transformOrigin: "top left",
        }}
        transition={{ duration: 0.34, ease: EASE_BEZIER }}
      >
        <img
          alt={alt}
          className="select-none rounded-lg object-contain"
          draggable={false}
          src={src}
          style={{
            width: stage.imageWidth,
            height: stage.imageHeight,
          }}
        />
      </m.div>
      <m.div
        animate={{ opacity: 1, y: 0 }}
        className="absolute top-3 right-3 flex items-center gap-1.5 rounded-lg border border-hairline bg-elevated p-1 shadow-popup"
        exit={{ opacity: 0 }}
        initial={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.2, ease: "easeOut", delay: 0.12 }}
      >
        <ViewerAction
          icon={<IconCopy size={14} stroke={1.8} />}
          label="Copy"
          onClick={() => void copyImage(src)}
        />
        <ViewerAction
          icon={<IconDownload size={14} stroke={1.8} />}
          label="Save"
          onClick={() => downloadImage(src, alt)}
        />
        <span className="mx-0.5 h-4 w-px bg-hairline" />
        <ViewerAction icon={<IconX size={14} stroke={2} />} label="Close" onClick={onClose} />
      </m.div>
    </div>
  );
}

function ViewerAction({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-fg-muted transition-colors hover:bg-hover hover:text-fg"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

/** Copy the image to the OS clipboard as a PNG blob (best-effort). */
async function copyImage(src: string): Promise<void> {
  try {
    const blob = await (await fetch(src)).blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
  } catch {
    // Clipboard image write can be blocked; silently ignore (Save still works).
  }
}

/** Trigger a download of the image (data URLs download directly). */
function downloadImage(src: string, alt: string): void {
  const link = document.createElement("a");
  link.href = src;
  link.download = /\.[a-z0-9]+$/i.test(alt) ? alt : `${alt || "image"}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
