import { Dialog } from "@base-ui/react/dialog";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";
import { useSuppressNativeSurface } from "./nativeSurface";

export function DialogSurface({
  size = "detail",
  className,
  ...props
}: Omit<Dialog.Popup.Props, "className"> & { size?: "detail" | "compact"; className?: string }) {
  return (
    <Dialog.Portal>
      <Dialog.Backdrop className="fixed inset-0 z-50 bg-fg/20" />
      <SurfacePopup
        {...props}
        className={cn("dialog-surface", size === "compact" && "dialog-compact", className)}
      />
    </Dialog.Portal>
  );
}

function SurfacePopup(props: Dialog.Popup.Props) {
  useSuppressNativeSurface();
  return <Dialog.Popup {...props} />;
}

export function DialogBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cn("scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain", className)}
    />
  );
}
