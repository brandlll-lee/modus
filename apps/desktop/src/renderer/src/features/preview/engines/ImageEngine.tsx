import { useEffect, useMemo } from "react";
import type { PreviewEngineProps } from "../registry";

/** Image preview from raw bytes (PNG/JPEG/GIF/WEBP/BMP). */
export default function ImageEngine({ bytes, mime }: PreviewEngineProps) {
  const url = useMemo(() => {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy.buffer], { type: mime || "application/octet-stream" });
    return URL.createObjectURL(blob);
  }, [bytes, mime]);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  return (
    <div className="scroll-thin flex h-full items-center justify-center overflow-auto bg-canvas p-4">
      <img alt="" className="max-h-full max-w-full object-contain" src={url} />
    </div>
  );
}
