import type { AgentSession, ResourceLoader } from "@earendil-works/pi-coding-agent";
import { getModelRuntime, getModelSettings, refreshRemoteModelCatalog } from "./model-service";
import type { AgentRuntime } from "./runtime";

export type SessionResources = {
  id: string;
  cwd: string;
  session: AgentSession;
  loader: ResourceLoader;
};

let reloading = false;
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

export function sessionResources(): SessionResources[] {
  return [...resources.values()];
}

export function assertConfigurationReady(): void {
  if (reloading) throw new Error("Wait for PI configuration reload to finish.");
}

export async function reloadPiConfiguration(runtime: Pick<AgentRuntime, "assertIdle">) {
  assertConfigurationReady();
  runtime.assertIdle();
  reloading = true;
  const selected = sessionResources();
  const errors: string[] = [];
  try {
    await refreshRemoteModelCatalog();
    for (const { id, session } of selected) {
      try {
        await session.reload();
      } catch (error) {
        errors.push(`${id}: ${String(error)}`);
      }
    }
    const models = await getModelRuntime();
    for (const { id, session } of selected) {
      if (!session.model) continue;
      const model = models.getModel(session.model.provider, session.model.id);
      try {
        if (!model) throw new Error("The selected model is no longer available. Select a model.");
        if (model !== session.model) {
          const thinkingLevel = session.thinkingLevel;
          await session.setModel(model);
          session.setThinkingLevel(thinkingLevel);
        }
      } catch (error) {
        errors.push(`${id}: ${String(error)}`);
      }
    }
    const state = getModelSettings();
    return { ...state, errors: [...state.errors, ...errors] };
  } finally {
    reloading = false;
    for (const cwd of new Set(selected.map((value) => value.cwd))) changed(cwd);
  }
}
