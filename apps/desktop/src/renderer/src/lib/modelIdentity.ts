import type { ModelInfo } from "../../../shared/contracts";
import { selectedThinkingLabel } from "./modelThinking";

/** Look up a model by its authoritative catalog id. No string parsing. */
export function lookupModel(
  models: readonly ModelInfo[] | undefined,
  modelId: string | undefined,
): ModelInfo | undefined {
  if (!modelId || !models?.length) return undefined;
  return models.find((model) => model.id === modelId);
}

/**
 * Product-facing model label: display name + thinking degree when the catalog
 * says the model supports thinking and it isn't Off. Falls back to nothing
 * invented — callers that only have a raw id must decide whether to omit.
 */
export function modelIdentityLabel(model: ModelInfo): string {
  if (!model.supportsThinking) return model.name;
  const thinking = selectedThinkingLabel(model);
  if (!thinking || thinking === "Off") return model.name;
  return `${model.name} ${thinking}`;
}
