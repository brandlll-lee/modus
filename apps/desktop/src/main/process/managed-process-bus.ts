/**
 * Coarse change signal for the unified managed-process model (Observer).
 *
 * Terminal and app registries live in separate services; both call
 * `publishManagedProcessChange()` whenever a process is created, exits, or is
 * killed. The IPC layer subscribes once and re-pushes a session-scoped snapshot
 * to the renderer. The signal carries no payload on purpose: there is a single
 * source of truth (`listManagedProcesses`), so subscribers always re-read it
 * rather than trying to apply incremental deltas. This keeps the two registries
 * decoupled from the IPC layer and the renderer, and adding a future process
 * kind only means calling this same publisher.
 */

type ChangeListener = () => void;

const listeners = new Set<ChangeListener>();

export function onManagedProcessChange(listener: ChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishManagedProcessChange(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}
