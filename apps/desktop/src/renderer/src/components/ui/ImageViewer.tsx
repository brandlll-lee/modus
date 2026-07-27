import { IconCopy, IconDownload, IconPencil, IconRotate2, IconX } from "@tabler/icons-react";
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

type Size = { width: number; height: number };
type DrawPoint = { x: number; y: number };
type DrawStroke = DrawPoint[];

type ViewerState = {
  src: string;
  alt: string;
  onSaveEdited?(dataUrl: string): void;
  /** Intrinsic image size, so the centered target keeps the true aspect ratio. */
  natural: Size;
};

type ImageViewerContextValue = {
  open(
    src: string,
    alt: string | undefined,
    natural: Size,
    onSaveEdited?: (dataUrl: string) => void,
  ): void;
};

const ImageViewerContext = createContext<ImageViewerContextValue | null>(null);
const getViewportSize = (): Size => ({
  width: window.innerWidth,
  height: window.innerHeight,
});

/**
 * App-level image lightbox. Any thumbnail in the app (composer attachments, the
 * Design Mode element token, sent-message images) calls `useImageViewer().open`
 * to pop the full image to the center of the window over a dark backdrop, with
 * a centered lightbox. Click the backdrop or press Esc to close. One viewer
 * instance keeps the behavior identical everywhere.
 */
export function ImageViewerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ViewerState | null>(null);

  const open = useCallback<ImageViewerContextValue["open"]>(
    (src, alt, natural, onSaveEdited) => {
      setState({
        src,
        alt: alt ?? "image",
        ...(onSaveEdited ? { onSaveEdited } : {}),
        natural,
      });
    },
    [],
  );

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
        {state ? <ImageViewerOverlay key="image-viewer" onClose={close} state={state} /> : null}
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
 * lightbox. The wrapping button uses `display: contents` so it adds no box of
 * its own while keeping the thumbnail keyboard-focusable and click-to-zoom.
 */
export function ImageThumb({
  src,
  alt,
  className,
  onSaveEdited,
  title,
}: {
  src: string;
  alt: string;
  className?: string;
  onSaveEdited?: (dataUrl: string) => void;
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
        const image = imgRef.current;
        if (image) {
          open(
            src,
            alt,
            {
              width: Math.max(1, image.naturalWidth, image.clientWidth),
              height: Math.max(1, image.naturalHeight, image.clientHeight),
            },
            onSaveEdited,
          );
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

function ImageViewerOverlay({ state, onClose }: { state: ViewerState; onClose(): void }) {
  const { src, alt, natural, onSaveEdited } = state;
  const [viewport, setViewport] = useState(getViewportSize);
  const [drawing, setDrawing] = useState(false);
  const [strokes, setStrokes] = useState<DrawStroke[]>([]);
  const [activeStroke, setActiveStroke] = useState<DrawStroke | null>(null);
  const activeStrokeRef = useRef<DrawStroke | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
    const maxW = Math.max(1, Math.min(viewport.width * 0.72, 1180) - padding * 2);
    const maxH = Math.max(1, viewport.height * 0.62 - padding * 2);
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

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#ff2d2d";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 5;
    for (const stroke of activeStroke ? [...strokes, activeStroke] : strokes) {
      if (stroke.length < 2) continue;
      const first = stroke[0];
      if (!first) continue;
      ctx.beginPath();
      ctx.moveTo(first.x * canvas.width, first.y * canvas.height);
      for (const point of stroke.slice(1)) {
        ctx.lineTo(point.x * canvas.width, point.y * canvas.height);
      }
      ctx.stroke();
    }
  }, [activeStroke, strokes]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): DrawPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const finishStroke = (canvas: HTMLCanvasElement, pointerId: number, commit: boolean): void => {
    const stroke = activeStrokeRef.current;
    activeStrokeRef.current = null;
    setActiveStroke(null);
    if (commit && stroke && stroke.length > 1) {
      setStrokes((current) => [...current, stroke]);
    }
    if (canvas.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
  };

  const cancelDrawing = (): void => {
    setDrawing(false);
    setStrokes([]);
    activeStrokeRef.current = null;
    setActiveStroke(null);
  };

  const saveDrawing = async (): Promise<void> => {
    const overlay = canvasRef.current;
    if (!overlay || !onSaveEdited || strokes.length === 0) return;
    const image = await loadImage(src);
    const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(image, 0, 0, width, height);
    ctx.drawImage(overlay, 0, 0, width, height);
    onSaveEdited(canvas.toDataURL("image/png"));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <m.div
        animate={{ opacity: 1 }}
        aria-hidden="true"
        className="absolute inset-0 bg-black/70"
        exit={{ opacity: 0 }}
        initial={{ opacity: 0 }}
        onClick={drawing ? undefined : onClose}
        transition={{ duration: 0.18, ease: "easeOut" }}
      />
      <m.div
        animate={{ opacity: 1, scale: 1 }}
        className="relative z-10 flex items-center justify-center overflow-hidden popup-chrome"
        exit={{ opacity: 0, scale: 0.98 }}
        initial={{ opacity: 0, scale: 0.98 }}
        style={{
          width: stage.width,
          height: stage.height,
          padding: stage.padding,
        }}
        transition={{ duration: 0.18, ease: EASE_BEZIER }}
      >
        <div className="relative" style={{ width: stage.imageWidth, height: stage.imageHeight }}>
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
          {drawing ? (
            <canvas
              className="absolute inset-0 cursor-crosshair touch-none rounded-lg"
              height={Math.max(1, Math.round(stage.imageHeight))}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                const stroke = [pointFromEvent(event)];
                activeStrokeRef.current = stroke;
                setActiveStroke(stroke);
              }}
              onPointerMove={(event) => {
                const current = activeStrokeRef.current;
                if (!current) return;
                const next = [...current, pointFromEvent(event)];
                activeStrokeRef.current = next;
                setActiveStroke(next);
              }}
              onPointerCancel={(event) => {
                finishStroke(event.currentTarget, event.pointerId, false);
              }}
              onPointerUp={(event) => {
                finishStroke(event.currentTarget, event.pointerId, true);
              }}
              ref={canvasRef}
              width={Math.max(1, Math.round(stage.imageWidth))}
            />
          ) : null}
        </div>
        <m.div
          animate={{ opacity: 1, y: 0 }}
          className="app-no-drag absolute top-3 right-3 flex items-center gap-1.5 popup-chrome bg-elevated/95 p-1"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.16, ease: "easeOut", delay: 0.04 }}
        >
          {drawing ? (
            <>
              <ViewerAction
                disabled={strokes.length === 0}
                icon={<IconRotate2 size={14} stroke={1.8} />}
                label="Undo"
                onClick={() => setStrokes((current) => current.slice(0, -1))}
              />
              <ViewerAction label="Cancel" onClick={cancelDrawing} />
              <ViewerAction
                disabled={strokes.length === 0}
                label="Save"
                onClick={() => void saveDrawing()}
              />
            </>
          ) : (
            <>
              {onSaveEdited ? (
                <ViewerAction
                  icon={<IconPencil size={14} stroke={1.8} />}
                  label="Draw"
                  onClick={() => setDrawing(true)}
                />
              ) : null}
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
            </>
          )}
        </m.div>
      </m.div>
    </div>
  );
}

function ViewerAction({
  disabled = false,
  icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      className="app-no-drag flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-muted"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) return;
        onClick();
      }}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image."));
    image.src = src;
  });
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
