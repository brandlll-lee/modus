import { Select } from "@base-ui/react/select";
import {
  IconAlertCircle,
  IconCheck,
  IconChevronDown,
  IconHandStop,
  IconShieldCheck,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import {
  APPROVAL_MODE_BY_ID,
  APPROVAL_MODES,
  DEFAULT_APPROVAL_MODE,
} from "../../../../shared/approval";
import type { ApprovalMode } from "../../../../shared/contracts";
import { cn } from "../../lib/cn";

/** Per-mode glyph; `full-access` carries the warning weight (it never prompts). */
const MODE_ICONS: Record<ApprovalMode, typeof IconHandStop> = {
  "request-approval": IconHandStop,
  auto: IconShieldCheck,
  "full-access": IconAlertCircle,
};

/**
 * Composer control for the GLOBAL approval mode. Mirrors `ModelSelect` (Base UI
 * Select) for visual consistency. The value is app-wide and persisted in the
 * main process, so this loads the current mode on mount and writes changes back
 * — every session then reads it at tool-call time.
 */
export function ApprovalModeSelect() {
  const [mode, setMode] = useState<ApprovalMode>(DEFAULT_APPROVAL_MODE);

  useEffect(() => {
    let active = true;
    void window.modus.permission.getMode().then((value: ApprovalMode) => {
      if (active) {
        setMode(value);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  function changeMode(next: ApprovalMode): void {
    setMode(next);
    void window.modus.permission.setMode(next).catch(() => {});
  }

  const current = APPROVAL_MODE_BY_ID[mode];
  const danger = current.id === "full-access";
  const TriggerIcon = MODE_ICONS[current.id];

  return (
    <Select.Root onValueChange={(next) => changeMode(next as ApprovalMode)} value={mode}>
      {/* Icon-only control: the mode glyph + dropdown chevron (label lives in the menu). */}
      <Select.Trigger
        aria-label={`Approval mode: ${current.label}`}
        className="app-no-drag flex h-[26px] shrink-0 items-center gap-0.5 rounded-md px-1.5 transition-colors hover:bg-hover data-popup-open:bg-hover"
        title={current.label}
      >
        <TriggerIcon
          className={cn("shrink-0", danger ? "text-accent" : "text-fg-subtle")}
          size={15}
          stroke={1.8}
        />
        <Select.Icon>
          <IconChevronDown className="shrink-0 text-fg-faint" size={12} stroke={2} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        {/* Opens upward — the composer sits at the window's bottom edge. */}
        <Select.Positioner
          align="start"
          alignItemWithTrigger={false}
          collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
          side="top"
          sideOffset={6}
        >
          <Select.Popup className="origin-(--transform-origin) w-[300px] max-w-[calc(100vw-24px)] rounded-lg border border-hairline bg-elevated p-1 shadow-popup transition-[transform,opacity] duration-100 data-[side=bottom]:data-ending-style:translate-y-[-4px] data-[side=bottom]:data-starting-style:translate-y-[-4px] data-[side=top]:data-ending-style:translate-y-[4px] data-[side=top]:data-starting-style:translate-y-[4px] data-ending-style:opacity-0 data-starting-style:opacity-0">
            {APPROVAL_MODES.map((item) => {
              const ItemIcon = MODE_ICONS[item.id];
              const itemDanger = item.id === "full-access";
              return (
                <Select.Item
                  className="group/mode flex cursor-default items-start gap-2 rounded-md px-2 py-1.5 outline-none select-none data-highlighted:bg-hover"
                  key={item.id}
                  value={item.id}
                >
                  <ItemIcon
                    className={cn("mt-0.5 shrink-0", itemDanger ? "text-accent" : "text-fg-subtle")}
                    size={15}
                    stroke={1.8}
                  />
                  <span className="min-w-0 flex-1">
                    <Select.ItemText className="block text-sm text-fg">
                      {item.label}
                    </Select.ItemText>
                    <span className="mt-0.5 block text-xs leading-snug text-fg-faint">
                      {item.description}
                    </span>
                  </span>
                  <span className="mt-0.5 flex w-3.5 shrink-0 justify-center text-fg">
                    <Select.ItemIndicator>
                      <IconCheck size={13} stroke={2} />
                    </Select.ItemIndicator>
                  </span>
                </Select.Item>
              );
            })}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
