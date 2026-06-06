import type { ProviderModelConfig } from "../../../../shared/contracts";

export type ModelGroup = {
  id: string;
  title: string;
  description: string;
  models: ProviderModelConfig[];
};

export function groupProviderModels(models: ProviderModelConfig[]): ModelGroup[] {
  const enabled = models.filter((model) => model.enabled);
  const thinking = models.filter((model) => !model.enabled && model.reasoning);
  const standard = models.filter((model) => !model.enabled && !model.reasoning);

  return [
    {
      id: "enabled",
      title: "Enabled",
      description: "Available in the composer.",
      models: enabled,
    },
    {
      id: "thinking",
      title: "Thinking",
      description: "Supports reasoning controls.",
      models: thinking,
    },
    {
      id: "standard",
      title: "Standard",
      description: "Regular completion models.",
      models: standard,
    },
  ].filter((group) => group.models.length > 0);
}

export function modelResultLabel(count: number): string {
  return `${count} ${count === 1 ? "model" : "models"} shown`;
}
