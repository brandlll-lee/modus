import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

type TooltipProps = {
  content: ReactNode;
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  sideOffset?: number;
  motion?: "scale" | "fade";
};

/** 包裹 Base UI Tooltip，统一弹层样式与进出场过渡。需在外层套一次 TooltipProvider。 */
export function Tooltip({
  content,
  children,
  motion = "scale",
  side = "bottom",
  sideOffset = 8,
}: TooltipProps) {
  const motionClass =
    motion === "fade"
      ? "transition-opacity duration-75 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
      : "transition-[transform,opacity] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0";

  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={sideOffset}>
          <BaseTooltip.Popup
            className={
              "origin-(--transform-origin) rounded-md border border-hairline bg-elevated px-2 py-1 " +
              `text-fg text-xs shadow-popup ${motionClass}`
            }
          >
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

export const TooltipProvider = BaseTooltip.Provider;
