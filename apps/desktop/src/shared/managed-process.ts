/**
 * Pure, cross-boundary helpers for the unified managed-process model. Lives in
 * `shared/` so both the main process (facade/summaries) and the renderer
 * (composer bar, terminal panel) use one implementation — no duplication, no
 * renderer→main import.
 */

/** Compact elapsed label, e.g. `45s`, `2m 27s`, `1h 5m` (Cursor-style). */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
