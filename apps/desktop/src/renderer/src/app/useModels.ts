import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentSessionInfo, ModelSettingsState } from "../../../shared/contracts";

export function useModels(
  activeSession: AgentSessionInfo | undefined,
  refreshSessions: () => Promise<void>,
) {
  const [modelSettings, setModelSettings] = useState<ModelSettingsState | null>(null);
  const applyModelSettings = setModelSettings;
  const model = activeSession?.model ?? modelSettings?.defaultModel ?? "";

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
      await window.modus.agent.setModel({
        sessionId: activeSession.id,
        model: nextModel,
      });
      await refreshSessions();
    } else {
      await window.modus.model.setDefault(nextModel);
      await refreshModelSettings();
    }
  }

  async function updateModelThinking(modelId: string, thinkingVariant: string): Promise<void> {
    if (activeSession) {
      await window.modus.agent.setModel({
        sessionId: activeSession.id,
        model: modelId,
        thinkingVariant,
      });
      await refreshSessions();
    } else {
      await window.modus.model.setThinking({ model: modelId, thinkingVariant });
      await window.modus.model.setDefault(modelId);
    }
    await refreshModelSettings();
  }

  const cycleModel = useCallback(
    async (direction: "forward" | "backward"): Promise<void> => {
      await window.modus.agent.cycleModel({
        direction,
        sessionId: activeSession?.id,
      });
      await Promise.all([refreshSessions(), refreshModelSettings()]);
    },
    [activeSession?.id, refreshSessions, refreshModelSettings],
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
