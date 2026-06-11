import { Select } from "@base-ui/react/select";
import { Switch } from "@base-ui/react/switch";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { AnimatePresence, m } from "motion/react";
import { type ReactNode, useState } from "react";
import { cn } from "../../lib/cn";
import type { KeyValueRow } from "./provider-form-mapping";

/**
 * Shared low-level form primitives for the Settings surface (fields, selects,
 * switches, disclosures, key/value rows). Extracted from SettingsPanel so the
 * provider dialogs and future settings pages compose the same building blocks.
 * Pure value helpers (key/value rows, numeric parsing) live in
 * provider-form-mapping and are re-exported here for UI consumers.
 */

export {
  createKeyValueRow,
  type KeyValueRow,
  keyValueRowsToRecord,
  parseOptionalNumber,
  parsePositiveInteger,
  recordToKeyValueRows,
} from "./provider-form-mapping";

export function optionLabel<T extends string>(
  options: readonly { label: string; value: T }[],
  value: string,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

export function Field({
  autoComplete,
  description,
  label,
  mono = false,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  autoComplete?: string;
  description?: string;
  label: string;
  /** Render the input in the mono face (ids, URLs, header values). */
  mono?: boolean;
  value: string;
  onChange(value: string): void;
  placeholder: string;
  type?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs text-fg-muted">{label}</span>
      <input
        autoComplete={autoComplete}
        className={cn(
          "h-10 w-full rounded-md border border-hairline bg-canvas px-3 text-sm text-fg outline-none placeholder:text-fg-faint transition-colors hover:border-hairline-strong focus:border-hairline-strong focus:ring-2 focus:ring-white/5",
          mono && "font-mono",
        )}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
      {description ? <span className="text-xs leading-5 text-fg-faint">{description}</span> : null}
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { label: string; value: T }[];
  onChange(value: T): void;
}) {
  return (
    <div className="grid gap-2">
      <span className="text-xs text-fg-muted">{label}</span>
      <Select.Root
        onValueChange={(next) => {
          if (typeof next === "string") {
            onChange(next as T);
          }
        }}
        value={value}
      >
        <Select.Trigger
          aria-label={label}
          className="flex h-10 w-full items-center justify-between gap-3 rounded-md border border-hairline bg-canvas px-3 text-sm text-fg outline-none transition-colors hover:border-hairline-strong focus-visible:border-hairline-strong focus-visible:ring-2 focus-visible:ring-white/5 data-popup-open:border-hairline-strong"
        >
          <Select.Value>{(selected) => optionLabel(options, String(selected))}</Select.Value>
          <Select.Icon>
            <IconChevronDown className="text-fg-faint" size={14} stroke={1.8} />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner
            align="start"
            alignItemWithTrigger={false}
            collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
            side="bottom"
            sideOffset={5}
          >
            <Select.Popup className="scroll-thin origin-(--transform-origin) min-w-[var(--anchor-width)] overflow-y-auto rounded-lg border border-hairline bg-elevated p-1 shadow-popup transition-[transform,opacity] duration-100 data-[side=bottom]:data-ending-style:translate-y-[-4px] data-[side=bottom]:data-starting-style:translate-y-[-4px] data-[side=top]:data-ending-style:translate-y-[4px] data-[side=top]:data-starting-style:translate-y-[4px] data-ending-style:opacity-0 data-starting-style:opacity-0">
              {options.map((option) => (
                <Select.Item
                  className="grid h-8 cursor-default grid-cols-[minmax(0,1fr)_16px] items-center gap-2 rounded-md px-2 text-sm text-fg-muted outline-none select-none data-highlighted:bg-hover data-highlighted:text-fg"
                  key={option.value}
                  value={option.value}
                >
                  <Select.ItemText className="min-w-0 truncate">{option.label}</Select.ItemText>
                  <span className="flex justify-center text-fg">
                    <Select.ItemIndicator>
                      <IconCheck size={13} stroke={2} />
                    </Select.ItemIndicator>
                  </span>
                </Select.Item>
              ))}
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

export function SwitchControl({
  ariaLabel,
  checked,
  disabled,
  onCheckedChange,
}: {
  ariaLabel: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange(checked: boolean): void;
}) {
  return (
    <Switch.Root
      aria-label={ariaLabel}
      checked={checked}
      className={cn(
        "relative flex h-5 w-9 shrink-0 items-center rounded-full border border-hairline bg-chip px-0.5 outline-none transition-colors",
        "data-[checked]:border-fg data-[checked]:bg-fg",
        "data-[unchecked]:hover:bg-chip-strong",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        "focus-visible:border-hairline-strong focus-visible:ring-2 focus-visible:ring-white/10",
      )}
      disabled={disabled}
      onCheckedChange={(nextChecked) => onCheckedChange(nextChecked)}
    >
      <Switch.Thumb
        className={cn(
          "block size-4 rounded-full bg-fg-muted transition-transform duration-150 ease-out",
          "data-[checked]:translate-x-4 data-[checked]:bg-canvas",
          "data-[unchecked]:translate-x-0",
        )}
      />
    </Switch.Root>
  );
}

/** Compact labeled switch row — one line, no card chrome. */
export function ToggleField({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange(value: boolean): void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="min-w-0">
        <span className="block text-sm text-fg">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-fg-faint">{description}</span>
      </span>
      <SwitchControl ariaLabel={label} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function Disclosure({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="grid gap-3">
      <button
        aria-expanded={open}
        className="flex w-fit items-center gap-1.5 text-xs text-fg-subtle transition-colors hover:text-fg"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <IconChevronRight
          className={cn("transition-transform duration-150", open && "rotate-90")}
          size={13}
          stroke={1.8}
        />
        {label}
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <m.div
            animate={{ height: "auto", opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="grid gap-5 pt-1">{children}</div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** Borderless key/value row list with add/remove — used for header editors. */
export function KeyValueEditor({
  addLabel,
  description,
  emptyLabel,
  keyPlaceholder,
  rows,
  title,
  valuePlaceholder,
  onAdd,
  onChange,
  onRemove,
}: {
  addLabel: string;
  description: string;
  emptyLabel: string;
  keyPlaceholder: string;
  rows: KeyValueRow[];
  title: string;
  valuePlaceholder: string;
  onAdd(): void;
  onChange(rowId: string, patch: Partial<KeyValueRow>): void;
  onRemove(rowId: string): void;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xs text-fg-muted">{title}</h3>
          <p className="mt-0.5 max-w-[560px] text-xs leading-5 text-fg-faint">{description}</p>
        </div>
        <button
          className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
          onClick={onAdd}
          type="button"
        >
          <IconPlus size={13} stroke={1.8} />
          {addLabel}
        </button>
      </div>
      <div className="grid gap-2">
        <AnimatePresence initial={false}>
          {rows.map((row) => (
            <m.div
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_32px] gap-2"
              exit={{ opacity: 0, y: -4 }}
              initial={{ opacity: 0, y: 4 }}
              key={row.rowId}
              layout
              transition={{ duration: 0.14, ease: "easeOut" }}
            >
              <input
                aria-label={`${title} key`}
                className="h-9 rounded-md border border-hairline bg-canvas px-3 font-mono text-xs text-fg outline-none placeholder:text-fg-faint transition-colors hover:border-hairline-strong focus:border-hairline-strong"
                onChange={(event) => onChange(row.rowId, { key: event.target.value })}
                placeholder={keyPlaceholder}
                value={row.key}
              />
              <input
                aria-label={`${title} value`}
                className="h-9 rounded-md border border-hairline bg-canvas px-3 font-mono text-xs text-fg outline-none placeholder:text-fg-faint transition-colors hover:border-hairline-strong focus:border-hairline-strong"
                onChange={(event) => onChange(row.rowId, { value: event.target.value })}
                placeholder={valuePlaceholder}
                value={row.value}
              />
              <button
                aria-label="Remove row"
                className="flex size-9 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg"
                onClick={() => onRemove(row.rowId)}
                type="button"
              >
                <IconTrash size={13} stroke={1.7} />
              </button>
            </m.div>
          ))}
        </AnimatePresence>
        {rows.length === 0 ? <p className="text-xs text-fg-faint">{emptyLabel}</p> : null}
      </div>
    </section>
  );
}
