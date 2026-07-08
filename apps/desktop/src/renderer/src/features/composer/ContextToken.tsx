import { IconX } from "@tabler/icons-react";
import type { ContextItem } from "../../../../shared/contracts";
import { TokenContent, tokenMeta } from "./composerTokens";

type ContextTokenProps = {
  item: ContextItem;
  onRemove(): void;
};

/**
 * Composer context chip (Cursor parity): a colored inline `icon · label` token,
 * no pill background or border at rest. Removal is explicit via the hover close.
 */
export function ContextToken({ item, onRemove }: ContextTokenProps) {
  const meta = tokenMeta(item);

  return (
    <span className="group/token inline-flex h-6 max-w-[220px] items-center text-sm font-medium">
      <TokenContent item={item} />
      <button
        aria-label={`Remove ${meta.label}`}
        className="flex h-3.5 w-0 shrink-0 items-center justify-center overflow-hidden rounded-sm text-link/70 opacity-0 transition-[width,opacity] hover:bg-chip hover:text-link group-hover/token:ml-0.5 group-hover/token:w-3.5 group-hover/token:opacity-100"
        onClick={onRemove}
        title={`Remove ${meta.label}`}
        type="button"
      >
        <IconX size={10} stroke={2.1} />
      </button>
    </span>
  );
}
