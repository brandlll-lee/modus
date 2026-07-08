import { useCallback, useState } from "react";
import type { PromptImageAttachment } from "../../../../shared/contracts";

export type ComposerImage = {
  id: string;
  name: string;
  mimeType: string;
  /** Full data: URL — drives <img> previews directly. */
  dataUrl: string;
};

export type ComposerImageUpdate = ComposerImage[] | ((current: ComposerImage[]) => ComposerImage[]);

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
export function useComposerImages(options?: {
  images?: ComposerImage[];
  onImagesChange?: (update: ComposerImageUpdate) => void;
}) {
  const [uncontrolledImages, setUncontrolledImages] = useState<ComposerImage[]>([]);
  const images = options?.images ?? uncontrolledImages;
  const setImages = options?.onImagesChange ?? setUncontrolledImages;

  const addFiles = useCallback(
    async (files: Iterable<File>) => {
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
    },
    [setImages],
  );

  const removeImage = useCallback(
    (id: string) => {
      setImages((current) => current.filter((image) => image.id !== id));
    },
    [setImages],
  );

  const updateImage = useCallback(
    (id: string, dataUrl: string, mimeType = "image/png") => {
      setImages((current) =>
        current.map((image) =>
          image.id === id
            ? {
                ...image,
                dataUrl,
                mimeType,
                name: /\.[a-z0-9]+$/i.test(image.name)
                  ? image.name.replace(/\.[a-z0-9]+$/i, ".png")
                  : `${image.name}.png`,
              }
            : image,
        ),
      );
    },
    [setImages],
  );

  const clearImages = useCallback(() => setImages([]), [setImages]);

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

  return { addFiles, clearImages, images, removeImage, toAttachments, updateImage };
}
