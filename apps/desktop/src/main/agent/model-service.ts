import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type Api,
  getSupportedThinkingLevels,
  type Model,
  type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { app } from "electron";
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
  ProviderModelConfig,
  ThinkingLevel,
  UpdateModelConfigInput,
  UpsertCustomProviderInput,
} from "../../shared/contracts";
import { getDatabase } from "../db/database";

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

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
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
  };
  return mergeJsonObjects(input.compat, structured);
}

function listModelConfigRows(): ModelConfigRow[] {
  return getDatabase()
    .prepare(
      `select id, provider_id, model_id, display_name, source, enabled, context_window, max_tokens,
        reasoning, thinking_level, thinking_level_map_json
       from model_configs`,
    )
    .all() as ModelConfigRow[];
}

function getModelConfig(modelId: string): ModelConfigRow | undefined {
  return getDatabase()
    .prepare(
      `select id, provider_id, model_id, display_name, source, enabled, context_window, max_tokens,
        reasoning, thinking_level, thinking_level_map_json
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
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
}): void {
  const now = new Date().toISOString();
  const existing = getModelConfig(modelConfigId(input.provider, input.modelId));
  getDatabase()
    .prepare(
      `insert into model_configs (
        id, provider_id, model_id, display_name, source, enabled, context_window, max_tokens,
        reasoning, thinking_level, thinking_level_map_json, created_at, updated_at
       )
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(id) do update set
         display_name = excluded.display_name,
         source = excluded.source,
         enabled = excluded.enabled,
         context_window = excluded.context_window,
         max_tokens = excluded.max_tokens,
         reasoning = excluded.reasoning,
         thinking_level = excluded.thinking_level,
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

function thinkingLevelsForModel(
  model: Model<Api> | undefined,
  config: ModelConfigRow | undefined,
): ThinkingLevel[] {
  if (config?.thinking_level_map_json) {
    const map =
      normalizeThinkingLevelMap(
        parseJson<Partial<Record<ThinkingLevel, string | null>>>(
          config.thinking_level_map_json,
          {},
        ),
      ) ?? {};
    return THINKING_LEVELS.filter((level) => map[level] !== null);
  }

  if (!model) {
    return THINKING_LEVELS;
  }

  return getSupportedThinkingLevels(model).map((level) => level as ThinkingLevel);
}

function clampThinkingLevel(value: ThinkingLevel, levels: ThinkingLevel[]): ThinkingLevel {
  return levels.includes(value) ? value : (levels[0] ?? "off");
}

function modelToInfo(model: Model<Api>, available: boolean, config?: ModelConfigRow): ModelInfo {
  const id = modelToId(model);
  const levels = thinkingLevelsForModel(model, config);
  const source = config?.source ?? "builtin";
  const contextWindow = config?.context_window ?? model.contextWindow;
  const maxTokens = config?.max_tokens ?? model.maxTokens;
  const thinkingLevel = clampThinkingLevel(config?.thinking_level ?? "off", levels);
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
    supportsThinking: model.reasoning || levels.some((level) => level !== "off"),
    thinkingLevel,
    thinkingLevels: levels,
  };
}

function configToInfo(config: ModelConfigRow, available: boolean): ModelInfo {
  const levels = thinkingLevelsForModel(undefined, config);
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
    supportsThinking: Boolean(config.reasoning) || levels.some((level) => level !== "off"),
    thinkingLevel: clampThinkingLevel(config.thinking_level, levels),
    thinkingLevels: levels,
  };
}

export function listModels(): ModelInfo[] {
  const modelRegistry = refreshRegistry();
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

export function listAllProviderModels(provider: string): ProviderModelConfig[] {
  const modelRegistry = refreshRegistry();
  const configs = new Map(listModelConfigRows().map((row) => [row.id, row]));
  const models = modelRegistry.getAll().filter((model) => model.provider === provider);
  const items = new Map<string, ProviderModelConfig>();

  for (const model of models) {
    const id = modelToId(model);
    const config = configs.get(id);
    const levels = thinkingLevelsForModel(model, config);
    const contextWindow = config?.context_window ?? model.contextWindow;
    const maxTokens = config?.max_tokens ?? model.maxTokens;
    items.set(model.id, {
      id: model.id,
      name: config?.display_name ?? model.name ?? model.id,
      enabled: Boolean(config?.enabled),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      reasoning: config?.reasoning ? true : Boolean(model.reasoning),
      thinkingLevel: clampThinkingLevel(config?.thinking_level ?? "off", levels),
      thinkingLevels: levels,
    });
  }

  for (const config of configs.values()) {
    if (config.provider_id !== provider || items.has(config.model_id)) {
      continue;
    }
    const levels = thinkingLevelsForModel(undefined, config);
    const contextWindow = config.context_window ?? undefined;
    const maxTokens = config.max_tokens ?? undefined;
    items.set(config.model_id, {
      id: config.model_id,
      name: config.display_name,
      enabled: Boolean(config.enabled),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      reasoning: Boolean(config.reasoning),
      thinkingLevel: clampThinkingLevel(config.thinking_level, levels),
      thinkingLevels: levels,
    });
  }

  return [...items.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function providerSortIndex(provider: string): number {
  const index = DEFAULT_PROVIDER_ORDER.indexOf(provider);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function listProviders(): ModelProviderInfo[] {
  const modelRegistry = refreshRegistry();
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
      ...(authStatus.label ? { authLabel: authStatus.label } : {}),
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

export function getProviderDetail(provider: string): ModelProviderDetail | undefined {
  const item = listProviders().find((candidate) => candidate.id === provider);
  if (!item) {
    return undefined;
  }
  return { ...item, models: listAllProviderModels(provider) };
}

export function getModelSettings(): ModelSettingsState {
  const defaultModel = getDefaultModelId();
  return {
    providers: listProviders(),
    models: listModels(),
    ...(defaultModel ? { defaultModel } : {}),
  };
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
  upsertProviderConfig({ provider, displayName: providerName, source: "builtin" });
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
  const path = modelsPath();
  mkdirSync(dirname(path), { recursive: true });
  const data = readCustomModelsJson();
  data.providers = data.providers ?? {};
  data.providers[provider] = config;
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

  removeCustomModelsJson(id);
  const db = getDatabase();
  db.prepare("delete from model_configs where provider_id = ?").run(id);
  db.prepare("delete from model_provider_configs where provider_id = ?").run(id);

  try {
    getModelRegistry().authStorage.remove(id);
  } catch {
    // No stored credential to remove.
  }

  const currentDefault = readSetting("model.default");
  if (currentDefault?.startsWith(`${id}/`)) {
    writeSetting("model.default", undefined);
  }

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

  const levels = thinkingLevelsForModel(model, existing);
  const thinkingLevel = input.thinkingLevel
    ? clampThinkingLevel(input.thinkingLevel, levels)
    : (existing?.thinking_level ?? "off");
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
    thinkingLevel,
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
    .map((info) => {
      const model = findModel(info.id);
      return model ? { model, thinkingLevel: toPiThinkingLevel(info.thinkingLevel) } : undefined;
    })
    .filter((item): item is { model: Model<Api>; thinkingLevel: ModelThinkingLevel } =>
      Boolean(item),
    );
}

export function getDefaultModel(): Model<Api> | undefined {
  const configuredDefault = findModel(getDefaultModelId());
  if (configuredDefault) {
    return configuredDefault;
  }

  const firstEnabled = listModels().find((model) => model.available);
  return findModel(firstEnabled?.id);
}

export function getDefaultModelId(): string | undefined {
  const configured = readSetting("model.default");
  if (configured && listModels().some((model) => model.id === configured && model.enabled)) {
    return configured;
  }

  return listModels()[0]?.id;
}

export function getModelThinkingLevel(modelId: string | undefined): ThinkingLevel {
  if (!modelId) {
    return "off";
  }
  return getModelConfig(modelId)?.thinking_level ?? "off";
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
