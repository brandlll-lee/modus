import { IconSearch, IconX } from "@tabler/icons-react";
import { cn } from "../../lib/cn";

type SearchFieldProps = {
  ariaLabel: string;
  placeholder: string;
  value: string;
  onChange(value: string): void;
  className?: string;
};

export function SearchField({
  ariaLabel,
  className,
  onChange,
  placeholder,
  value,
}: SearchFieldProps) {
  return (
    <label className={cn("relative block min-w-0", className)}>
      <span className="sr-only">{ariaLabel}</span>
      <IconSearch
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-faint"
        size={15}
        stroke={1.7}
      />
      <input
        aria-label={ariaLabel}
        className="search-control h-9 w-full rounded-md border border-hairline bg-canvas pr-8 pl-8 text-sm text-fg placeholder:text-fg-faint"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        type="search"
        value={value}
      />
      {value ? (
        <button
          aria-label={`Clear ${ariaLabel.toLowerCase()}`}
          className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg"
          onClick={() => onChange("")}
          type="button"
        >
          <IconX aria-hidden size={13} stroke={1.8} />
        </button>
      ) : null}
    </label>
  );
}
