import type {
  AgentSessionInfo,
  ModelSettingsState,
  WorkspaceInfo,
} from "../../../shared/contracts";

export type InitialAppDataSource = {
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
  workspaces: Promise<WorkspaceInfo[]>;
  sessions: Promise<AgentSessionInfo[]>;
  modelSettings: Promise<ModelSettingsState>;
  settled: Promise<void>;
};

/** Starts the independent first-screen reads together without coupling their failures. */
export function beginInitialAppHydration(api: InitialAppDataSource): InitialAppHydration {
  const workspaces = api.workspace.list();
  const sessions = api.agent.list();
  const modelSettings = api.model.settings();
  const pending = [workspaces, sessions, modelSettings];

  return {
    workspaces,
    sessions,
    modelSettings,
    settled: Promise.allSettled(pending).then(() => undefined),
  };
}
