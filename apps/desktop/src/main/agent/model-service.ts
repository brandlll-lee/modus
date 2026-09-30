import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Api, getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import {
  ModelRegistry,
  ModelRuntime,
  resolveModelScopeWithDiagnostics,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { shell } from "electron";
import type {
  ModelInfo,
  ModelProviderDetail,
  ModelProviderInfo,
  ModelSettingsState,
  ThinkingLevel,
  ThinkingOption,
} from "../../shared/contracts";
import { modelConfigFiles, prepareModelConfig } from "./agent-config-files";
import { AgentCredentials } from "./agent-credentials";
import { getPiCliAgentDir, modusAgentDir } from "./agent-paths";
import { createAgentSettings } from "./agent-settings";

let initialization: Promise<ModelRuntime> | undefined;
let registry: ModelRegistry | undefined;
let config: ReturnType<typeof prepareModelConfig>;
let credentials: AgentCredentials;
let refreshErrors: string[] = [];

export function getModelRuntime(): Promise<ModelRuntime> {
  initialization ??= (async () => {
    config = prepareModelConfig();
    credentials = new AgentCredentials(getPiCliAgentDir(), modusAgentDir(), () => config.isolated);
    const runtime = await ModelRuntime.create({ credentials, modelsPath: config.path });
    registry = new ModelRegistry(runtime);
    refreshErrors = [];
    return runtime;
  })().catch((error: unknown) => {
    initialization = undefined;
    refreshErrors = [error instanceof Error ? error.message : String(error)];
    throw error;
  });
  return initialization;
}

export async function refreshRemoteModelCatalog(): Promise<ModelSettingsState> {
  const runtime = await getModelRuntime();
  config = prepareModelConfig();
  const result = await runtime.refresh({ allowNetwork: true });
  refreshErrors = [...result.errors].map(([provider, error]) => `${provider}: ${error.message}`);
  if (result.aborted) refreshErrors.push("Model refresh was cancelled.");
  return getModelSettings();
}

export function getModelRegistry(): ModelRegistry {
  if (!registry) throw new Error("Model runtime has not been initialized.");
  return registry;
}

export function modelToId(model: Model<Api>): string {
  return `${model.provider}/${model.id}`;
}

export function findModel(reference: string | undefined): Model<Api> | undefined {
  if (!reference || !registry) return undefined;
  const separator = reference.indexOf("/");
  return separator < 1
    ? undefined
    : getModelRegistry().find(reference.slice(0, separator), reference.slice(separator + 1));
}

function thinkingOptions(model: Model<Api>): ThinkingOption[] {
  return getSupportedThinkingLevels(model).map((level) => {
    const wire = model.thinkingLevelMap?.[level];
    const value = typeof wire === "string" && wire ? wire : level;
    return { value, label: value, level, ...(value !== level ? { wireValue: value } : {}) };
  });
}

export function resolveModelThinking(model: Model<Api>, variant?: string) {
  const options = thinkingOptions(model);
  const settings = createAgentSettings();
  const preferred =
    settings.getModelThinkingLevel(model.provider, model.id) ??
    settings.getDefaultThinkingLevel() ??
    "off";
  const selected = variant
    ? options.find((option) => option.value === variant)
    : (options.find((option) => option.level === preferred) ?? options[0]);
  if (!selected) throw new Error(`Thinking option is not available for ${modelToId(model)}.`);
  return { model, thinkingLevel: selected.level, variant: selected.value };
}

function modelToInfo(model: Model<Api>): ModelInfo {
  const thinking = resolveModelThinking(model);
  const options = thinkingOptions(model);
  return {
    id: modelToId(model),
    provider: model.provider,
    providerName: getModelRegistry().getProviderDisplayName(model.provider),
    name: model.name,
    available: getModelRegistry().hasConfiguredAuth(model),
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    supportsThinking: model.reasoning,
    thinkingLevel: thinking.thinkingLevel,
    thinkingLevels: options.map((option) => option.level),
    thinkingVariant: thinking.variant,
    thinkingOptions: options,
  };
}

export function listModels(): ModelInfo[] {
  if (!registry) return [];
  return getModelRegistry()
    .getAvailable()
    .map(modelToInfo)
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
}

export function getModelInfo(reference: string | undefined): ModelInfo | undefined {
  const model = findModel(reference);
  return model ? modelToInfo(model) : undefined;
}

export function listProviders(): ModelProviderInfo[] {
  if (!initialization) return [];
  const registry = getModelRegistry();
  return [...new Set(registry.getAll().map((model) => model.provider))]
    .map((id) => {
      const models = registry.getAll().filter((model) => model.provider === id);
      const available = models.filter((model) => registry.hasConfiguredAuth(model));
      const status = registry.getProviderAuthStatus(id);
      const source = credentials.source(id) ?? config.sources.get(id);
      return {
        id,
        name: registry.getProviderDisplayName(id),
        configured: status.configured,
        modelCount: models.length,
        availableModelCount: available.length,
        ...(source ? { source } : {}),
        ...(status.source ? { authSource: status.source } : {}),
      };
    })
    .sort((a, b) => Number(b.configured) - Number(a.configured) || a.name.localeCompare(b.name));
}

export function getProviderDetail(provider: string): ModelProviderDetail | undefined {
  const info = listProviders().find((entry) => entry.id === provider);
  return info
    ? {
        ...info,
        models: getModelRegistry()
          .getAll()
          .filter((model) => model.provider === provider)
          .map(modelToInfo),
      }
    : undefined;
}

export function getModelSettings(): ModelSettingsState {
  if (!registry) return { models: [], providers: [], errors: refreshErrors };
  const models = listModels();
  const defaultModel = getDefaultModelId(models);
  const error = getModelRegistry().getError();
  return {
    models,
    providers: listProviders(),
    ...(defaultModel ? { defaultModel } : {}),
    errors: [...refreshErrors, ...(error ? [error] : [])],
  };
}

export async function listScopedModels(settings = createAgentSettings()) {
  const patterns = settings.getEnabledModels();
  if (!patterns?.length) return [];
  const result = await resolveModelScopeWithDiagnostics(patterns, await getModelRuntime());
  if (result.diagnostics.length)
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  return result.scopedModels;
}

export function getDefaultModelId(models = listModels()): string | undefined {
  const settings = createAgentSettings();
  const provider = settings.getDefaultProvider();
  const model = settings.getDefaultModel();
  return provider && model ? `${provider}/${model}` : models[0]?.id;
}

export function getDefaultModel(): Model<Api> | undefined {
  return findModel(getDefaultModelId());
}

export function getModelThinkingLevel(reference: string | undefined): ThinkingLevel {
  return getModelInfo(reference)?.thinkingLevel ?? "off";
}

export function getModelThinkingVariant(reference: string | undefined): string | undefined {
  return getModelInfo(reference)?.thinkingVariant;
}

export function toPiThinkingLevel(level: ThinkingLevel): ThinkingLevel {
  return level;
}

export async function setDefaultModel(reference: string | undefined): Promise<void> {
  const model = findModel(reference);
  if (!model || !getModelRegistry().hasConfiguredAuth(model))
    throw new Error(`Model is not available: ${reference ?? ""}`);
  const settings = SettingsManager.create(modusAgentDir(), modusAgentDir(), {
    projectTrusted: false,
  });
  settings.setDefaultModelAndProvider(model.provider, model.id);
  await settings.flush();
}

export async function setModelThinking(input: {
  model: string;
  thinkingVariant: string;
}): Promise<ModelInfo> {
  const model = findModel(input.model);
  if (!model) throw new Error(`Unknown model: ${input.model}`);
  const thinking = resolveModelThinking(model, input.thinkingVariant);
  const settings = SettingsManager.create(modusAgentDir(), modusAgentDir(), {
    projectTrusted: false,
  });
  settings.setModelThinkingLevel(model.provider, model.id, thinking.thinkingLevel);
  await settings.flush();
  return modelToInfo(model);
}

export async function cycleDefaultModel(
  direction: "forward" | "backward" = "forward",
): Promise<ModelInfo> {
  const scope = await listScopedModels();
  const models = scope.length
    ? scope.flatMap(({ model }) => {
        const info = getModelInfo(modelToId(model));
        return info ? [info] : [];
      })
    : listModels();
  const current = models.findIndex((model) => model.id === getDefaultModelId(models));
  const start = current >= 0 ? current : direction === "forward" ? -1 : 0;
  const next = models[(start + (direction === "forward" ? 1 : -1) + models.length) % models.length];
  if (!next) throw new Error("No authenticated models are available.");
  await setDefaultModel(next.id);
  return next;
}

export async function revealProviderConfig(provider: string): Promise<void> {
  const source = credentials.source(provider) ?? config.sources.get(provider);
  const path =
    source ??
    [
      ...modelConfigFiles(),
      join(modusAgentDir(), "auth.json"),
      join(getPiCliAgentDir(), "auth.json"),
    ].find(existsSync);
  if (!path || !existsSync(path)) throw new Error("No provider configuration file exists.");
  const error = await shell.openPath(dirname(path));
  if (error) throw new Error(error);
}
