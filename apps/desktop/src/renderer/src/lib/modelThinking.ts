import type { ThinkingLevel, ThinkingOption } from "../../../shared/contracts";

type ModelThinkingOwner = {
  thinkingLevel: ThinkingLevel;
  thinkingLevels?: readonly ThinkingLevel[];
  thinkingVariant?: string;
  thinkingOptions?: readonly ThinkingOption[];
};

export function modelThinkingOptions(model: ModelThinkingOwner): ThinkingOption[] {
  if (model.thinkingOptions?.length) {
    return [...model.thinkingOptions];
  }
  const levels = model.thinkingLevels?.length ? model.thinkingLevels : [model.thinkingLevel];
  return levels.map((level) => ({
    value: level,
    label: level,
    level,
  }));
}

export function selectedThinkingOption(model: ModelThinkingOwner): ThinkingOption {
  const options = modelThinkingOptions(model);
  return (
    options.find((option) => option.value === model.thinkingVariant) ??
    options.find((option) => option.level === model.thinkingLevel) ??
    options[0] ?? { value: "off", label: "off", level: "off" }
  );
}

export function selectedThinkingLabel(model: ModelThinkingOwner): string {
  return selectedThinkingOption(model).label;
}
