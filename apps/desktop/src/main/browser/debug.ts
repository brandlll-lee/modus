/**
 * Lightweight diagnostics for the browser subsystem. Enabled in development
 * (or with MODUS_BROWSER_DEBUG=1 in packaged builds) so silent failures in the
 * native-view/CDP plumbing show up in the dev terminal instead of vanishing.
 *
 * Deliberately electron-free so CDP modules stay unit-testable under vitest.
 */
const enabled =
  process.env.VITEST === undefined &&
  (process.env.NODE_ENV !== "production" || process.env.MODUS_BROWSER_DEBUG === "1");

export function browserDebugLog(scope: string, message: string, data?: unknown): void {
  if (!enabled) {
    return;
  }
  if (data === undefined) {
    console.log(`[browser:${scope}] ${message}`);
    return;
  }
  let rendered: string;
  try {
    rendered = JSON.stringify(data);
  } catch {
    rendered = String(data);
  }
  console.log(`[browser:${scope}] ${message} ${rendered}`);
}
