import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentSessionInfo, ModelSettingsState } from "../../../shared/contracts";

export function useModels(
  activeSession: AgentSessionInfo | undefined,
  refreshSessions: () => Promise<void>,
  updateSession: (session: AgentSessionInfo) => void,
) {
  const [modelSettings, setModelSettings] = useState<ModelSettingsState | null>(null);
  const applyModelSettings = setModelSettings;
  const model = activeSession ? (activeSession.model ?? "") : (modelSettings?.defaultModel ?? "");

  const refreshModelSettings = useCallback(async (): Promise<void> => {
    const settings = await window.modus.model.settings();
    applyModelSettings(settings);
  }, []);

  const reloadConfiguration = useCallback(async (): Promise<void> => {
    const state = await window.modus.app.reloadConfiguration();
    applyModelSettings(state);
    await refreshSessions();
    if (state.errors.length) throw new Error(state.errors.join("\n"));
  }, [refreshSessions]);

  useEffect(
    () => window.modus?.model.onCatalogChanged(() => void refreshModelSettings()),
    [refreshModelSettings],
  );

  const models = useMemo(
    () =>
      (modelSettings?.models ?? []).map((entry) => {
        if (entry.id !== activeSession?.model || !activeSession.thinkingLevel) return entry;
        const option = entry.thinkingOptions?.find(
          (option) => option.level === activeSession.thinkingLevel,
        );
        return {
          ...entry,
          thinkingLevel: activeSession.thinkingLevel,
          ...(option ? { thinkingVariant: option.value } : {}),
        };
      }),
    [activeSession?.model, activeSession?.thinkingLevel, modelSettings],
  );

  async function changeDefaultModel(nextModel: string): Promise<void> {
    if (!nextModel) return;
    if (activeSession) {
      const session = await window.modus.agent.setModel({
        sessionId: activeSession.id,
        model: nextModel,
      });
      updateSession(session);
    } else {
      await window.modus.model.setDefault(nextModel);
      await refreshModelSettings();
    }
  }

  async function updateModelThinking(modelId: string, thinkingVariant: string): Promise<void> {
    if (activeSession) {
      const session = await window.modus.agent.setThinking({
        sessionId: activeSession.id,
        thinkingVariant,
      });
      updateSession(session);
    } else {
      await window.modus.model.setThinking({ model: modelId, thinkingVariant });
      await refreshModelSettings();
    }
  }

  const cycleModel = useCallback(
    async (direction: "forward" | "backward"): Promise<void> => {
      await window.modus.agent.cycleModel({
        direction,
        sessionId: activeSession?.id,
      });
      if (!activeSession) await refreshModelSettings();
    },
    [activeSession, refreshModelSettings],
  );

  useEffect(() => {
    function handleModelCycle(event: globalThis.KeyboardEvent): void {
      if (event.ctrlKey && event.key === "/") {
        event.preventDefault();
        void cycleModel(event.shiftKey ? "backward" : "forward");
      }
    }

    window.addEventListener("keydown", handleModelCycle);
    return () => window.removeEventListener("keydown", handleModelCycle);
  }, [cycleModel]);

  return {
    models,
    model,
    modelSettings,
    applyModelSettings,
    reloadConfiguration,
    changeDefaultModel,
    updateModelThinking,
  };
}
