import { resolve } from "node:path";
import type { AgentSession, ResourceLoader } from "@earendil-works/pi-coding-agent";
import { isExtensionCommandActive } from "./extension-ui";

export type SessionResources = {
  id: string;
  cwd: string;
  session: AgentSession;
  loader: ResourceLoader;
};

const reloading = new WeakSet<AgentSession>();
const resources = new Map<string, SessionResources>();
const listeners = new Set<(cwd: string) => void>();

export function onSessionResourcesChanged(listener: (cwd: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function changed(cwd: string): void {
  for (const listener of listeners) listener(cwd);
}

export function registerSessionResources(value: SessionResources): void {
  resources.set(value.id, value);
  changed(value.cwd);
}

export function releaseSessionResources(id: string): void {
  const value = resources.get(id);
  resources.delete(id);
  if (value) changed(value.cwd);
}

export function sessionResources(cwd?: string): SessionResources[] {
  return [...resources.values()].filter(
    (value) => cwd === undefined || resolve(value.cwd) === resolve(cwd),
  );
}

export function assertSessionResourcesIdle(cwd: string): void {
  if (
    sessionResources(cwd).some(
      ({ session }) =>
        session.isStreaming || isExtensionCommandActive(session) || reloading.has(session),
    )
  )
    throw new Error("Wait for the agent to finish before refreshing its resources.");
}

export async function reloadSessionResources(cwd: string): Promise<void> {
  assertSessionResourcesIdle(cwd);
  const selected = sessionResources(cwd);
  for (const { session } of selected) reloading.add(session);
  try {
    const results = await Promise.allSettled(
      selected.map(async ({ session }) => {
        await session.reload();
      }),
    );
    const errors = results.filter((result) => result.status === "rejected");
    if (errors.length)
      throw new AggregateError(
        errors.map((result) => result.reason),
        "Failed to refresh agent resources.",
      );
    changed(cwd);
  } finally {
    for (const { session } of selected) reloading.delete(session);
  }
}
