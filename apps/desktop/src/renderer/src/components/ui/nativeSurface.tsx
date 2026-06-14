import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

/**
 * Coordinates native-view occlusion for full-screen DOM overlays.
 *
 * Electron `WebContentsView`s (the embedded browser tabs) are composited by the
 * OS compositor *above* the renderer's DOM, so a `z-index` can never place a
 * DOM layer over them. Any full-screen DOM overlay — the image lightbox today,
 * dialogs/modals tomorrow — would therefore be partially covered by a visible
 * browser view, and the overlay's dark backdrop wouldn't dim it.
 *
 * The fix is cooperative: an overlay calls {@link useSuppressNativeSurface}
 * while it is on screen, which raises a reference-counted suppression flag; the
 * browser panel reads {@link useNativeSurfaceSuppressed} and hides its native
 * view whenever the count is non-zero, restoring it when the last overlay
 * closes. Reference counting means nested/stacked overlays compose correctly.
 *
 * The control function and the state are split across two contexts so that a
 * consumer of the (stable) control function never re-subscribes when the count
 * changes — acquiring suppression mustn't retrigger the acquiring effect.
 */
const NativeSurfaceControlContext = createContext<{ acquire(): () => void } | null>(null);
const NativeSurfaceStateContext = createContext<boolean>(false);

export function NativeSurfaceProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);

  // Stable for the provider's lifetime, so `useSuppressNativeSurface`'s effect
  // mounts/unmounts exactly once per overlay instead of churning on every count
  // change (which would otherwise release-and-reacquire in a loop).
  const control = useMemo(
    () => ({
      acquire(): () => void {
        setCount((current) => current + 1);
        let released = false;
        return () => {
          if (released) {
            return;
          }
          released = true;
          setCount((current) => Math.max(0, current - 1));
        };
      },
    }),
    [],
  );

  return (
    <NativeSurfaceControlContext.Provider value={control}>
      <NativeSurfaceStateContext.Provider value={count > 0}>
        {children}
      </NativeSurfaceStateContext.Provider>
    </NativeSurfaceControlContext.Provider>
  );
}

/** True when a DOM overlay is on top and native views must hide to stay behind it. */
export function useNativeSurfaceSuppressed(): boolean {
  return useContext(NativeSurfaceStateContext);
}

/**
 * While the calling component is mounted, suppress native views (hide embedded
 * browser tabs) so this overlay's backdrop covers everything. No-op outside a
 * {@link NativeSurfaceProvider}.
 */
export function useSuppressNativeSurface(): void {
  const control = useContext(NativeSurfaceControlContext);
  useEffect(() => control?.acquire(), [control]);
}
