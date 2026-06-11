import { useCallback, useState } from "react";
import type { PromptImageAttachment } from "../../../../shared/contracts";

export type ComposerImage = {
  id: string;
  name: string;
  mimeType: string;
  /** Full data: URL — drives <img> previews directly. */
  dataUrl: string;
};

/** Mirrors what vision models accept; anything else is silently ignored. */
const ACCEPTED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const MAX_COMPOSER_IMAGES = 6;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
}

/** data:image/png;base64,XXXX → XXXX */
function dataUrlPayload(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

/**
 * Image attachment state for the composer: accepts pasted or dropped files,
 * keeps lightweight previews, and serializes to prompt attachments on send.
 */
export function useComposerImages() {
  const [images, setImages] = useState<ComposerImage[]>([]);

  const addFiles = useCallback(async (files: Iterable<File>) => {
    const accepted: ComposerImage[] = [];
    for (const file of files) {
      if (!ACCEPTED_MIME_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES) {
        continue;
      }
      accepted.push({
        id: crypto.randomUUID(),
        name: file.name || "image",
        mimeType: file.type,
        dataUrl: await readAsDataUrl(file),
      });
    }
    if (accepted.length > 0) {
      setImages((current) => [...current, ...accepted].slice(0, MAX_COMPOSER_IMAGES));
    }
    return accepted.length;
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages((current) => current.filter((image) => image.id !== id));
  }, []);

  const clearImages = useCallback(() => setImages([]), []);

  const toAttachments = useCallback(
    (): PromptImageAttachment[] =>
      images.map((image) => ({
        type: "image",
        data: dataUrlPayload(image.dataUrl),
        mimeType: image.mimeType,
        name: image.name,
      })),
    [images],
  );

  return { addFiles, clearImages, images, removeImage, toAttachments };
}
