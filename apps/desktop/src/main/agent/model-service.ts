import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { app } from "electron";
import type { ModelInfo } from "../../shared/contracts";

let defaultModelId: string | undefined;
let registry: ModelRegistry | undefined;

function agentDir(): string {
  const dir = join(app.getPath("userData"), "pi-agent");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getModelRegistry(): ModelRegistry {
  if (!registry) {
    const dir = agentDir();
    const authStorage = AuthStorage.create(join(dir, "auth.json"));
    registry = ModelRegistry.create(authStorage, join(dir, "models.json"));
  }

  return registry;
}

export function modelToId(model: Model<Api>): string {
  return `${model.provider}/${model.id}`;
}

export function modelToInfo(model: Model<Api>, available: boolean): ModelInfo {
  return {
    id: modelToId(model),
    provider: model.provider,
    name: model.name ?? model.id,
    available,
  };
}

export function findModel(modelId: string | undefined): Model<Api> | undefined {
  if (!modelId) {
    return undefined;
  }

  const [provider, ...idParts] = modelId.split("/");
  if (!provider || idParts.length === 0) {
    return undefined;
  }

  return getModelRegistry().find(provider, idParts.join("/"));
}

export function listModels(): ModelInfo[] {
  const modelRegistry = getModelRegistry();
  const availableIds = new Set(modelRegistry.getAvailable().map(modelToId));
  return modelRegistry
    .getAll()
    .map((model) => modelToInfo(model, availableIds.has(modelToId(model))));
}

export function getDefaultModel(): Model<Api> | undefined {
  const modelRegistry = getModelRegistry();
  return findModel(defaultModelId) ?? modelRegistry.getAvailable()[0] ?? modelRegistry.getAll()[0];
}

export function getDefaultModelId(): string | undefined {
  const model = getDefaultModel();
  return model ? modelToId(model) : defaultModelId;
}

export function setDefaultModel(modelId: string): void {
  defaultModelId = modelId;
}

export function cycleDefaultModel(direction: "forward" | "backward" = "forward"): ModelInfo {
  const models = listModels();
  if (models.length === 0) {
    throw new Error("No PI models are available.");
  }

  const currentId = getDefaultModelId();
  const currentIndex = Math.max(
    0,
    models.findIndex((model) => model.id === currentId),
  );
  const offset = direction === "backward" ? -1 : 1;
  const next = models[(currentIndex + offset + models.length) % models.length];
  if (!next) {
    throw new Error("No PI models are available.");
  }

  setDefaultModel(next.id);
  return next;
}
