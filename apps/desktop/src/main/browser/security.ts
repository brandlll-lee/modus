import type { Session } from "electron";

/**
 * Security policy for the in-app browser: URL normalization with a protocol
 * allowlist, per-workspace session partitioning, default-deny permission
 * handling, and download interception.
 */

export const DEFAULT_URL = "about:blank";

/** Per-workspace persistent partition: cookies/storage never cross workspaces. */
export function workspacePartition(workspaceId: string): string {
  return `persist:modus-browser-${workspaceId.replace(/[^\w.-]/g, "-")}`;
}

/** Protocols the in-app browser may load. `file:` is deliberately excluded. */
export function isNavigableUrl(url: string): boolean {
  return /^(about|https?):/i.test(url.trim());
}

/**
 * Turn address-bar/agent input into a navigable URL: pass through http(s) and
 * about:, upgrade bare domains/localhost, and fall back to a web search.
 * Anything outside the allowlist (file:, chrome:, custom schemes) becomes a
 * search query, so the agent cannot reach the local filesystem.
 */
export function normalizeBrowserUrl(rawInput: string): string {
  const input = rawInput.trim();
  if (!input) {
    return DEFAULT_URL;
  }

  if (isNavigableUrl(input)) {
    return input;
  }

  if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(\/.*)?$/i.test(input)) {
    return `http://${input}`;
  }

  if (/^[\w.-]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(input)) {
    return `https://${input}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}

/** Permissions that are harmless without a user gesture. Everything else —
 * camera, microphone, geolocation, notifications, MIDI, HID — is denied:
 * agent-driven browsing carries no user intent that could justify them. */
const ALLOWED_PERMISSIONS = new Set<string>(["clipboard-sanitized-write"]);

const securedSessions = new WeakSet<Session>();

/**
 * Apply default-deny permission and download policies to a browser session.
 * Idempotent per session (sessions are shared by all tabs of a workspace).
 */
export function applySessionSecurity(session: Session): void {
  if (securedSessions.has(session)) {
    return;
  }
  securedSessions.add(session);

  session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  session.setPermissionCheckHandler((_webContents, permission) => {
    return ALLOWED_PERMISSIONS.has(permission);
  });

  session.on("will-download", (event, item) => {
    // The embedded browser is an inspection surface, not a download manager.
    // Cancel and surface the attempt in the console-ish event log instead of
    // silently writing files to disk.
    event.preventDefault();
    console.info(`[browser] download blocked: ${item.getURL()}`);
  });
}
