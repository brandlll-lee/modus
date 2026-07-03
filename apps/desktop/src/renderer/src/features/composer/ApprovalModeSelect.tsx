import { Menu } from "@base-ui/react/menu";
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
 * Composer control for the GLOBAL approval mode. The value is app-wide and
 * persisted in the main process, so every session reads it at tool-call time.
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
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Approval mode: ${current.label}`}
        className="app-no-drag flex h-[26px] shrink-0 items-center gap-1.5 rounded-md px-1.5 text-sm transition-colors hover:bg-hover data-popup-open:bg-hover"
        title={current.label}
      >
        <TriggerIcon
          className={cn("shrink-0", danger ? "text-accent" : "text-fg-subtle")}
          size={15}
          stroke={1.8}
        />
        <span className={cn("max-w-[120px] truncate", danger ? "text-accent" : "text-fg-subtle")}>
          {current.label}
        </span>
        <IconChevronDown className="shrink-0 text-fg-faint" size={12} stroke={2} />
      </Menu.Trigger>
      <Menu.Portal>
        {/* Opens upward — the composer sits at the window's bottom edge. */}
        <Menu.Positioner
          align="start"
          collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
          side="top"
          sideOffset={6}
        >
          <Menu.Popup className="origin-(--transform-origin) w-[300px] max-w-[calc(100vw-24px)] rounded-lg border border-hairline bg-elevated p-1 shadow-popup">
            {APPROVAL_MODES.map((item) => {
              const ItemIcon = MODE_ICONS[item.id];
              const itemDanger = item.id === "full-access";
              return (
                <Menu.Item
                  className="group/mode flex cursor-default items-start gap-2 rounded-md px-2 py-1.5 outline-none select-none data-highlighted:bg-hover"
                  key={item.id}
                  onClick={() => changeMode(item.id)}
                >
                  <ItemIcon
                    className={cn("mt-0.5 shrink-0", itemDanger ? "text-accent" : "text-fg-subtle")}
                    size={15}
                    stroke={1.8}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-fg">{item.label}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-fg-faint">
                      {item.description}
                    </span>
                  </span>
                  <span className="mt-0.5 flex w-3.5 shrink-0 justify-center text-fg">
                    {item.id === mode ? <IconCheck size={13} stroke={2} /> : null}
                  </span>
                </Menu.Item>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
