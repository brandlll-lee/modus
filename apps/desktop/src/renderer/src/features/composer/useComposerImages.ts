import { useCallback, useState } from "react";
import type { PromptImageAttachment } from "../../../../shared/contracts";

export type ComposerImage = {
  id: string;
  name: string;
  mimeType: string;
  /** Full data: URL — drives <img> previews directly. */
  dataUrl: string;
  path?: string | undefined;
};

export type ComposerImageUpdate = ComposerImage[] | ((current: ComposerImage[]) => ComposerImage[]);

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
  onError?(message: string): void;
}) {
  const [uncontrolledImages, setUncontrolledImages] = useState<ComposerImage[]>([]);
  const [pending, setPending] = useState(0);
  const images = options?.images ?? uncontrolledImages;
  const setImages = options?.onImagesChange ?? setUncontrolledImages;
  const onError = options?.onError;

  const addFiles = useCallback(
    async (files: Iterable<File>) => {
      const selected = [...files].filter((file) => file.type.startsWith("image/"));
      setPending((count) => count + 1);
      try {
        const accepted = await Promise.all(
          selected.map(async (file): Promise<ComposerImage> => {
            const dataUrl = await readAsDataUrl(file);
            const path = await window.modus.file.prepareImage({
              path: window.modus.file.getPath(file) || undefined,
              data: dataUrlPayload(dataUrl),
              mimeType: file.type,
            });
            return {
              id: crypto.randomUUID(),
              name: file.name || "image",
              mimeType: file.type,
              dataUrl,
              path,
            };
          }),
        );
        if (accepted.length) setImages((current) => [...current, ...accepted]);
        return accepted.length;
      } catch (error) {
        onError?.(error instanceof Error ? error.message : String(error));
        return 0;
      } finally {
        setPending((count) => count - 1);
      }
    },
    [setImages, onError],
  );

  const removeImage = useCallback(
    (id: string) => {
      setImages((current) => current.filter((image) => image.id !== id));
    },
    [setImages],
  );

  const updateImage = useCallback(
    async (id: string, dataUrl: string, mimeType = "image/png") => {
      setPending((count) => count + 1);
      try {
        const path = await window.modus.file.prepareImage({
          data: dataUrlPayload(dataUrl),
          mimeType,
        });
        setImages((current) =>
          current.map((image) =>
            image.id === id
              ? {
                  ...image,
                  dataUrl,
                  mimeType,
                  path,
                  name: /\.[a-z0-9]+$/i.test(image.name)
                    ? image.name.replace(/\.[a-z0-9]+$/i, ".png")
                    : `${image.name}.png`,
                }
              : image,
          ),
        );
      } catch (error) {
        onError?.(error instanceof Error ? error.message : String(error));
      } finally {
        setPending((count) => count - 1);
      }
    },
    [setImages, onError],
  );

  const clearImages = useCallback(() => setImages([]), [setImages]);

  const toAttachments = useCallback(
    (): PromptImageAttachment[] =>
      images.map((image) => ({
        type: "image",
        data: dataUrlPayload(image.dataUrl),
        mimeType: image.mimeType,
        name: image.name,
        path: image.path,
      })),
    [images],
  );

  return {
    addFiles,
    clearImages,
    images,
    isPreparing: pending > 0,
    removeImage,
    toAttachments,
    updateImage,
  };
}
