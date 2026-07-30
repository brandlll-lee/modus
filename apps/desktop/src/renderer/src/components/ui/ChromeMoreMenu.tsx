import { Menu } from "@base-ui/react/menu";
import { IconDots, IconSettings } from "@tabler/icons-react";
import { TOOLBAR_ICON } from "./ToolbarButton";
import { Tooltip } from "./Tooltip";

/** Toolbar ⋯ overflow — Settings is the first real entry (App header + Inspector). */
export function ChromeMoreMenu({ onOpenSettings }: { onOpenSettings(): void }) {
  return (
    <Menu.Root>
      <Tooltip content="More">
        <Menu.Trigger
          aria-label="More"
          className="toolbar-icon-button app-no-drag flex items-center justify-center rounded-md transition-colors hover:bg-hover data-popup-open:bg-active"
        >
          <IconDots size={TOOLBAR_ICON.size} stroke={TOOLBAR_ICON.stroke} />
        </Menu.Trigger>
      </Tooltip>
      <Menu.Portal>
        <Menu.Positioner align="end" side="bottom" sideOffset={6}>
          <Menu.Popup className="origin-(--transform-origin) min-w-40 popup-chrome p-1">
            <Menu.Item
              className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-fg text-sm outline-none transition-colors select-none data-highlighted:bg-hover"
              onClick={onOpenSettings}
            >
              <IconSettings size={TOOLBAR_ICON.size} stroke={TOOLBAR_ICON.stroke} />
              <span>Settings</span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
