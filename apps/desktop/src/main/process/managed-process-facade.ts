import type { ManagedProcessInfo } from "../../shared/contracts";
import { killTerminal, listTerminals } from "../terminal/terminal-service";
import { isAppId, killApp, listApps } from "./app-process-service";
import {
  appToManaged,
  type ManagedProcessQuery,
  selectManagedProcesses,
  terminalToManaged,
} from "./managed-process-map";

/**
 * Facade over the terminal and app registries: the single read/terminate entry
 * point for the unified managed-process model. The renderer (composer bar +
 * terminal panel) talks only to this facade through IPC, so both UIs render one
 * shape and a new process kind is added by merging one more `listX().map(...)`
 * here — never by touching the UIs.
 */

/**
 * The managed processes matching a query, newest last. Gathers the live records
 * from both registries and delegates all filtering/sorting to the pure
 * `selectManagedProcesses`: scope isolation (agent → session, user → workspace)
 * plus the optional `origin` predicate the composer bar uses to show only what
 * the agent is running.
 */
export function listManagedProcesses(query: ManagedProcessQuery): ManagedProcessInfo[] {
  const all: ManagedProcessInfo[] = [
    ...listTerminals().map(terminalToManaged),
    ...listApps().map(appToManaged),
  ];
  return selectManagedProcesses(all, query);
}

/**
 * Terminate a managed process by id, dispatching to the registry that owns it.
 * Returns false when the id is unknown to either registry.
 */
export async function killManagedProcess(id: string): Promise<boolean> {
  if (isAppId(id)) {
    return killApp(id);
  }
  if (listTerminals().some((terminal) => terminal.id === id)) {
    killTerminal(id);
    return true;
  }
  return false;
}
