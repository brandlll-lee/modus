import { type ComponentProps, useEffect, useState } from "react";
import { ImageThumb } from "../../components/ui/ImageViewer";
import { useMarkdownFileNav } from "./markdownFileNav";
import { parseModusFileHref } from "./workspaceFileLinks";

export function MarkdownImage(props: ComponentProps<"img"> & { node?: unknown }) {
  const path = typeof props.src === "string" ? parseModusFileHref(props.src) : undefined;
  if (!path)
    return (
      <ImageSurface
        alt={props.alt ?? "Image"}
        key={String(props.src)}
        src={String(props.src ?? "")}
      />
    );
  return <LocalImage alt={props.alt ?? "Image"} key={path} path={path} />;
}

function ImageSurface({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="text-fg-muted text-xs">Image unavailable: {alt}</span>
  ) : (
    <ImageThumb
      alt={alt}
      className="max-h-[360px] max-w-full rounded-lg object-contain"
      onError={() => setFailed(true)}
      src={src}
    />
  );
}

function LocalImage({ path, alt }: { path: string; alt: string }) {
  const { cwd } = useMarkdownFileNav();
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setUrl(undefined);
    setError(undefined);
    if (!cwd) {
      setError("Session directory is not available.");
      return;
    }
    void window.modus.file.readImage({ cwd, path }).then(
      ({ bytes, mime }) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
        setUrl(objectUrl);
      },
      (cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cwd, path]);
  return (
    <span className="my-3 inline-block max-w-full">
      {error ? (
        <span className="text-fg-muted text-xs" title={path}>
          Image unavailable: {error}
        </span>
      ) : url ? (
        <ImageSurface alt={alt} key={url} src={url} />
      ) : (
        <span className="text-fg-muted text-xs">Loading image…</span>
      )}
    </span>
  );
}
