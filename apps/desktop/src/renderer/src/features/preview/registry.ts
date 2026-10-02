import type { ComponentType } from "react";
import type { PreviewKind } from "../../../../shared/contracts";

export type PreviewEngineProps = {
  bytes: Uint8Array;
  mime: string;
  path: string;
};

type EngineLoader = () => Promise<{ default: ComponentType<PreviewEngineProps> }>;

/**
 * Capability registry: PreviewKind → lazy engine. New formats = one row here +
 * one detectPreviewKind magic rule — no call-site changes.
 */
const REGISTRY: Partial<Record<PreviewKind, EngineLoader>> = {
  pdf: () => import("./engines/PdfEngine"),
  docx: () => import("./engines/DocxEngine"),
  xlsx: () => import("./engines/XlsxEngine"),
  pptx: () => import("./engines/PptxEngine"),
  image: () => import("./engines/ImageEngine"),
};

export function loadPreviewEngine(kind: PreviewKind): EngineLoader | undefined {
  return REGISTRY[kind];
}
