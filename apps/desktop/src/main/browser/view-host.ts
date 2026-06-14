import type {
  BrowserWindow as BrowserWindowType,
  Rectangle,
  WebContentsView as WebContentsViewType,
} from "electron";
import type { BrowserBounds } from "../../shared/contracts";
import { browserDebugLog } from "./debug";

/**
 * Native WebContentsView ↔ BrowserWindow plumbing: attach/detach, bounds
 * clamping, and visibility.
 *
 * Visibility intentionally uses `setVisible(false)` rather than detaching the
 * child view: re-attaching forces a new compositor surface (white flash) and
 * resets paint state, which caused the flicker when switching tabs or
 * Inspector panes. The view is only truly detached when the tab closes or
 * moves to another window.
 */

export interface HostedView {
  view: WebContentsViewType;
  ownerWindow?: BrowserWindowType;
  attached: boolean;
}

export function attachView(host: HostedView, window: BrowserWindowType): void {
  if (host.ownerWindow && host.ownerWindow !== window) {
    detachView(host);
  }
  if (!host.attached) {
    window.contentView.addChildView(host.view);
    host.attached = true;
  } else if (host.ownerWindow === window) {
    // Re-adding an already-attached child raises it to the top of the
    // sibling stack, which keeps the active tab above hidden ones.
    window.contentView.addChildView(host.view);
  }
  host.ownerWindow = window;
}

export function detachView(host: HostedView): void {
  if (host.attached && host.ownerWindow && !host.ownerWindow.isDestroyed()) {
    try {
      host.ownerWindow.contentView.removeChildView(host.view);
    } catch {
      // The native view may already be detached during window teardown.
    }
  }
  host.attached = false;
  delete host.ownerWindow;
}

/** Clamp to the window's content area and apply. Always applied unconditionally:
 * stale-bounds caching was one root cause of the "view pinned in the corner"
 * black-border bug, so correctness beats saving a native call. */
export function setViewBounds(host: HostedView, bounds: BrowserBounds): void {
  const x = Math.max(0, Math.round(bounds.x));
  const y = Math.max(0, Math.round(bounds.y));
  let width = Math.max(0, Math.round(bounds.width));
  let height = Math.max(0, Math.round(bounds.height));

  if (host.ownerWindow && !host.ownerWindow.isDestroyed()) {
    const contentSize = host.ownerWindow.getContentSize();
    const contentWidth = contentSize[0] ?? 0;
    const contentHeight = contentSize[1] ?? 0;
    width = Math.min(width, Math.max(0, contentWidth - x));
    height = Math.min(height, Math.max(0, contentHeight - y));
  }

  const rectangle: Rectangle = { x, y, width, height };
  host.view.setBounds(rectangle);
  browserDebugLog("bounds", "setBounds", {
    requested: bounds,
    applied: rectangle,
    contentSize: host.ownerWindow?.isDestroyed() ? null : host.ownerWindow?.getContentSize(),
    actual: host.view.getBounds(),
  });
}

/** Attach (if needed), make visible, and force-apply bounds in one step. */
export function showView(host: HostedView, window: BrowserWindowType, bounds: BrowserBounds): void {
  attachView(host, window);
  host.view.setVisible(true);
  setViewBounds(host, bounds);
}

/** Hide without detaching (no compositor teardown, no re-attach flash). */
export function hideView(host: HostedView): void {
  if (host.attached) {
    host.view.setVisible(false);
  }
}
