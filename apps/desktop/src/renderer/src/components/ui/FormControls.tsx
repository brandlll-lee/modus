import { Select } from "@base-ui/react/select";
import { Switch } from "@base-ui/react/switch";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import { cn } from "../../lib/cn";

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
        className={cn("field-control h-10", mono && "font-mono")}
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
          className="field-control flex h-10 items-center justify-between gap-3 data-popup-open:border-focus-ring"
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
            <Select.Popup className="scroll-thin origin-(--transform-origin) min-w-[var(--anchor-width)] overflow-y-auto popup-chrome p-1 transition-[transform,opacity] duration-100 data-[side=bottom]:data-ending-style:translate-y-[-4px] data-[side=bottom]:data-starting-style:translate-y-[-4px] data-[side=top]:data-ending-style:translate-y-[4px] data-[side=top]:data-starting-style:translate-y-[4px] data-ending-style:opacity-0 data-starting-style:opacity-0">
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
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
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
