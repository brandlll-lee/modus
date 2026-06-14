import { IconX } from "@tabler/icons-react";
import type { DesignElementPayload } from "../../../../shared/contracts";
import { ImageThumb } from "../../components/ui/ImageViewer";

type DesignElementTokenProps = {
  element: DesignElementPayload;
  onRemove(): void;
};

/**
 * Composer context card for an element captured via the browser's Design Mode
 * (Ctrl+L). Pixel-matches Cursor's layout: an element-cropped screenshot
 * thumbnail with a hover-reveal remove control, and below it an inspect-glyph
 * chip — `Component · tag "text…"` — in brand-token color. Clicking the chip
 * also removes it (consistent with Modus's other context tokens). All colors
 * are Modus theme tokens, so it reads correctly in light and dark mode.
 */
export function DesignElementToken({ element, onRemove }: DesignElementTokenProps) {
  return (
    <div className="group/design relative flex w-full max-w-[300px] flex-col gap-1.5">
      {element.screenshotDataUrl ? (
        <div className="relative overflow-hidden rounded-xl border border-hairline bg-canvas">
          <ImageThumb
            alt={element.label}
            className="block max-h-[150px] w-full object-cover object-top"
            src={element.screenshotDataUrl}
          />
          <button
            aria-label="Remove element"
            className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full border border-hairline bg-elevated text-fg-faint opacity-0 shadow-popup transition-opacity hover:text-fg group-hover/design:opacity-100"
            onClick={onRemove}
            type="button"
          >
            <IconX size={12} stroke={2.2} />
          </button>
        </div>
      ) : null}
      <button
        className="flex max-w-full items-center gap-1.5 self-start rounded-md px-1 py-0.5 text-focus-ring transition-colors hover:bg-hover"
        onClick={onRemove}
        title={
          element.source
            ? `${element.label} — ${element.source.file}:${element.source.line} (click to remove)`
            : `${element.label} (click to remove)`
        }
        type="button"
      >
        <InspectGlyph />
        <span className="truncate text-sm">
          <span className="font-medium">{element.label}</span>
          {element.text ? (
            <span className="text-fg-subtle"> {`"${truncate(element.text, 28)}"`}</span>
          ) : null}
        </span>
      </button>
    </div>
  );
}

/** Pointer-in-frame inspect glyph — identical to the in-page popover head. */
function InspectGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="size-3.5 shrink-0"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
      width="14"
    >
      <path d="M5 3a2 2 0 0 0-2 2" />
      <path d="M19 3a2 2 0 0 1 2 2" />
      <path d="M5 21a2 2 0 0 1-2-2" />
      <path d="M9 3h1" />
      <path d="M9 21h2" />
      <path d="M14 3h1" />
      <path d="M3 9v1" />
      <path d="M21 9v2" />
      <path d="M3 14v1" />
      <path d="m12 12 4 10 1.7-4.3L22 16Z" />
    </svg>
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
