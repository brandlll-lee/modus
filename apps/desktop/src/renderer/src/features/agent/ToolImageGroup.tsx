// biome-ignore-all lint/suspicious/noArrayIndexKey: PI image blocks have positional identity within each tool result.
import { IconPhoto } from "@tabler/icons-react";
import { memo, useId, useState } from "react";
import { getToolUiMeta } from "../../../../shared/tools";
import { CollapsibleMotion } from "../../components/ui/CollapsibleMotion";
import { ImageThumb } from "../../components/ui/ImageViewer";
import { ActivityHeader } from "./ActivityHeader";
import type { ToolBlockItem } from "./Timeline";
import { ToolCard } from "./ToolCard";

export const ToolImageGroup = memo(function ToolImageGroup({ items }: { items: ToolBlockItem[] }) {
  const [open, setOpen] = useState(true);
  const contentId = useId();
  const count = items.reduce((total, item) => total + (item.images?.length ?? 0), 0);
  const verbs = new Set(items.map((item) => getToolUiMeta(item.name)?.imageVerb));
  const verb = verbs.size === 1 ? verbs.values().next().value : undefined;
  const summary = `${verb ? `${verb} ` : "Image results · "}${count} ${count === 1 ? "image" : "images"}`;
  const label = items.some((item) => item.isError) ? `Failed: ${summary}` : summary;
  const active = items.some((item) => !item.isComplete && !item.isError);

  return (
    <div className="min-w-0" data-image-group>
      <ActivityHeader
        active={active}
        controlsId={contentId}
        icon={<IconPhoto aria-hidden />}
        label={label}
        onToggle={() => setOpen((value) => !value)}
        open={open}
      />
      <CollapsibleMotion id={contentId} open={open} preset="timeline">
        <div className="mt-2 flex flex-wrap gap-[12px]">
          {items.flatMap((item) =>
            (item.images ?? []).map((image, index) => (
              <ImageThumb
                alt={`${item.label ?? item.name} · image ${index + 1}`}
                className="size-[100px] max-w-full rounded-[10px] border border-hairline-soft bg-card object-contain"
                key={`${item.id}:${index}`}
                src={`data:${image.mimeType};base64,${image.data}`}
              />
            )),
          )}
        </div>
        {items.some((item) => item.output || item.isError) ? (
          <details className="mt-1.5 text-xs text-fg-faint">
            <summary className="w-fit cursor-pointer rounded-md py-0.5 hover:text-fg-muted">
              Tool output
            </summary>
            <div className="mt-1.5 space-y-2">
              {items.map((item) => (
                <ToolCard {...item} key={item.id} />
              ))}
            </div>
          </details>
        ) : null}
      </CollapsibleMotion>
    </div>
  );
});
