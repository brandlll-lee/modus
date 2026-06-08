import { useSyncExternalStore } from "react";

/**
 * App color theme. Dark is the original, hand-tuned palette; Light is a
 * deliberate second theme (off-white base, elevation via white + shadow,
 * black-alpha borders, WCAG-checked text tiers) derived from the dark tokens.
 *
 * The active theme is a single `data-theme` attribute on <html>; all visuals
 * come from CSS custom properties overridden under `:root[data-theme="light"]`
 * in app.css, so switching is instant and component code never changes.
 */
export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "modus.theme";
const DEFAULT_THEME: ThemeMode = "dark";

function readStored(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

let current: ThemeMode = readStored();
const listeners = new Set<() => void>();

/** Reflect the active theme onto <html data-theme>. Safe to call repeatedly. */
export function applyTheme(mode: ThemeMode): void {
  document.documentElement.setAttribute("data-theme", mode);
}

/** Call once before first render so the correct palette paints with no flash. */
export function initTheme(): void {
  applyTheme(current);
}

export function getTheme(): ThemeMode {
  return current;
}

export function setTheme(mode: ThemeMode): void {
  if (mode === current) {
    return;
  }
  current = mode;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore persistence failures (private mode etc.)
  }
  applyTheme(mode);
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive [theme, setTheme] for components (e.g. the Appearance toggle). */
export function useTheme(): readonly [ThemeMode, (mode: ThemeMode) => void] {
  const theme = useSyncExternalStore(subscribe, getTheme, getTheme);
  return [theme, setTheme];
}
