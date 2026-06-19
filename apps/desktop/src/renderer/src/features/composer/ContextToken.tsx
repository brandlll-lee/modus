import type { ContextItem } from "../../../../shared/contracts";
import { TokenContent, tokenMeta } from "./composerTokens";

type ContextTokenProps = {
  item: ContextItem;
  onRemove(): void;
};

/**
 * Composer context chip (Cursor parity): a colored inline `icon · label` token,
 * no pill background or border at rest. The whole chip is clickable to remove.
 */
export function ContextToken({ item, onRemove }: ContextTokenProps) {
  const meta = tokenMeta(item);

  return (
    <button
      aria-label={`Remove ${meta.label}`}
      className="inline-flex h-6 max-w-[220px] items-center rounded-md px-0.5 text-sm font-medium transition-colors hover:bg-focus-ring-soft/10"
      onClick={onRemove}
      title={`Remove ${meta.label}`}
      type="button"
    >
      <TokenContent item={item} />
    </button>
  );
}
