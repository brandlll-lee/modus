import { useEffect, useRef } from "react";
import type {
  AgentSessionInfo,
  ModelSettingsState,
  WorkspaceInfo,
} from "../../../shared/contracts";
import { beginInitialAppHydration, type InitialAppHydration } from "./initial-hydration";
import { reportRendererStartup } from "./startup-report";

export function useInitialHydration({
  setWorkspaces,
  setActiveWorkspace,
  setAgentSessions,
  applyModelSettings,
}: {
  setWorkspaces(workspaces: WorkspaceInfo[]): void;
  setActiveWorkspace(workspace: WorkspaceInfo | null): void;
  setAgentSessions(sessions: AgentSessionInfo[]): void;
  applyModelSettings(settings: ModelSettingsState): void;
}) {
  const initialHydrationRef = useRef<InitialAppHydration | null>(null);
  useEffect(() => {
    if (!window.modus) return;
    let active = true;
    if (!initialHydrationRef.current) {
      initialHydrationRef.current = beginInitialAppHydration(window.modus);
    }
    const hydration = initialHydrationRef.current;
    const load = <T>(resource: string, result: Promise<T>, apply: (value: T) => void) => {
      void result
        .then((value) => {
          if (active) apply(value);
        })
        .catch((error: unknown) => {
          if (active) console.error(`Unable to load initial ${resource}.`, error);
        });
    };
    load("workspaces", hydration.workspaces, (items) => {
      setWorkspaces(items);
      setActiveWorkspace(items[0] ?? null);
    });
    load("sessions", hydration.sessions, setAgentSessions);
    load("model settings", hydration.modelSettings, applyModelSettings);
    void hydration.settled.then(() => {
      if (active) reportRendererStartup("renderer.initial-hydration-settled");
    });
    return () => {
      active = false;
    };
  }, [setWorkspaces, setActiveWorkspace, setAgentSessions, applyModelSettings]);
}
