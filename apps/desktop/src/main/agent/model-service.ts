import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type Api,
  getSupportedThinkingLevels,
  type Model,
  type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { app } from "electron";
import bundledCatalogJson from "../../../../../catalog/models.json";
import type {
  ConfigureProviderInput,
  CustomProviderConfig,
  CustomProviderModelInput,
  JsonObject,
  ModelCost,
  ModelInfo,
  ModelInputKind,
  ModelProviderDetail,
  ModelProviderInfo,
  ModelSettingsState,
  ProviderAuthOperationState,
  ProviderConnectionMethod,
  ProviderModelConfig,
  TestCustomProviderInput,
  TestCustomProviderResult,
  ThinkingLevel,
  ThinkingOption,
  UpdateModelConfigInput,
  UpsertCustomProviderInput,
} from "../../shared/contracts";
import { getDatabase } from "../db/database";
import {
  forceModelCatalogRefresh,
  type ModelCatalog,
  parseModelCatalog,
  startModelCatalogUpdates,
} from "./model-catalog-service";

type ModelConfigRow = {
  id: string;
  provider_id: string;
  model_id: string;
  display_name: string;
  source: "builtin" | "custom";
  enabled: number;
  context_window: number | null;
  max_tokens: number | null;
  reasoning: number;
  thinking_level: ThinkingLevel;
  thinking_variant: string | null;
  thinking_level_map_json: string | null;
};

type ProviderConfigRow = {
  provider_id: string;
  display_name: string;
  source: "builtin" | "custom";
  base_url: string | null;
  api: string | null;
  auth_header: number;
  headers_json: string | null;
};

type ProviderConfigInput = Parameters<ModelRegistry["registerProvider"]>[1];
type RegisteredModel = NonNullable<ProviderConfigInput["models"]>[number];

type CustomModelsJson = {
  providers?: Record<string, CustomProviderJson>;
};

type CustomProviderJson = {
  name?: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  authHeader?: boolean;
  headers?: Record<string, string>;
  compat?: JsonObject;
  models?: CustomProviderModelJson[];
};

type CustomProviderModelJson = {
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  reasoning?: boolean;
  input?: ModelInputKind[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  compat?: JsonObject;
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
};

const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const DEFAULT_CUSTOM_API = "openai-completions";
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;
const DEFAULT_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const DEFAULT_MODEL_INPUT: ModelInputKind[] = ["text"];
const DEFAULT_PROVIDER_ORDER = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "zai",
  "xai",
  "groq",
  "mistral",
  "deepseek",
  "cerebras",
  "together",
  "vercel-ai-gateway",
  "github-copilot",
  "amazon-bedrock",
  "cloudflare-workers-ai",
  "cloudflare-ai-gateway",
  "opencode",
  "opencode-go",
];
// OpenAI and Anthropic JS SDKs are both Stainless-generated and stamp every
// request with these fingerprint headers. We blank them (and the SDK User-Agent)
// so custom relay endpoints receive a clean request without the vendor SDK
// fingerprint. @google/genai uses a different pair (User-Agent + x-goog-api-client).
const STAINLESS_CLIENT_HEADER_OVERRIDES: Record<string, string> = {
  "User-Agent": "Modus/0.1.0",
  "X-Stainless-Arch": "",
  "X-Stainless-Lang": "",
  "X-Stainless-OS": "",
  "X-Stainless-Package-Version": "",
  "X-Stainless-Retry-Count": "",
  "X-Stainless-Runtime": "",
  "X-Stainless-Runtime-Version": "",
  "X-Stainless-Timeout": "",
};

const GOOGLE_CLIENT_HEADER_OVERRIDES: Record<string, string> = {
  "User-Agent": "Modus/0.1.0",
  "x-goog-api-client": "",
};

/** Every header key Modus manages for fingerprint stripping (union of all protocols). */
const MANAGED_CLIENT_HEADER_KEYS = new Set<string>([
  ...Object.keys(STAINLESS_CLIENT_HEADER_OVERRIDES),
  ...Object.keys(GOOGLE_CLIENT_HEADER_OVERRIDES),
]);

let registry: ModelRegistry | undefined;
let stopCatalogUpdates: (() => void) | undefined;
let catalogProviders = new Set<string>();
let activeCatalog: ModelCatalog = parseModelCatalog(bundledCatalogJson);
let catalogReasoningCapabilities = new Map<
  string,
  NonNullable<ModelCatalog["providers"][string][number]["reasoningCapability"]>
>();

type ProviderAuthOperation = {
  cancelled: boolean;
  controller: AbortController;
  respond: ((value: string | undefined) => void) | undefined;
  state: ProviderAuthOperationState;
};

const providerAuthOperations = new Map<string, ProviderAuthOperation>();

function agentDir(): string {
  const dir = join(app.getPath("userData"), "pi-agent");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function authPath(): string {
  return join(agentDir(), "auth.json");
}

function modelsPath(): string {
  return join(agentDir(), "models.json");
}

function catalogPath(): string {
  return join(agentDir(), "model-catalog.json");
}

function catalogProviderConfigs(
  modelRegistry: ModelRegistry,
  catalog: ModelCatalog,
): Array<[string, ProviderConfigInput]> {
  const bundledModels = ModelRegistry.inMemory(modelRegistry.authStorage).getAll();
  const bundledProviders = new Set(bundledModels.map((model) => model.provider));
  const supportedApis = new Set(bundledModels.map((model) => model.api));
  const oauthProviders = new Map(
    modelRegistry.authStorage.getOAuthProviders().map(({ id, ...provider }) => [id, provider]),
  );

  return Object.entries(catalog.providers).flatMap(([provider, models]) => {
    const local = getProviderConfig(provider);
    if (!bundledProviders.has(provider) || local?.source === "custom") return [];
    const supported = models.filter((model) => supportedApis.has(model.api));
    const baseUrl = supported.find((model) => model.baseUrl)?.baseUrl;
    if (!baseUrl) return [];
    const oauth = oauthProviders.get(provider);

    return [
      [
        provider,
        {
          baseUrl,
          ...(oauth ? { oauth } : { apiKey: "$MODUS_MODEL_CATALOG_API_KEY" }),
          models: supported.map(
            (model): RegisteredModel => ({
              id: model.id,
              name: model.name,
              api: model.api,
              ...(model.baseUrl ? { baseUrl: local?.base_url ?? model.baseUrl } : {}),
              reasoning: model.reasoning,
              input: model.input,
              cost: {
                input: model.cost.input,
                output: model.cost.output,
                cacheRead: model.cost.cacheRead,
                cacheWrite: model.cost.cacheWrite,
                ...(model.cost.tiers ? { tiers: model.cost.tiers } : {}),
              },
              contextWindow: model.contextWindow,
              maxTokens: model.maxTokens,
              ...(model.thinkingLevelMap
                ? {
                    thinkingLevelMap: model.thinkingLevelMap as RegisteredModel["thinkingLevelMap"],
                  }
                : {}),
              ...(model.headers ? { headers: model.headers } : {}),
              ...(model.compat ? { compat: model.compat as RegisteredModel["compat"] } : {}),
            }),
          ),
          ...(local?.base_url ? { baseUrl: local.base_url } : {}),
          ...(local?.api ? { api: local.api } : {}),
          ...(local?.headers_json
            ? { headers: parseJson<Record<string, string>>(local.headers_json, {}) }
            : {}),
          ...(local ? { authHeader: Boolean(local.auth_header) } : {}),
        },
      ],
    ];
  });
}

function applyModelCatalog(modelRegistry: ModelRegistry, catalog: ModelCatalog): void {
  const providers = catalogProviderConfigs(modelRegistry, catalog);
  const validationRegistry = ModelRegistry.inMemory(modelRegistry.authStorage);
  for (const [provider, config] of providers) validationRegistry.registerProvider(provider, config);
  const nextProviders = new Set(providers.map(([provider]) => provider));
  for (const provider of catalogProviders) {
    if (!nextProviders.has(provider)) modelRegistry.unregisterProvider(provider);
  }
  for (const [provider, config] of providers) modelRegistry.registerProvider(provider, config);
  catalogProviders = nextProviders;
  catalogReasoningCapabilities = new Map(
    Object.entries(catalog.providers).flatMap(([provider, models]) =>
      nextProviders.has(provider)
        ? models.flatMap((model) =>
            model.reasoningCapability
              ? [[modelConfigId(provider, model.id), model.reasoningCapability] as const]
              : [],
          )
        : [],
    ),
  );
  activeCatalog = catalog;
}

export function startRemoteModelCatalog(onChanged: () => void): void {
  if (stopCatalogUpdates) return;
  const modelRegistry = getModelRegistry();
  applyModelCatalog(modelRegistry, activeCatalog);
  stopCatalogUpdates = startModelCatalogUpdates({
    cachePath: catalogPath(),
    onCatalog: (catalog) => {
      applyModelCatalog(modelRegistry, catalog);
      onChanged();
    },
  });
}

export function stopRemoteModelCatalog(): void {
  stopCatalogUpdates?.();
  stopCatalogUpdates = undefined;
}

export async function refreshRemoteModelCatalog(): Promise<ModelSettingsState> {
  await forceModelCatalogRefresh();
  return getModelSettings();
}

export function getModelRegistry(): ModelRegistry {
  if (!registry) {
    migrateCustomProviderRuntimeConfig();
    registry = ModelRegistry.create(AuthStorage.create(authPath()), modelsPath());
  }

  return registry;
}

function refreshRegistry(): ModelRegistry {
  migrateCustomProviderRuntimeConfig();
  const modelRegistry = getModelRegistry();
  modelRegistry.authStorage.reload();
  modelRegistry.refresh();
  applyModelCatalog(modelRegistry, activeCatalog);
  return modelRegistry;
}

export function modelToId(model: Model<Api>): string {
  return `${model.provider}/${model.id}`;
}

function splitModelId(modelId: string | undefined): { provider: string; id: string } | undefined {
  if (!modelId) {
    return undefined;
  }

  const [provider, ...idParts] = modelId.split("/");
  if (!provider || idParts.length === 0) {
    return undefined;
  }

  return { provider, id: idParts.join("/") };
}

export function findModel(modelId: string | undefined): Model<Api> | undefined {
  const parsed = splitModelId(modelId);
  if (!parsed) {
    return undefined;
  }

  return getModelRegistry().find(parsed.provider, parsed.id);
}

function readSetting(key: string): string | undefined {
  const row = getDatabase().prepare("select value from app_settings where key = ?").get(key) as
    | { value: string | null }
    | undefined;
  return row?.value ?? undefined;
}

function writeSetting(key: string, value: string | undefined): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `insert into app_settings (key, value, updated_at)
       values (?, ?, ?)
       on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value ?? null, now);
}

function modelConfigId(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function hasKeys(value: Record<string, unknown> | undefined): value is Record<string, unknown> {
  return Boolean(value && Object.keys(value).length > 0);
}

function mergeJsonObjects(
  base: JsonObject | undefined,
  structured: JsonObject | undefined,
): JsonObject | undefined {
  const merged = { ...(base ?? {}), ...(structured ?? {}) };
  return hasKeys(merged) ? merged : undefined;
}

function providerCompatibilityToJson(input: UpsertCustomProviderInput): JsonObject | undefined {
  return mergeJsonObjects(input.compat, input.compatibility);
}

function modelCompatibilityToJson(input: CustomProviderModelInput): JsonObject | undefined {
  const compatibility = input.compatibility;
  const structured: JsonObject = {
    ...(compatibility?.thinkingFormat && compatibility.thinkingFormat !== "none"
      ? { thinkingFormat: compatibility.thinkingFormat }
      : {}),
    ...(compatibility?.supportsUsageInStreaming !== undefined
      ? { supportsUsageInStreaming: compatibility.supportsUsageInStreaming }
      : {}),
    // Anthropic-protocol switches are persisted only when set, keeping the
    // stored compat JSON free of noise for OpenAI-style endpoints.
    ...(compatibility?.forceAdaptiveThinking ? { forceAdaptiveThinking: true } : {}),
    ...(compatibility?.allowEmptySignature ? { allowEmptySignature: true } : {}),
  };
  return mergeJsonObjects(input.compat, structured);
}

function listModelConfigRows(): ModelConfigRow[] {
  return getDatabase()
    .prepare(
      `select id, provider_id, model_id, display_name, source, enabled, context_window, max_tokens,
        reasoning, thinking_level, thinking_variant, thinking_level_map_json
       from model_configs`,
    )
    .all() as ModelConfigRow[];
}

function getModelConfig(modelId: string): ModelConfigRow | undefined {
  return getDatabase()
    .prepare(
      `select id, provider_id, model_id, display_name, source, enabled, context_window, max_tokens,
        reasoning, thinking_level, thinking_variant, thinking_level_map_json
       from model_configs
       where id = ?`,
    )
    .get(modelId) as ModelConfigRow | undefined;
}

function listProviderConfigRows(): ProviderConfigRow[] {
  return getDatabase()
    .prepare(
      `select provider_id, display_name, source, base_url, api, auth_header, headers_json
       from model_provider_configs`,
    )
    .all() as ProviderConfigRow[];
}

function getProviderConfig(provider: string): ProviderConfigRow | undefined {
  return getDatabase()
    .prepare(
      `select provider_id, display_name, source, base_url, api, auth_header, headers_json
       from model_provider_configs
       where provider_id = ?`,
    )
    .get(provider) as ProviderConfigRow | undefined;
}

function upsertProviderConfig(input: {
  provider: string;
  displayName: string;
  source: "builtin" | "custom";
  baseUrl?: string;
  api?: string;
  authHeader?: boolean;
  headers?: Record<string, string>;
  preserveExisting?: boolean;
}): void {
  const now = new Date().toISOString();
  const existing = input.preserveExisting ? getProviderConfig(input.provider) : undefined;
  getDatabase()
    .prepare(
      `insert into model_provider_configs (
        provider_id, display_name, source, base_url, api, auth_header, headers_json, created_at, updated_at
       )
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(provider_id) do update set
         display_name = excluded.display_name,
         source = excluded.source,
         base_url = excluded.base_url,
         api = excluded.api,
         auth_header = excluded.auth_header,
         headers_json = excluded.headers_json,
         updated_at = excluded.updated_at`,
    )
    .run(
      input.provider,
      input.displayName,
      input.source,
      input.baseUrl ?? existing?.base_url ?? null,
      input.api ?? existing?.api ?? null,
      input.authHeader !== undefined ? (input.authHeader ? 1 : 0) : (existing?.auth_header ?? 0),
      input.headers && Object.keys(input.headers).length > 0
        ? JSON.stringify(input.headers)
        : (existing?.headers_json ?? null),
      now,
      now,
    );
}

function upsertModelConfig(input: {
  provider: string;
  modelId: string;
  displayName: string;
  source: "builtin" | "custom";
  enabled?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  thinkingLevel?: ThinkingLevel;
  thinkingVariant?: string;
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
}): void {
  const now = new Date().toISOString();
  const existing = getModelConfig(modelConfigId(input.provider, input.modelId));
  getDatabase()
    .prepare(
      `insert into model_configs (
        id, provider_id, model_id, display_name, source, enabled, context_window, max_tokens,
        reasoning, thinking_level, thinking_variant, thinking_level_map_json, created_at, updated_at
       )
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(id) do update set
         display_name = excluded.display_name,
         source = excluded.source,
         enabled = excluded.enabled,
         context_window = excluded.context_window,
         max_tokens = excluded.max_tokens,
         reasoning = excluded.reasoning,
         thinking_level = excluded.thinking_level,
         thinking_variant = excluded.thinking_variant,
         thinking_level_map_json = excluded.thinking_level_map_json,
         updated_at = excluded.updated_at`,
    )
    .run(
      modelConfigId(input.provider, input.modelId),
      input.provider,
      input.modelId,
      input.displayName,
      input.source,
      (input.enabled ?? Boolean(existing?.enabled)) ? 1 : 0,
      input.contextWindow ?? existing?.context_window ?? null,
      input.maxTokens ?? existing?.max_tokens ?? null,
      (input.reasoning ?? Boolean(existing?.reasoning)) ? 1 : 0,
      normalizeThinkingLevel(input.thinkingLevel ?? existing?.thinking_level ?? "off"),
      normalizeThinkingVariant(input.thinkingVariant ?? existing?.thinking_variant),
      input.thinkingLevelMap
        ? JSON.stringify(input.thinkingLevelMap)
        : (existing?.thinking_level_map_json ?? null),
      now,
      now,
    );
}

function normalizeThinkingLevel(value: string | undefined): ThinkingLevel {
  return THINKING_LEVELS.includes(value as ThinkingLevel) ? (value as ThinkingLevel) : "off";
}

function normalizeThinkingVariant(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function thinkingLevelMapForModel(
  model: Model<Api> | undefined,
  config: ModelConfigRow | undefined,
): Partial<Record<ThinkingLevel, string | null>> | undefined {
  if (config?.thinking_level_map_json) {
    return normalizeThinkingLevelMap(
      parseJson<Partial<Record<ThinkingLevel, string | null>>>(config.thinking_level_map_json, {}),
    );
  }

  return normalizeThinkingLevelMap(model?.thinkingLevelMap);
}

function catalogReasoningCapabilityForModel(model: Model<Api> | undefined) {
  return model ? catalogReasoningCapabilities.get(modelToId(model)) : undefined;
}

function thinkingOptionsForModel(
  model: Model<Api> | undefined,
  config: ModelConfigRow | undefined,
  levels = thinkingLevelsForModel(model, config),
): ThinkingOption[] {
  const capability = catalogReasoningCapabilityForModel(model);
  if (capability?.type === "options") {
    return capability.options;
  }

  const map = thinkingLevelMapForModel(model, config);
  return levels.map((level) => {
    const mapped = map?.[level];
    const value = typeof mapped === "string" && mapped.trim() ? mapped.trim() : level;
    return {
      value,
      label: value,
      level,
      ...(value !== level ? { wireValue: value } : {}),
    };
  });
}

function thinkingBudgetForModel(model: Model<Api> | undefined) {
  const capability = catalogReasoningCapabilityForModel(model);
  return capability?.type === "budget"
    ? {
        ...(capability.min !== undefined ? { min: capability.min } : {}),
        ...(capability.max !== undefined ? { max: capability.max } : {}),
      }
    : undefined;
}

function budgetThinkingOption(
  value: string | null | undefined,
  budget: { min?: number; max?: number },
): ThinkingOption | undefined {
  if (value === "off") return { value: "off", label: "Off", level: "off" as const };
  const tokens = Number(value);
  if (
    !Number.isSafeInteger(tokens) ||
    tokens < 0 ||
    (budget.min !== undefined && tokens < budget.min) ||
    (budget.max !== undefined && tokens > budget.max)
  ) {
    return undefined;
  }
  return {
    value: String(tokens),
    label: `${tokens.toLocaleString()} tokens`,
    level: "high" as const,
  };
}

function clampThinkingVariant(
  value: string | null | undefined,
  options: ThinkingOption[],
): ThinkingOption {
  const normalized = normalizeThinkingVariant(value);
  return (
    options.find((option) => option.value === normalized) ??
    options.find((option) => option.value === "off") ??
    options[0] ?? { value: "off", label: "off", level: "off" }
  );
}

function selectedThinkingOption(
  variant: string | null | undefined,
  level: ThinkingLevel,
  options: ThinkingOption[],
): ThinkingOption {
  const normalized = normalizeThinkingVariant(variant);
  return (
    options.find((option) => option.value === normalized) ??
    options.find((option) => option.level === level) ??
    clampThinkingVariant(undefined, options)
  );
}

function thinkingLevelsForModel(
  model: Model<Api> | undefined,
  config: ModelConfigRow | undefined,
): ThinkingLevel[] {
  const reasoning = Boolean(config?.reasoning || model?.reasoning || (!model && !config));
  if (!reasoning) {
    return ["off"];
  }

  const capability = catalogReasoningCapabilityForModel(model);
  if (capability?.type === "options") {
    return [...new Set(capability.options.map((option) => option.level))];
  }
  if (capability?.type === "budget") {
    return ["off", "high"];
  }

  const map = thinkingLevelMapForModel(model, config);
  if (map) {
    return THINKING_LEVELS.filter((level) => {
      const mapped = map[level];
      if (mapped === null) return false;
      if (level === "xhigh") return mapped !== undefined;
      return true;
    });
  }

  if (!model) {
    return THINKING_LEVELS;
  }

  return getSupportedThinkingLevels(model).map((level) => level as ThinkingLevel);
}

function clampThinkingLevel(value: ThinkingLevel, levels: ThinkingLevel[]): ThinkingLevel {
  return levels.includes(value) ? value : (levels[0] ?? "off");
}

function thinkingStateForModel(model: Model<Api> | undefined, config: ModelConfigRow | undefined) {
  const levels = thinkingLevelsForModel(model, config);
  const budget = thinkingBudgetForModel(model);
  if (budget) {
    const selected =
      config?.thinking_level === "off"
        ? budgetThinkingOption("off", budget)
        : budgetThinkingOption(config?.thinking_variant, budget);
    return {
      levels,
      options: [{ value: "off", label: "Off", level: "off" as const }],
      budget,
      selected: selected ?? { value: "off", label: "Off", level: "off" as const },
    };
  }
  const options = thinkingOptionsForModel(model, config, levels);
  const selected = selectedThinkingOption(
    config?.thinking_variant,
    clampThinkingLevel(config?.thinking_level ?? "off", levels),
    options,
  );
  return { levels, options, selected, budget: undefined };
}

function modelToInfo(model: Model<Api>, available: boolean, config?: ModelConfigRow): ModelInfo {
  const id = modelToId(model);
  const thinking = thinkingStateForModel(model, config);
  const source = config?.source ?? "builtin";
  const contextWindow = config?.context_window ?? model.contextWindow;
  const maxTokens = config?.max_tokens ?? model.maxTokens;
  return {
    id,
    provider: model.provider,
    providerName: getModelRegistry().getProviderDisplayName(model.provider),
    name: config?.display_name ?? model.name ?? model.id,
    available,
    enabled: Boolean(config?.enabled),
    configured: Boolean(config),
    source,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    supportsThinking: model.reasoning || thinking.levels.some((level) => level !== "off"),
    thinkingLevel: thinking.selected.level,
    thinkingLevels: thinking.levels,
    thinkingVariant: thinking.selected.value,
    thinkingOptions: thinking.options,
    ...(thinking.budget ? { thinkingBudget: thinking.budget } : {}),
  };
}

function configToInfo(config: ModelConfigRow, available: boolean): ModelInfo {
  const thinking = thinkingStateForModel(undefined, config);
  const contextWindow = config.context_window ?? undefined;
  const maxTokens = config.max_tokens ?? undefined;
  return {
    id: config.id,
    provider: config.provider_id,
    providerName: getModelRegistry().getProviderDisplayName(config.provider_id),
    name: config.display_name,
    available,
    enabled: Boolean(config.enabled),
    configured: true,
    source: config.source,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    supportsThinking: Boolean(config.reasoning) || thinking.levels.some((level) => level !== "off"),
    thinkingLevel: thinking.selected.level,
    thinkingLevels: thinking.levels,
    thinkingVariant: thinking.selected.value,
    thinkingOptions: thinking.options,
    ...(thinking.budget ? { thinkingBudget: thinking.budget } : {}),
  };
}

function listModelsFromRegistry(modelRegistry: ModelRegistry): ModelInfo[] {
  const configs = new Map(listModelConfigRows().map((row) => [row.id, row]));
  const availableIds = new Set(modelRegistry.getAvailable().map(modelToId));
  const allModels = new Map(modelRegistry.getAll().map((model) => [modelToId(model), model]));
  const configuredInfos = [...configs.values()]
    .map((config) => {
      const model = allModels.get(config.id);
      return model
        ? modelToInfo(model, availableIds.has(config.id), config)
        : configToInfo(config, Boolean(config.enabled));
    })
    .filter((model) => model.enabled && model.available);

  configuredInfos.sort((a, b) => {
    const providerOrder =
      providerSortIndex(a.provider) - providerSortIndex(b.provider) ||
      (a.providerName ?? a.provider).localeCompare(b.providerName ?? b.provider);
    return providerOrder || a.name.localeCompare(b.name);
  });

  return configuredInfos;
}

export function listModels(): ModelInfo[] {
  return listModelsFromRegistry(refreshRegistry());
}

export function listAllProviderModels(provider: string): ProviderModelConfig[] {
  const modelRegistry = refreshRegistry();
  const configs = new Map(listModelConfigRows().map((row) => [row.id, row]));
  const models = modelRegistry.getAll().filter((model) => model.provider === provider);
  const items = new Map<string, ProviderModelConfig>();

  for (const model of models) {
    const id = modelToId(model);
    const config = configs.get(id);
    const thinking = thinkingStateForModel(model, config);
    const contextWindow = config?.context_window ?? model.contextWindow;
    const maxTokens = config?.max_tokens ?? model.maxTokens;
    items.set(model.id, {
      id: model.id,
      name: config?.display_name ?? model.name ?? model.id,
      enabled: Boolean(config?.enabled),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      reasoning: config?.reasoning ? true : Boolean(model.reasoning),
      thinkingLevel: thinking.selected.level,
      thinkingLevels: thinking.levels,
      thinkingVariant: thinking.selected.value,
      thinkingOptions: thinking.options,
      ...(thinking.budget ? { thinkingBudget: thinking.budget } : {}),
    });
  }

  for (const config of configs.values()) {
    if (config.provider_id !== provider || items.has(config.model_id)) {
      continue;
    }
    const thinking = thinkingStateForModel(undefined, config);
    const contextWindow = config.context_window ?? undefined;
    const maxTokens = config.max_tokens ?? undefined;
    items.set(config.model_id, {
      id: config.model_id,
      name: config.display_name,
      enabled: Boolean(config.enabled),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      reasoning: Boolean(config.reasoning),
      thinkingLevel: thinking.selected.level,
      thinkingLevels: thinking.levels,
      thinkingVariant: thinking.selected.value,
      thinkingOptions: thinking.options,
      ...(thinking.budget ? { thinkingBudget: thinking.budget } : {}),
    });
  }

  return [...items.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function providerSortIndex(provider: string): number {
  const index = DEFAULT_PROVIDER_ORDER.indexOf(provider);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function listProvidersFromRegistry(modelRegistry: ModelRegistry): ModelProviderInfo[] {
  const providerConfigs = new Map(listProviderConfigRows().map((row) => [row.provider_id, row]));
  const modelConfigs = listModelConfigRows();
  const providerIds = new Set<string>();
  for (const model of modelRegistry.getAll()) {
    providerIds.add(model.provider);
  }
  for (const config of providerConfigs.keys()) {
    providerIds.add(config);
  }

  const providers = [...providerIds].map((provider) => {
    const row = providerConfigs.get(provider);
    const providerModels = modelRegistry.getAll().filter((model) => model.provider === provider);
    const configuredModels = modelConfigs.filter((config) => config.provider_id === provider);
    const authStatus = modelRegistry.getProviderAuthStatus(provider);
    const credential =
      authStatus.source === "stored" ? modelRegistry.authStorage.get(provider) : undefined;
    const authKind =
      credential?.type === "oauth"
        ? "oauth"
        : credential?.type === "api_key"
          ? "api-key"
          : undefined;
    const oauthProvider =
      authKind === "oauth"
        ? modelRegistry.authStorage.getOAuthProviders().find((item) => item.id === provider)
        : undefined;
    const authLabel =
      authStatus.label ??
      (authKind === "oauth"
        ? (oauthProvider?.name ?? "OAuth")
        : authKind === "api-key"
          ? "API key"
          : undefined);
    const configured =
      authStatus.configured || (row?.source === "custom" && configuredModels.length > 0);
    const enabledModelCount = configured
      ? configuredModels.filter((config) => config.enabled).length
      : 0;
    const loadError = modelRegistry.getError();
    const info: ModelProviderInfo = {
      id: provider,
      name: row?.display_name ?? modelRegistry.getProviderDisplayName(provider),
      source: row?.source ?? "builtin",
      configured,
      modelCount: providerModels.length || configuredModels.length,
      enabledModelCount,
      ...(row?.base_url ? { baseUrl: row.base_url } : {}),
      ...(row?.api ? { api: row.api } : {}),
      ...(authStatus.source ? { authSource: authStatus.source } : {}),
      ...(authKind ? { authKind } : {}),
      ...(authLabel ? { authLabel } : {}),
      ...(loadError ? { error: loadError } : {}),
    };
    return info;
  });

  providers.sort((a, b) => {
    const configuredDelta = Number(b.configured) - Number(a.configured);
    if (configuredDelta !== 0) return configuredDelta;
    const orderDelta = providerSortIndex(a.id) - providerSortIndex(b.id);
    if (orderDelta !== 0) return orderDelta;
    return a.name.localeCompare(b.name);
  });

  return providers;
}

export function listProviders(): ModelProviderInfo[] {
  return listProvidersFromRegistry(refreshRegistry());
}

export function getProviderDetail(provider: string): ModelProviderDetail | undefined {
  const item = listProviders().find((candidate) => candidate.id === provider);
  if (!item) {
    return undefined;
  }
  return { ...item, models: listAllProviderModels(provider) };
}

export function getModelSettings(): ModelSettingsState {
  const modelRegistry = refreshRegistry();
  const models = listModelsFromRegistry(modelRegistry);
  const defaultModel = getDefaultModelId(models);
  return {
    providers: listProvidersFromRegistry(modelRegistry),
    models,
    ...(defaultModel ? { defaultModel } : {}),
  };
}

export function listProviderConnectionMethods(provider: string): ProviderConnectionMethod[] {
  const id = provider.trim();
  const modelRegistry = refreshRegistry();
  const config = getProviderConfig(id);
  const known = modelRegistry.getAll().some((model) => model.provider === id);
  if (!id || (!known && !config)) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  if (config?.source === "custom") {
    return [];
  }

  const oauth = modelRegistry.authStorage.getOAuthProviders().find((item) => item.id === id);
  return [
    { kind: "api-key", label: "API key" },
    ...(oauth ? [{ kind: "oauth" as const, label: oauth.name }] : []),
  ];
}

function findProviderAuthOperation(operationId: string): ProviderAuthOperation {
  const operation = providerAuthOperations.get(operationId);
  if (!operation) {
    throw new Error("Provider sign-in is no longer active.");
  }
  return operation;
}

function updateProviderAuthOperation(
  operation: ProviderAuthOperation,
  patch: Omit<Partial<ProviderAuthOperationState>, "id" | "provider">,
): void {
  operation.state = { ...operation.state, ...patch };
}

function waitForProviderAuthInput(
  operation: ProviderAuthOperation,
  state: Omit<ProviderAuthOperationState, "id" | "provider">,
): Promise<string | undefined> {
  if (operation.cancelled) {
    return Promise.resolve(undefined);
  }
  updateProviderAuthOperation(operation, state);
  return new Promise((resolve) => {
    operation.respond = resolve;
  });
}

export function startProviderAuth(
  provider: string,
  openExternal: (url: string) => Promise<void>,
): ProviderAuthOperationState {
  const id = provider.trim();
  const modelRegistry = refreshRegistry();
  if (!id || !modelRegistry.authStorage.getOAuthProviders().some((item) => item.id === id)) {
    throw new Error(`No native sign-in is available for ${provider}.`);
  }
  if (
    [...providerAuthOperations.values()].some(
      (operation) =>
        operation.state.provider === id &&
        !operation.cancelled &&
        !["complete", "error", "cancelled"].includes(operation.state.status),
    )
  ) {
    throw new Error(`A sign-in is already in progress for ${id}.`);
  }

  const operation: ProviderAuthOperation = {
    cancelled: false,
    controller: new AbortController(),
    respond: undefined,
    state: {
      id: crypto.randomUUID(),
      provider: id,
      status: "pending",
      message: "Preparing sign-in…",
    },
  };
  providerAuthOperations.set(operation.state.id, operation);

  void modelRegistry.authStorage
    .login(id, {
      signal: operation.controller.signal,
      onAuth: (info) => {
        if (operation.cancelled) {
          return;
        }
        updateProviderAuthOperation(operation, {
          status: "browser",
          url: info.url,
          instructions: info.instructions,
          message: "Continue sign-in in your browser.",
        });
        void openExternal(info.url).catch(() => {
          updateProviderAuthOperation(operation, {
            message: "Browser could not be opened. Copy the link below to continue.",
          });
        });
      },
      onDeviceCode: (info) => {
        if (operation.cancelled) {
          return;
        }
        updateProviderAuthOperation(operation, {
          status: "device-code",
          url: info.verificationUri,
          userCode: info.userCode,
          message: "Enter this code in your browser to continue.",
        });
        void openExternal(info.verificationUri).catch(() => {
          updateProviderAuthOperation(operation, {
            message: "Browser could not be opened. Copy the link below to continue.",
          });
        });
      },
      onPrompt: async (prompt) => {
        const value = await waitForProviderAuthInput(operation, {
          status: "prompt",
          message: prompt.message,
          placeholder: prompt.placeholder,
          allowEmpty: prompt.allowEmpty,
          options: undefined,
          url: undefined,
          userCode: undefined,
        });
        if (operation.cancelled) {
          throw new Error("Sign-in cancelled.");
        }
        if (!value && !prompt.allowEmpty) {
          throw new Error("A value is required to continue sign-in.");
        }
        return value ?? "";
      },
      onManualCodeInput: async () => {
        const value = await waitForProviderAuthInput(operation, {
          status: "manual-code",
          message: "Paste the authorization code or complete redirect URL.",
          placeholder: "Authorization code or redirect URL",
          allowEmpty: false,
          options: undefined,
        });
        if (operation.cancelled || !value) {
          throw new Error("Sign-in cancelled.");
        }
        return value;
      },
      onProgress: (message) => {
        if (!operation.cancelled) {
          updateProviderAuthOperation(operation, { message });
        }
      },
      onSelect: async (prompt) => {
        const value = await waitForProviderAuthInput(operation, {
          status: "select",
          message: prompt.message,
          options: prompt.options,
          url: undefined,
          userCode: undefined,
        });
        return operation.cancelled ? undefined : value;
      },
    })
    .then(async () => {
      if (operation.cancelled) {
        return;
      }
      await configureProvider({ provider: id, baseUrl: "" });
      if (!operation.cancelled) {
        updateProviderAuthOperation(operation, { status: "complete", message: "Connected." });
      }
    })
    .catch((error: unknown) => {
      if (operation.cancelled || operation.controller.signal.aborted) {
        updateProviderAuthOperation(operation, {
          status: "cancelled",
          message: "Sign-in cancelled.",
        });
        return;
      }
      updateProviderAuthOperation(operation, {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    });

  return operation.state;
}

export function getProviderAuthState(operationId: string): ProviderAuthOperationState {
  const operation = findProviderAuthOperation(operationId);
  const state = { ...operation.state };
  if (["complete", "error", "cancelled"].includes(state.status)) {
    providerAuthOperations.delete(state.id);
  }
  return state;
}

export function respondProviderAuth(operationId: string, value: string | undefined): void {
  const operation = findProviderAuthOperation(operationId);
  const respond = operation.respond;
  if (!respond) {
    throw new Error("Provider sign-in is not waiting for input.");
  }
  operation.respond = undefined;
  updateProviderAuthOperation(operation, {
    status: "pending",
    message: "Continuing sign-in…",
    options: undefined,
    placeholder: undefined,
    allowEmpty: undefined,
  });
  respond(value);
}

export function cancelProviderAuth(operationId: string): void {
  const operation = findProviderAuthOperation(operationId);
  operation.cancelled = true;
  operation.controller.abort();
  operation.respond?.(undefined);
  operation.respond = undefined;
  updateProviderAuthOperation(operation, { status: "cancelled", message: "Sign-in cancelled." });
  providerAuthOperations.delete(operationId);
}

/** The wire protocol of a built-in provider, read from its first bundled model. */
function builtinProviderApi(provider: string, modelRegistry: ModelRegistry): string | undefined {
  return modelRegistry.getAll().find((model) => model.provider === provider)?.api;
}

/**
 * Normalize a base-URL input into the override target: `undefined` (absent — do
 * not touch), `""` (explicit clear — revert to official), or a validated http(s)
 * URL (override). Throws on a non-empty value that isn't an http(s) URL.
 */
function resolveBaseUrlOverride(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (!/^https?:\/\//.test(trimmed)) {
    throw new Error("Provider base URL must start with http:// or https://.");
  }
  return trimmed;
}

export async function configureProvider(
  input: ConfigureProviderInput,
): Promise<ModelProviderDetail> {
  const provider = input.provider.trim();
  if (!provider) {
    throw new Error("Provider is required.");
  }
  const modelRegistry = refreshRegistry();
  const providerName = modelRegistry.getProviderDisplayName(provider);

  // Optional custom base URL for a built-in provider. Reuses pi's native
  // "override-only" provider entry in models.json (baseUrl/headers, no models):
  // every built-in model is kept but its endpoint is rewritten to the relay,
  // while auth still flows through AuthStorage. `undefined` leaves the current
  // setting untouched; "" reverts to the official endpoint; a URL sets it.
  const protocolApi = builtinProviderApi(provider, modelRegistry);
  const baseUrlOverride = resolveBaseUrlOverride(input.baseUrl);
  const runtimeHeaders = baseUrlOverride
    ? applyClientHeaderOverrides(protocolApi, undefined)
    : undefined;

  upsertProviderConfig({
    provider,
    displayName: providerName,
    source: "builtin",
    ...(input.baseUrl === undefined
      ? { preserveExisting: true }
      : baseUrlOverride
        ? { baseUrl: baseUrlOverride, ...(protocolApi ? { api: protocolApi } : {}) }
        : {}),
  });

  if (input.baseUrl !== undefined) {
    setProviderRuntimeConfig(
      provider,
      baseUrlOverride
        ? {
            ...(protocolApi ? { api: protocolApi } : {}),
            baseUrl: baseUrlOverride,
            ...(runtimeHeaders ? { headers: runtimeHeaders } : {}),
          }
        : undefined,
    );
  }

  if (input.apiKey?.trim()) {
    modelRegistry.authStorage.set(provider, { type: "api_key", key: input.apiKey.trim() });
  }

  const selected = new Set(input.enabledModelIds ?? []);
  const models = modelRegistry.getAll().filter((model) => model.provider === provider);
  const fallbackModels =
    selected.size > 0
      ? models
      : modelRegistry.getAvailable().filter((model) => model.provider === provider);
  const enabledIds =
    selected.size > 0 ? selected : new Set(fallbackModels.map((model) => model.id));

  for (const model of models) {
    upsertModelConfig({
      provider,
      modelId: model.id,
      displayName: model.name ?? model.id,
      source: "builtin",
      enabled: enabledIds.has(model.id),
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      reasoning: Boolean(model.reasoning),
      thinkingLevel: "off",
    });
  }

  refreshRegistry();
  return (
    getProviderDetail(provider) ?? {
      id: provider,
      name: providerName,
      source: "builtin",
      configured: true,
      modelCount: 0,
      enabledModelCount: 0,
      models: [],
    }
  );
}

export async function upsertCustomProvider(
  input: UpsertCustomProviderInput,
): Promise<ModelProviderDetail> {
  const provider = sanitizeProviderId(input.provider);
  const name = input.name.trim();
  const baseUrl = input.baseUrl.trim();
  if (!provider) throw new Error("Provider id is required.");
  if (!name) throw new Error("Provider name is required.");
  if (!/^https?:\/\//.test(baseUrl))
    throw new Error("Provider base URL must start with http:// or https://.");
  if (input.models.length === 0) throw new Error("At least one model is required.");

  const headers = sanitizeHeaders(input.headers);
  const providerCompat = providerCompatibilityToJson(input);
  const api = input.api?.trim() || DEFAULT_CUSTOM_API;
  const runtimeHeaders = applyClientHeaderOverrides(api, headers);
  upsertProviderConfig({
    provider,
    displayName: name,
    source: "custom",
    baseUrl,
    api,
    ...(input.authHeader !== undefined ? { authHeader: input.authHeader } : {}),
    ...(headers ? { headers } : {}),
  });
  if (input.apiKey?.trim()) {
    getModelRegistry().authStorage.set(provider, { type: "api_key", key: input.apiKey.trim() });
  }

  const models = input.models.map(normalizeCustomModelInput);
  for (const model of models) {
    upsertModelConfig({
      provider,
      modelId: model.id,
      displayName: model.name ?? model.id,
      source: "custom",
      enabled: true,
      contextWindow: model.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens: model.maxTokens ?? DEFAULT_MAX_TOKENS,
      reasoning: model.reasoning ?? false,
      ...(model.thinkingLevelMap ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
      thinkingLevel: "off",
    });
  }

  const jsonConfig: CustomProviderJson = {
    name,
    baseUrl,
    api,
    apiKey: customProviderApiKeyReference(provider),
    models: models.map((model) => {
      const compat = modelCompatibilityToJson(model);
      return {
        id: model.id,
        name: model.name ?? model.id,
        ...(model.api ? { api: model.api } : {}),
        ...(model.baseUrl ? { baseUrl: model.baseUrl } : {}),
        ...(model.headers && Object.keys(model.headers).length > 0
          ? { headers: model.headers }
          : {}),
        reasoning: model.reasoning ?? false,
        input: normalizeModelInputKinds(model.input),
        contextWindow: model.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
        maxTokens: model.maxTokens ?? DEFAULT_MAX_TOKENS,
        cost: normalizeCost(model.cost),
        ...(compat ? { compat } : {}),
        ...(model.thinkingLevelMap ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
      };
    }),
  };
  if (input.authHeader !== undefined) jsonConfig.authHeader = input.authHeader;
  if (runtimeHeaders) jsonConfig.headers = runtimeHeaders;
  if (providerCompat) jsonConfig.compat = providerCompat;
  writeCustomModelsJson(provider, jsonConfig);
  refreshRegistry();
  return (
    getProviderDetail(provider) ?? {
      id: provider,
      name,
      source: "custom",
      configured: true,
      modelCount: models.length,
      enabledModelCount: models.length,
      baseUrl,
      api,
      models: [],
    }
  );
}

function sanitizeProviderId(value: string): string {
  const provider = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-_]*$/.test(provider)) {
    throw new Error("Provider id must use lowercase letters, numbers, dashes, or underscores.");
  }
  return provider;
}

function sanitizeHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  const result = Object.fromEntries(
    Object.entries(headers)
      .map(([key, value]) => [key.trim(), value.trim()])
      .filter(([key, value]) => key && value),
  );
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Fingerprint-header overrides for a custom provider protocol, or undefined when none apply. */
function clientHeaderOverridesFor(api: string | undefined): Record<string, string> | undefined {
  switch (api) {
    case "openai-completions":
    case "openai-responses":
    case "anthropic-messages":
      return STAINLESS_CLIENT_HEADER_OVERRIDES;
    case "google-generative-ai":
      return GOOGLE_CLIENT_HEADER_OVERRIDES;
    default:
      return undefined;
  }
}

/**
 * Strips the vendor SDK fingerprint for a custom provider by blanking the headers
 * the official client (openai / @anthropic-ai/sdk / @google/genai) would stamp on
 * every request, while preserving any user-supplied headers.
 */
function applyClientHeaderOverrides(
  api: string | undefined,
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const overrides = clientHeaderOverridesFor(api);
  if (!overrides) {
    return headers;
  }
  return { ...overrides, ...(headers ?? {}) };
}

function normalizeCustomModelInput(input: CustomProviderModelInput): CustomProviderModelInput {
  const id = input.id.trim();
  if (!id) {
    throw new Error("Model id is required.");
  }
  const name = input.name?.trim() || id;
  const api = input.api?.trim();
  const baseUrl = input.baseUrl?.trim();
  const headers = sanitizeHeaders(input.headers);
  const thinkingLevelMap = normalizeThinkingLevelMap(input.thinkingLevelMap);
  return {
    ...input,
    id,
    name,
    ...(api ? { api } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(headers ? { headers } : {}),
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    contextWindow: input.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
    input: normalizeModelInputKinds(input.input),
    cost: normalizeCost(input.cost),
  };
}

function normalizeThinkingLevelMap(
  input: Partial<Record<ThinkingLevel, string | null>> | undefined,
): Partial<Record<ThinkingLevel, string | null>> | undefined {
  if (!input) {
    return undefined;
  }

  const next: Partial<Record<ThinkingLevel, string | null>> = {};
  for (const level of THINKING_LEVELS) {
    const value = input[level];
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      next[level] = null;
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      next[level] = trimmed;
    }
  }

  const shouldMigrateLegacyMinimalDefault = next.off === null && next.minimal === "minimal";
  if (shouldMigrateLegacyMinimalDefault) {
    delete next.off;
    next.minimal = null;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeModelInputKinds(input: ModelInputKind[] | undefined): ModelInputKind[] {
  const values = new Set<ModelInputKind>(input?.length ? input : DEFAULT_MODEL_INPUT);
  values.add("text");
  return [...values].filter((kind) => kind === "text" || kind === "image");
}

function normalizeCost(cost: ModelCost | undefined): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
} {
  return {
    input: sanitizeNonNegativeNumber(cost?.input) ?? DEFAULT_COST.input,
    output: sanitizeNonNegativeNumber(cost?.output) ?? DEFAULT_COST.output,
    cacheRead: sanitizeNonNegativeNumber(cost?.cacheRead) ?? DEFAULT_COST.cacheRead,
    cacheWrite: sanitizeNonNegativeNumber(cost?.cacheWrite) ?? DEFAULT_COST.cacheWrite,
  };
}

function sanitizeNonNegativeNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readCustomModelsJson(): CustomModelsJson {
  const path = modelsPath();
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as CustomModelsJson;
  } catch {
    return { providers: {} };
  }
}

function writeCustomModelsJson(provider: string, config: CustomProviderJson): void {
  setProviderRuntimeConfig(provider, config);
}

/**
 * Upsert (or, with `undefined`, remove) a provider's entry in the runtime
 * `models.json` that pi's ModelRegistry reads. This is the single write path for
 * both full custom-provider configs and override-only built-in entries.
 */
function setProviderRuntimeConfig(provider: string, config: CustomProviderJson | undefined): void {
  const path = modelsPath();
  mkdirSync(dirname(path), { recursive: true });
  const data = readCustomModelsJson();
  data.providers = data.providers ?? {};
  if (config) {
    data.providers[provider] = config;
  } else {
    delete data.providers[provider];
  }
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function migrateCustomProviderRuntimeConfig(): void {
  const path = modelsPath();
  const data = readCustomModelsJson();
  if (!data.providers) {
    return;
  }

  let changed = false;
  for (const provider of Object.values(data.providers)) {
    const headers = applyClientHeaderOverrides(
      providerProtocol(provider),
      sanitizeHeaders(provider.headers),
    );
    const previousHeaders = JSON.stringify(provider.headers);
    const nextHeaders = JSON.stringify(headers);
    if (headers && previousHeaders !== nextHeaders) {
      provider.headers = headers;
      changed = true;
    }

    for (const model of provider.models ?? []) {
      const thinkingLevelMap = normalizeThinkingLevelMap(model.thinkingLevelMap);
      if (!thinkingLevelMap) {
        if (model.thinkingLevelMap !== undefined) {
          delete model.thinkingLevelMap;
          changed = true;
        }
        continue;
      }
      const previous = JSON.stringify(model.thinkingLevelMap);
      const next = JSON.stringify(thinkingLevelMap);
      if (previous !== next) {
        model.thinkingLevelMap = thinkingLevelMap;
        changed = true;
      }
    }
  }

  if (changed) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  }
}

/**
 * The wire protocol a stored custom provider uses: explicit provider-level api,
 * else the first model-level api override, else the OpenAI-completions default.
 */
function providerProtocol(provider: CustomProviderJson): string {
  return provider.api ?? provider.models?.find((model) => model.api)?.api ?? DEFAULT_CUSTOM_API;
}

function customProviderApiKeyReference(provider: string): string {
  return `$MODUS_${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}

function stripClientHeaderOverrides(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  const result = Object.fromEntries(
    Object.entries(headers).filter(([key]) => !MANAGED_CLIENT_HEADER_KEYS.has(key)),
  );
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Returns a custom provider's full stored config so the UI can edit it (add/edit
 * models, change endpoint) and re-save losslessly via upsertCustomProvider. The
 * stored api-key reference is intentionally omitted; leaving the key blank on
 * re-save preserves the existing stored credential.
 */
export function getCustomProviderConfig(provider: string): CustomProviderConfig | undefined {
  const stored = readCustomModelsJson().providers?.[provider];
  if (!stored) {
    return undefined;
  }
  const providerHeaders = stripClientHeaderOverrides(stored.headers);
  return {
    provider,
    name: stored.name ?? provider,
    baseUrl: stored.baseUrl ?? "",
    api: stored.api ?? DEFAULT_CUSTOM_API,
    authHeader: stored.authHeader ?? true,
    ...(providerHeaders ? { headers: providerHeaders } : {}),
    ...(stored.compat ? { compat: stored.compat } : {}),
    models: (stored.models ?? []).map((model) => {
      const modelHeaders = stripClientHeaderOverrides(model.headers);
      return {
        id: model.id,
        name: model.name ?? model.id,
        ...(model.api ? { api: model.api } : {}),
        ...(model.baseUrl ? { baseUrl: model.baseUrl } : {}),
        ...(modelHeaders ? { headers: modelHeaders } : {}),
        reasoning: Boolean(model.reasoning),
        input: normalizeModelInputKinds(model.input),
        ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
        ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
        ...(model.cost ? { cost: model.cost } : {}),
        ...(model.compat ? { compat: model.compat } : {}),
        ...(model.thinkingLevelMap ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
      };
    }),
  };
}

function removeCustomModelsJson(provider: string): void {
  const path = modelsPath();
  const data = readCustomModelsJson();
  if (!data.providers || !(provider in data.providers)) {
    return;
  }
  delete data.providers[provider];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function clearProviderConnectionState(provider: string, modelRegistry: ModelRegistry): void {
  modelRegistry.authStorage.remove(provider);
  const db = getDatabase();
  db.prepare("delete from model_configs where provider_id = ?").run(provider);

  const currentDefault = readSetting("model.default");
  if (currentDefault?.startsWith(`${provider}/`)) {
    writeSetting("model.default", undefined);
  }
}

export function disconnectProvider(provider: string): void {
  const id = provider.trim();
  const modelRegistry = refreshRegistry();
  const authStatus = modelRegistry.getProviderAuthStatus(id);
  if (authStatus.source !== "stored") {
    throw new Error("This provider is managed outside Modus and cannot be disconnected here.");
  }

  const config = getProviderConfig(id);
  if (!config && !modelRegistry.getAll().some((model) => model.provider === id)) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  clearProviderConnectionState(id, modelRegistry);
  if (config?.source !== "custom") {
    getDatabase().prepare("delete from model_provider_configs where provider_id = ?").run(id);
    setProviderRuntimeConfig(id, undefined);
  }
  refreshRegistry();
}

/**
 * Fully removes a custom provider from local state: the models.json entry, both
 * DB config tables, the stored API key, and the default-model pointer if it
 * referenced this provider. Refuses to touch built-in providers.
 */
export function deleteCustomProvider(provider: string): void {
  const id = provider.trim();
  const config = getProviderConfig(id);
  const stored = readCustomModelsJson().providers?.[id];
  if (config?.source !== "custom" && !stored) {
    throw new Error(`Only custom providers can be removed: ${provider}`);
  }

  clearProviderConnectionState(id, refreshRegistry());
  removeCustomModelsJson(id);
  getDatabase().prepare("delete from model_provider_configs where provider_id = ?").run(id);

  refreshRegistry();
}

export function updateModelConfig(input: UpdateModelConfigInput): ModelInfo {
  const parsed = splitModelId(input.model);
  if (!parsed) {
    throw new Error(`Invalid model id: ${input.model}`);
  }

  const model = findModel(input.model);
  const existing = getModelConfig(input.model);
  if (!model && !existing) {
    throw new Error(`Unknown model: ${input.model}`);
  }

  const thinking = thinkingStateForModel(model, existing);
  const selected =
    input.thinkingVariant !== undefined
      ? thinking.budget
        ? (budgetThinkingOption(input.thinkingVariant, thinking.budget) ?? thinking.selected)
        : clampThinkingVariant(input.thinkingVariant, thinking.options)
      : input.thinkingLevel
        ? selectedThinkingOption(undefined, input.thinkingLevel, thinking.options)
        : thinking.selected;
  const providerConfig = getProviderConfig(parsed.provider);
  upsertProviderConfig({
    provider: parsed.provider,
    displayName:
      providerConfig?.display_name ?? getModelRegistry().getProviderDisplayName(parsed.provider),
    source: providerConfig?.source ?? existing?.source ?? "builtin",
    preserveExisting: true,
  });
  const nextConfig: Parameters<typeof upsertModelConfig>[0] = {
    provider: parsed.provider,
    modelId: parsed.id,
    displayName: existing?.display_name ?? model?.name ?? parsed.id,
    source: existing?.source ?? "builtin",
    enabled: input.enabled ?? Boolean(existing?.enabled),
    reasoning: Boolean(existing?.reasoning ?? model?.reasoning),
    thinkingLevel: selected.level,
    thinkingVariant: selected.value,
  };
  const contextWindow = input.contextWindow ?? existing?.context_window ?? model?.contextWindow;
  const maxTokens = input.maxTokens ?? existing?.max_tokens ?? model?.maxTokens;
  if (contextWindow !== undefined) nextConfig.contextWindow = contextWindow;
  if (maxTokens !== undefined) nextConfig.maxTokens = maxTokens;
  upsertModelConfig(nextConfig);

  const updated = getModelConfig(input.model);
  if (!updated) {
    throw new Error(`Unable to update model: ${input.model}`);
  }
  const available = model ? getModelRegistry().hasConfiguredAuth(model) : Boolean(updated.enabled);
  return model ? modelToInfo(model, available, updated) : configToInfo(updated, available);
}

export function getModelInfo(modelId: string | undefined): ModelInfo | undefined {
  const parsed = splitModelId(modelId);
  if (!parsed) {
    return undefined;
  }
  const model = findModel(modelId);
  const config = getModelConfig(modelConfigId(parsed.provider, parsed.id));
  if (!model && !config) {
    return undefined;
  }
  if (model) {
    return modelToInfo(model, getModelRegistry().hasConfiguredAuth(model), config);
  }
  if (!config) {
    return undefined;
  }
  return configToInfo(config, Boolean(config.enabled));
}

export function listScopedModels(): Array<{
  model: Model<Api>;
  thinkingLevel: ModelThinkingLevel;
}> {
  return listModels()
    .flatMap((info) => {
      const model = findModel(info.id);
      return model ? [resolveModelThinking(model, info.thinkingVariant)] : [];
    })
    .map(({ model, thinkingLevel }) => ({ model, thinkingLevel }));
}

export function getDefaultModel(): Model<Api> | undefined {
  const configuredDefault = findModel(getDefaultModelId());
  if (configuredDefault) {
    return configuredDefault;
  }

  const firstEnabled = listModels().find((model) => model.available);
  return findModel(firstEnabled?.id);
}

export function getDefaultModelId(models = listModels()): string | undefined {
  const configured = readSetting("model.default");
  if (configured && models.some((model) => model.id === configured && model.enabled)) {
    return configured;
  }

  return models[0]?.id;
}

export function getModelThinkingLevel(modelId: string | undefined): ThinkingLevel {
  if (!modelId) {
    return "off";
  }
  return getModelInfo(modelId)?.thinkingLevel ?? "off";
}

export function getModelThinkingVariant(modelId: string | undefined): string | undefined {
  return getModelInfo(modelId)?.thinkingVariant;
}

export function resolveModelThinking(
  model: Model<Api>,
  thinkingVariant?: string,
): {
  model: Model<Api>;
  thinkingLevel: ModelThinkingLevel;
  variant: string;
  thinkingBudget?: number;
} {
  const config = getModelConfig(modelToId(model));
  const thinking = thinkingStateForModel(model, config);
  const selected = thinkingVariant
    ? thinking.budget
      ? (budgetThinkingOption(thinkingVariant, thinking.budget) ?? thinking.selected)
      : clampThinkingVariant(thinkingVariant, thinking.options)
    : thinking.selected;

  if (thinking.budget && selected.level !== "off") {
    return {
      model,
      thinkingLevel: "high",
      variant: selected.value,
      thinkingBudget: Number(selected.value),
    };
  }

  if (!selected.wireValue) {
    return { model, thinkingLevel: toPiThinkingLevel(selected.level), variant: selected.value };
  }

  return {
    model: {
      ...model,
      thinkingLevelMap: {
        ...(model.thinkingLevelMap ?? {}),
        [selected.level]: selected.wireValue,
      },
    },
    thinkingLevel: toPiThinkingLevel(selected.level),
    variant: selected.value,
  };
}

export function setDefaultModel(modelId: string | undefined): void {
  if (!modelId) {
    writeSetting("model.default", undefined);
    return;
  }
  const models = listModels();
  if (!models.some((model) => model.id === modelId)) {
    throw new Error(`Model is not enabled: ${modelId}`);
  }
  writeSetting("model.default", modelId);
}

export function cycleDefaultModel(direction: "forward" | "backward" = "forward"): ModelInfo {
  const models = listModels();
  if (models.length === 0) {
    throw new Error("No Modus models are configured. Open Settings to connect a provider.");
  }

  const currentId = getDefaultModelId();
  const currentIndex = Math.max(
    0,
    models.findIndex((model) => model.id === currentId),
  );
  const offset = direction === "backward" ? -1 : 1;
  const next = models[(currentIndex + offset + models.length) % models.length];
  if (!next) {
    throw new Error("No Modus models are configured. Open Settings to connect a provider.");
  }

  setDefaultModel(next.id);
  return next;
}

export function toPiThinkingLevel(level: ThinkingLevel): ModelThinkingLevel {
  return level as ModelThinkingLevel;
}

/** Probe request timeout — generous enough for slow relays, short enough for a dialog. */
const TEST_PROVIDER_TIMEOUT_MS = 30_000;

/**
 * Live connectivity probe for the custom provider form. Builds a transient
 * pi-ai Model from the (unsaved) form values and streams one tiny prompt
 * through the exact driver Modus chats would use — validating endpoint,
 * credentials, protocol choice and, for reasoning models, whether thinking
 * deltas actually come back. Nothing is persisted.
 */
export async function testCustomProvider(
  input: TestCustomProviderInput,
): Promise<TestCustomProviderResult> {
  const api = (input.model.api?.trim() || input.api?.trim() || DEFAULT_CUSTOM_API) as Api;
  const baseUrl = (input.model.baseUrl?.trim() || input.baseUrl.trim()).replace(/\/+$/, "");
  if (!/^https?:\/\//.test(baseUrl)) {
    throw new Error("Base URL must start with http:// or https://.");
  }
  const modelId = input.model.id.trim();
  if (!modelId) {
    throw new Error("Add a model id before testing the connection.");
  }

  // Prefer the key typed into the form; fall back to the stored credential
  // when editing an existing provider with the key field left blank.
  let apiKey = input.apiKey?.trim() || undefined;
  if (!apiKey && input.provider) {
    apiKey = await getModelRegistry()
      .getApiKeyForProvider(input.provider.trim())
      .catch(() => undefined);
  }
  if (!apiKey) {
    throw new Error("Enter an API key to test this provider.");
  }

  const reasoning = Boolean(input.model.reasoning);
  const compat = mergeJsonObjects(
    input.model.compat,
    modelCompatibilityToJson({ id: modelId, compatibility: input.model.compatibility }),
  );
  const thinkingLevelMap = normalizeThinkingLevelMap(input.model.thinkingLevelMap);
  const headers = applyClientHeaderOverrides(
    api,
    sanitizeHeaders({ ...(input.headers ?? {}), ...(input.model.headers ?? {}) }),
  );

  const model: Model<Api> = {
    id: modelId,
    name: modelId,
    api,
    provider: input.provider?.trim() || "modus-connection-test",
    baseUrl,
    reasoning,
    input: ["text"],
    cost: DEFAULT_COST,
    contextWindow: input.model.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: input.model.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(headers ? { headers } : {}),
    ...(compat ? { compat: compat as NonNullable<Model<Api>["compat"]> } : {}),
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
  };

  // Mirror ModelRegistry.getApiKeyAndHeaders: the bearer toggle layers an
  // explicit Authorization header on top of the protocol's native key header.
  const requestHeaders = input.authHeader ? { Authorization: `Bearer ${apiKey}` } : undefined;

  const startedAt = Date.now();
  try {
    const stream = streamSimple(
      model,
      {
        messages: [
          {
            role: "user",
            content: "Connection test - reply with the single word: ok",
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey,
        ...(requestHeaders ? { headers: requestHeaders } : {}),
        // Exercise the real thinking path so a misconfigured budget/effort
        // setup fails here instead of mid-conversation.
        ...(reasoning ? { reasoning: "low" as const } : {}),
        timeoutMs: TEST_PROVIDER_TIMEOUT_MS,
        maxRetries: 0,
      },
    );

    let sawThinking = false;
    for await (const event of stream) {
      if (event.type === "thinking_delta" && event.delta.trim()) {
        sawThinking = true;
      }
    }
    const message = await stream.result();
    const latencyMs = Date.now() - startedAt;

    if (message.stopReason === "error" || message.stopReason === "aborted") {
      return {
        ok: false,
        latencyMs,
        message: message.errorMessage ?? "The provider returned an error.",
        sawThinking,
      };
    }

    const text = message.content
      .filter((item): item is Extract<(typeof message.content)[number], { type: "text" }> =>
        Boolean(item.type === "text" && item.text.trim()),
      )
      .map((item) => item.text.trim())
      .join(" ");
    return {
      ok: true,
      latencyMs,
      message: text || "Connected - the model returned an empty reply.",
      sawThinking,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
      sawThinking: false,
    };
  }
}
