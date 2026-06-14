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
  // Recompute the centered target on viewport resize while open.
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

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
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onResize);
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
            viewport={viewport}
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
  viewport,
  onClose,
}: {
  state: ViewerState;
  viewport: { width: number; height: number };
  onClose(): void;
}) {
  const { src, alt, origin, natural } = state;

  // The lightbox lives in the renderer DOM, but Electron composites embedded
  // browser views above the DOM — so hide them while the viewer (and its exit
  // animation) is mounted, letting the dark backdrop dim everything uniformly.
  useSuppressNativeSurface();

  // Centered target rect: fit the intrinsic image within most of the viewport,
  // upscaling small element clips so they read clearly (Cursor does the same).
  const target = useMemo(() => {
    const maxW = viewport.width * 0.9;
    const maxH = viewport.height * 0.86;
    const scale = Math.min(maxW / natural.width, maxH / natural.height);
    const width = Math.max(1, natural.width * scale);
    const height = Math.max(1, natural.height * scale);
    return {
      left: (viewport.width - width) / 2,
      top: (viewport.height - height) / 2,
      width,
      height,
    };
  }, [viewport, natural]);

  // FLIP: animate a transform from the thumbnail rect to the centered target
  // (transform is GPU-cheap and smooth, unlike animating top/left/width/height).
  const fromTransform = {
    x: origin.x - target.left,
    y: origin.y - target.top,
    scaleX: origin.width / target.width,
    scaleY: origin.height / target.height,
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
      <m.img
        alt={alt}
        animate={{ x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 }}
        className="absolute select-none rounded-xl object-contain shadow-popup"
        draggable={false}
        exit={{ ...fromTransform, opacity: 0 }}
        initial={{ ...fromTransform, opacity: 0.4 }}
        src={src}
        style={{
          left: target.left,
          top: target.top,
          width: target.width,
          height: target.height,
          transformOrigin: "top left",
        }}
        transition={{ duration: 0.34, ease: EASE_BEZIER }}
      />
      <m.div
        animate={{ opacity: 1, y: 0 }}
        className="absolute flex items-center gap-1.5 rounded-lg border border-hairline bg-elevated/95 p-1 shadow-popup backdrop-blur"
        exit={{ opacity: 0 }}
        initial={{ opacity: 0, y: -4 }}
        style={{
          top: Math.max(12, target.top + 12),
          right: Math.max(12, viewport.width - (target.left + target.width) + 12),
        }}
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
