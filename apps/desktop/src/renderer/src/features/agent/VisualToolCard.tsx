import { Menu } from "@base-ui/react/menu";
import {
  IconArrowsMaximize,
  IconCopy,
  IconDots,
  IconDownload,
  IconHandMove,
  IconMinus,
  IconPlus,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSuppressNativeSurface } from "../../components/ui/nativeSurface";
import { cn } from "../../lib/cn";
import { useTheme } from "../../lib/theme";

type VisualKind = "html" | "svg";

type VisualArgs = {
  title: string;
  kind: VisualKind;
  content: string;
};

type VisualToolCardProps = {
  args?: unknown;
  isComplete?: boolean;
  isError?: boolean;
};

type VisualMessage = { type: "visual:height"; height: number };

const COLLAPSED_HEIGHT = 1;
const LOADING_HEIGHT = 360;
const RECEIVER_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'">
<style>
:root {
  color-scheme: dark;
  --color-canvas: #131314;
  --color-surface: transparent;
  --color-elevated: rgba(128,128,128,.08);
  --color-fg: #e4e4e3;
  --color-fg-muted: #b4b4b1;
  --color-fg-subtle: #8a8a87;
  --color-fg-faint: #5a5a5d;
  --color-hairline: rgba(255,255,255,.08);
  --color-link: #6299c3;
  --color-link-hover: #7eb0d2;
  --color-hover: rgba(255,255,255,.04);
  --color-active: rgba(255,255,255,.06);
  --color-chip-faint: rgba(255,255,255,.03);
  --color-chip: rgba(255,255,255,.05);
  --color-chip-strong: rgba(255,255,255,.08);
  --color-success: #3fae87;
  --color-danger: #e5687a;
  --color-build: #3b82f6;
  --color-build-fg: #ffffff;
  --color-accent: #f54e00;
  --color-on-accent: #ffffff;
}
html, body {
  margin: 0 !important;
  padding: 0 !important;
  width: 100% !important;
  min-height: 100% !important;
  max-width: none !important;
  overflow: hidden !important;
  background: var(--color-canvas) !important;
  color: var(--color-fg);
  font: 14px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* {
  box-sizing: border-box;
}
/* scrollbar-width|color must stay unset — they disable ::-webkit-scrollbar* (Chrome 121+). */
*::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
*::-webkit-scrollbar-button {
  display: none;
  width: 0;
  height: 0;
}
*::-webkit-scrollbar-thumb {
  background-color: transparent;
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: content-box;
}
*:hover::-webkit-scrollbar-thumb {
  background-color: color-mix(in oklab, var(--color-fg) 8%, transparent);
}
*:hover::-webkit-scrollbar-thumb:hover {
  background-color: color-mix(in oklab, var(--color-fg) 14%, transparent);
}
*::-webkit-scrollbar-track,
*::-webkit-scrollbar-corner {
  background: transparent;
}
#modus-visual-viewport {
  width: 100%;
  max-width: 100%;
  min-height: 1px;
  overflow-x: auto;
  overflow-y: hidden;
  transform: translateY(6px);
  opacity: .001;
  transition: opacity 160ms ease-out, transform 160ms ease-out;
}
#modus-visual-content {
  display: flow-root;
  width: 100%;
  min-width: 100%;
}
#modus-visual-viewport[data-visible="true"] {
  transform: translateY(0);
  opacity: 1;
}
#modus-visual-viewport[data-mode="fullscreen"] {
  height: 100vh;
  max-height: 100vh;
  overflow: auto;
}
#modus-visual-viewport[data-mode="fullscreen"] #modus-visual-content {
  width: 100%;
  min-width: 100%;
  min-height: 100%;
}
#modus-visual-viewport[data-pan="true"] {
  cursor: grab;
}
#modus-visual-viewport[data-panning="true"] {
  cursor: grabbing;
}
@media (prefers-reduced-motion: reduce) {
  #modus-visual-viewport { transition: none; transform: none; opacity: 1; }
}
</style>
</head>
<body>
<div id="modus-visual-viewport"><div id="modus-visual-content"></div></div>
<script>
const viewport = document.getElementById("modus-visual-viewport");
const content = document.getElementById("modus-visual-content");
let layoutFrame = 0;
let lastRendered = "";
let requestedScale = 1;
let appliedScale = 1;
let panMode = false;
let drag = null;
function createMemoryStorage() {
  const items = new Map();
  return {
    get length() {
      return items.size;
    },
    clear() {
      items.clear();
    },
    getItem(key) {
      return items.has(String(key)) ? items.get(String(key)) : null;
    },
    key(index) {
      return [...items.keys()][index] ?? null;
    },
    removeItem(key) {
      items.delete(String(key));
    },
    setItem(key, value) {
      items.set(String(key), String(value));
    },
  };
}
function installStorageFallback(name) {
  try {
    window[name].getItem("__modus_storage_probe__");
  } catch {
    Object.defineProperty(window, name, {
      configurable: true,
      value: createMemoryStorage(),
    });
  }
}
installStorageFallback("localStorage");
installStorageFallback("sessionStorage");
function clampScale(value) {
  return Math.max(0.5, Math.min(2.5, value));
}
function requestLayout() {
  if (layoutFrame) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = 0;
    const nextScale = clampScale(Number(requestedScale) || 1);
    if (Math.abs(nextScale - appliedScale) > 0.005) {
      appliedScale = nextScale;
      content.style.zoom = String(appliedScale);
    }
    requestAnimationFrame(sendHeight);
  });
}
function sendHeight() {
  const box = content.getBoundingClientRect();
  const scrollbarHeight = viewport.scrollWidth > viewport.clientWidth ? Math.max(0, viewport.offsetHeight - viewport.clientHeight) : 0;
  parent.postMessage({ type: "visual:height", height: Math.ceil(Math.max(box.height, content.scrollHeight, viewport.scrollHeight, document.body.scrollHeight, document.documentElement.scrollHeight, 1) + scrollbarHeight) }, "*");
}
function applyTheme(theme) {
  if (!theme || typeof theme !== "object") return;
  for (const [key, value] of Object.entries(theme)) {
    if (typeof value === "string") document.documentElement.style.setProperty(key, value);
  }
  document.documentElement.style.colorScheme = theme["--modus-color-scheme"] === "light" ? "light" : "dark";
}
function applyViewport(state) {
  const nextScale = Number(state && state.scale) || 1;
  const nextMode = state && state.mode === "fullscreen" ? "fullscreen" : "preview";
  requestedScale = nextScale;
  panMode = Boolean(state && state.pan);
  viewport.dataset.pan = String(panMode);
  viewport.dataset.mode = nextMode;
  requestLayout();
}
function setContent(html) {
  const finalHtml = String(html || "");
  if (finalHtml === lastRendered) return;
  lastRendered = finalHtml;
  content.innerHTML = finalHtml;
  viewport.dataset.visible = String(finalHtml.length > 0);
  for (const script of [...content.querySelectorAll("script")]) {
    const next = document.createElement("script");
    for (const attr of script.attributes) next.setAttribute(attr.name, attr.value);
    next.text = script.textContent || "";
    script.replaceWith(next);
  }
  requestLayout();
}
function observeLayout() {
  requestLayout();
}
new ResizeObserver(observeLayout).observe(content);
new ResizeObserver(observeLayout).observe(viewport);
addEventListener("resize", () => {
  requestLayout();
});
viewport.addEventListener("pointerdown", (event) => {
  if (!panMode || event.button !== 0) return;
  drag = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
  viewport.dataset.panning = "true";
  viewport.setPointerCapture(event.pointerId);
  event.preventDefault();
});
viewport.addEventListener("pointermove", (event) => {
  if (!drag) return;
  viewport.scrollLeft = drag.left - (event.clientX - drag.x);
  viewport.scrollTop = drag.top - (event.clientY - drag.y);
});
function finishDrag(event) {
  if (!drag) return;
  drag = null;
  delete viewport.dataset.panning;
  if (viewport.hasPointerCapture(event.pointerId)) {
    viewport.releasePointerCapture(event.pointerId);
  }
}
viewport.addEventListener("pointerup", finishDrag);
viewport.addEventListener("pointercancel", finishDrag);
addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "visual:theme") applyTheme(data.theme);
  if (data.type === "visual:viewport") applyViewport(data);
  if (data.type === "visual:render") setContent(data.content);
});
</script>
</body>
</html>`;

export function VisualToolCard({ args, isComplete = false, isError = false }: VisualToolCardProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const visual = parseVisualArgs(args);
  const [height, setHeight] = useState(COLLAPSED_HEIGHT);
  const [painted, setPainted] = useState(false);
  const [ready, setReady] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const running = !isComplete && !isError;
  const title = visual?.title || "Visual";
  const content = visual?.content ?? "";
  const hasContent = content.trim().length > 0;
  const shouldRenderFrame = isComplete && hasContent;
  const showLoader = running || (isComplete && hasContent && !painted);

  useTheme();
  const theme = readTheme();

  useEffect(() => {
    if (hasContent) return;
    setHeight(COLLAPSED_HEIGHT);
    setPainted(false);
    setReady(false);
  }, [hasContent]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<VisualMessage>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data.type === "visual:height") {
        const nextHeight = Math.max(COLLAPSED_HEIGHT, event.data.height);
        setHeight(nextHeight);
        if (hasContent && nextHeight > COLLAPSED_HEIGHT) setPainted(true);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [hasContent]);

  const download = (): void => {
    if (!visual || !content) return;
    const extension = visual.kind === "svg" ? "svg" : "html";
    const type = visual.kind === "svg" ? "image/svg+xml" : "text/html";
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeFilename(title)}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copy = (): void => {
    if (!content) return;
    void navigator.clipboard?.writeText(content).catch(() => {});
  };

  if (!hasContent && !running) return null;

  return (
    <div className="group relative min-w-0 overflow-hidden rounded-lg text-sm">
      {showLoader ? <VisualLoading height={LOADING_HEIGHT} /> : null}
      <VisualMenu
        copy={copy}
        disabled={!painted}
        download={download}
        onFullscreen={() => setFullscreen(true)}
      />
      {shouldRenderFrame ? (
        <VisualFrame
          className={cn(
            "w-full origin-center bg-transparent transition-[height,opacity,transform] duration-200 ease-out",
            painted
              ? "block scale-100 opacity-100"
              : "pointer-events-none absolute inset-x-0 top-0 scale-[0.985] opacity-0",
          )}
          content={content}
          iframeRef={iframeRef}
          ready={ready}
          setReady={setReady}
          style={{
            height: painted ? height : LOADING_HEIGHT,
            pointerEvents: painted ? undefined : "none",
          }}
          theme={theme}
          title={title}
        />
      ) : null}
      {fullscreen && visual ? (
        <VisualFullscreen
          content={content}
          copy={copy}
          download={download}
          onClose={() => setFullscreen(false)}
          theme={theme}
          title={title}
        />
      ) : null}
    </div>
  );
}

function VisualLoading({ height }: { height: number }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-hairline-soft bg-card",
        "visual-glare-loading",
      )}
      style={{ height }}
    />
  );
}

function VisualMenu({
  copy,
  disabled,
  download,
  onFullscreen,
}: {
  copy(): void;
  disabled: boolean;
  download(): void;
  onFullscreen(): void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        className={cn(
          "absolute top-2 right-2 z-10 flex size-8 items-center justify-center rounded-full",
          "bg-elevated/90 text-fg-muted opacity-0 shadow-popup backdrop-blur transition-opacity",
          "hover:bg-hover hover:text-fg group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100",
        )}
        disabled={disabled}
      >
        <IconDots size={16} stroke={1.8} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" side="bottom" sideOffset={6}>
          <Menu.Popup className="origin-(--transform-origin) min-w-[190px] popup-chrome p-1">
            <Menu.Item
              className="flex h-9 cursor-default items-center gap-2 rounded-md px-2.5 text-fg-subtle text-sm outline-none select-none data-highlighted:bg-hover data-highlighted:text-fg"
              onClick={copy}
            >
              <IconCopy className="text-fg-faint" size={15} stroke={1.8} />
              Copy to clipboard
            </Menu.Item>
            <Menu.Item
              className="flex h-9 cursor-default items-center gap-2 rounded-md px-2.5 text-fg-subtle text-sm outline-none select-none data-highlighted:bg-hover data-highlighted:text-fg"
              onClick={download}
            >
              <IconDownload className="text-fg-faint" size={15} stroke={1.8} />
              Download file
            </Menu.Item>
            <Menu.Item
              className="flex h-9 cursor-default items-center gap-2 rounded-md px-2.5 text-fg-subtle text-sm outline-none select-none data-highlighted:bg-hover data-highlighted:text-fg"
              onClick={onFullscreen}
            >
              <IconArrowsMaximize className="text-fg-faint" size={15} stroke={1.8} />
              Open fullscreen
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function VisualFrame({
  className,
  content,
  iframeRef,
  panMode,
  ready,
  scale,
  setReady,
  style,
  theme,
  title,
  viewportMode = "preview",
}: {
  className?: string;
  content: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  panMode?: boolean;
  ready: boolean;
  scale?: number;
  setReady(ready: boolean): void;
  style?: React.CSSProperties;
  theme: Record<string, string>;
  title: string;
  viewportMode?: "preview" | "fullscreen";
}) {
  useEffect(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target || !ready) return;
    target.postMessage({ type: "visual:theme", theme }, "*");
    target.postMessage({ type: "visual:render", content }, "*");
  }, [content, iframeRef, ready, theme]);

  useEffect(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target || !ready) return;
    target.postMessage(
      {
        type: "visual:viewport",
        mode: viewportMode,
        pan: Boolean(panMode),
        scale: scale ?? 1,
      },
      "*",
    );
  }, [iframeRef, panMode, ready, scale, viewportMode]);

  return (
    <iframe
      className={className}
      ref={iframeRef}
      referrerPolicy="no-referrer"
      sandbox="allow-scripts"
      srcDoc={RECEIVER_HTML}
      style={style}
      title={title}
      onLoad={() => setReady(true)}
    />
  );
}

function VisualFullscreen({
  content,
  copy,
  download,
  onClose,
  theme,
  title,
}: {
  content: string;
  copy(): void;
  download(): void;
  onClose(): void;
  theme: Record<string, string>;
  title: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(1);
  const [handMode, setHandMode] = useState(false);
  useSuppressNativeSurface();

  const zoomBy = (delta: number): void => {
    setScale((current) => Math.max(0.5, Math.min(2.5, current + delta)));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-canvas/95 backdrop-blur">
      <div className="flex h-12 shrink-0 items-center justify-between border-hairline border-b px-3">
        <div className="min-w-0 truncate text-fg-muted text-sm">{title}</div>
        <div className="flex items-center gap-1 popup-chrome p-1">
          <VisualAction
            icon={<IconMinus size={14} stroke={1.8} />}
            label="Zoom out"
            onClick={() => zoomBy(-0.1)}
          />
          <VisualAction
            icon={<IconRefresh size={14} stroke={1.8} />}
            label="Reset"
            onClick={() => setScale(1)}
          />
          <VisualAction
            icon={<IconPlus size={14} stroke={1.8} />}
            label="Zoom in"
            onClick={() => zoomBy(0.1)}
          />
          <VisualAction
            active={handMode}
            icon={<IconHandMove size={14} stroke={1.8} />}
            label="Pan"
            onClick={() => setHandMode((value) => !value)}
          />
          <span className="mx-0.5 h-4 w-px bg-hairline" />
          <VisualAction icon={<IconCopy size={14} stroke={1.8} />} label="Copy" onClick={copy} />
          <VisualAction
            icon={<IconDownload size={14} stroke={1.8} />}
            label="Save"
            onClick={download}
          />
          <span className="mx-0.5 h-4 w-px bg-hairline" />
          <VisualAction icon={<IconX size={14} stroke={2} />} label="Close" onClick={onClose} />
        </div>
      </div>
      <div className="min-h-0 flex-1 p-4">
        <VisualFrame
          className="block h-full w-full rounded-lg bg-transparent"
          content={content}
          iframeRef={iframeRef}
          panMode={handMode}
          ready={ready}
          scale={scale}
          setReady={setReady}
          style={{ height: "100%" }}
          theme={theme}
          title={title}
          viewportMode="fullscreen"
        />
      </div>
    </div>,
    document.body,
  );
}

function VisualAction({
  active = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  icon: ReactNode;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-md px-2 text-fg-muted text-xs transition-colors hover:bg-hover hover:text-fg",
        active && "bg-hover text-fg",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      title={label}
      type="button"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function parseVisualArgs(args: unknown): VisualArgs | undefined {
  if (!args || typeof args !== "object") return undefined;
  const value = args as Record<string, unknown>;
  const kind = value.kind === "svg" ? "svg" : value.kind === "html" ? "html" : undefined;
  if (!kind) return undefined;
  return {
    title: typeof value.title === "string" && value.title.trim() ? value.title : "Visual",
    kind,
    content: typeof value.content === "string" ? value.content : "",
  };
}

function readTheme(): Record<string, string> {
  const styles = getComputedStyle(document.documentElement);
  const names = [
    "--color-canvas",
    "--color-surface",
    "--color-elevated",
    "--color-fg",
    "--color-fg-muted",
    "--color-fg-subtle",
    "--color-fg-faint",
    "--color-hairline",
    "--color-link",
    "--color-link-hover",
    "--color-hover",
    "--color-active",
    "--color-chip-faint",
    "--color-chip",
    "--color-chip-strong",
    "--color-success",
    "--color-danger",
    "--color-build",
    "--color-build-fg",
    "--color-accent",
    "--color-on-accent",
  ];
  return {
    ...Object.fromEntries(names.map((name) => [name, styles.getPropertyValue(name).trim()])),
    "--modus-color-scheme": styles.colorScheme.includes("light") ? "light" : "dark",
  };
}

function safeFilename(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "visual"
  );
}
