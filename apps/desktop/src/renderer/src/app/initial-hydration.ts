import type { SecurityState } from "../../../preload/types";
import type {
  AgentSessionInfo,
  ModelSettingsState,
  WorkspaceInfo,
} from "../../../shared/contracts";

export type InitialAppDataSource = {
  app: {
    securityState(): Promise<SecurityState>;
  };
  workspace: {
    list(): Promise<WorkspaceInfo[]>;
  };
  agent: {
    list(): Promise<AgentSessionInfo[]>;
  };
  model: {
    settings(): Promise<ModelSettingsState>;
  };
};

export type InitialAppHydration = {
  securityState: Promise<SecurityState>;
  workspaces: Promise<WorkspaceInfo[]>;
  sessions: Promise<AgentSessionInfo[]>;
  modelSettings: Promise<ModelSettingsState>;
  settled: Promise<void>;
};

/** Starts the independent first-screen reads together without coupling their failures. */
export function beginInitialAppHydration(api: InitialAppDataSource): InitialAppHydration {
  const securityState = api.app.securityState();
  const workspaces = api.workspace.list();
  const sessions = api.agent.list();
  const modelSettings = api.model.settings();
  const pending = [securityState, workspaces, sessions, modelSettings];

  return {
    securityState,
    workspaces,
    sessions,
    modelSettings,
    settled: Promise.allSettled(pending).then(() => undefined),
  };
}
