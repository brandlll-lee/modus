import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let userData: string;
let getDatabase: typeof import("../db/database").getDatabase;
let configureProvider: typeof import("./model-service").configureProvider;
let disconnectProvider: typeof import("./model-service").disconnectProvider;
let findModel: typeof import("./model-service").findModel;
let getCustomProviderConfig: typeof import("./model-service").getCustomProviderConfig;
let getModelRegistry: typeof import("./model-service").getModelRegistry;
let getModelSettings: typeof import("./model-service").getModelSettings;
let getProviderDetail: typeof import("./model-service").getProviderDetail;
let listProviderConnectionMethods: typeof import("./model-service").listProviderConnectionMethods;
let listModels: typeof import("./model-service").listModels;
let resolveModelThinking: typeof import("./model-service").resolveModelThinking;
let startRemoteModelCatalog: typeof import("./model-service").startRemoteModelCatalog;
let stopRemoteModelCatalog: typeof import("./model-service").stopRemoteModelCatalog;
let updateModelConfig: typeof import("./model-service").updateModelConfig;
let upsertCustomProvider: typeof import("./model-service").upsertCustomProvider;

vi.mock("electron", () => ({
  app: {
    getPath: () => userData,
  },
}));

beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "modus-model-service-test-"));
  ({ getDatabase } = await import("../db/database"));
  ({
    configureProvider,
    disconnectProvider,
    findModel,
    getCustomProviderConfig,
    getModelRegistry,
    getModelSettings,
    getProviderDetail,
    listProviderConnectionMethods,
    listModels,
    resolveModelThinking,
    startRemoteModelCatalog,
    stopRemoteModelCatalog,
    updateModelConfig,
    upsertCustomProvider,
  } = await import("./model-service"));
}, 60_000);

afterAll(async () => {
  await rm(userData, { recursive: true, force: true }).catch(() => undefined);
});

describe("model-service custom provider config", () => {
  it("refreshes the model registry once when assembling first-screen settings", () => {
    const refresh = vi.spyOn(getModelRegistry(), "refresh");

    getModelSettings();

    expect(refresh).toHaveBeenCalledOnce();
    refresh.mockRestore();
  });

  it("writes PI custom provider metadata without leaking the stored API key", async () => {
    const provider = `relay-${crypto.randomUUID().slice(0, 8)}`;

    const detail = await upsertCustomProvider({
      provider,
      name: "Relay Test",
      baseUrl: "https://relay.example.test/v1",
      apiKey: "sk-test-secret",
      api: "openai-completions",
      authHeader: true,
      headers: { "X-Relay-App": "modus" },
      compatibility: { supportsDeveloperRole: false, supportsReasoningEffort: true },
      models: [
        {
          id: "qwen3-coder",
          name: "Qwen3 Coder",
          api: "openai-completions",
          baseUrl: "https://model.example.test/v1",
          headers: { "X-Model-Route": "premium" },
          contextWindow: 262_144,
          maxTokens: 65_536,
          reasoning: true,
          input: ["text", "image"],
          cost: { input: 1, output: 2, cacheRead: 0.25, cacheWrite: 0.5 },
          compatibility: { thinkingFormat: "qwen-chat-template", supportsUsageInStreaming: true },
          thinkingLevelMap: { minimal: null, high: "high", xhigh: "max" },
        },
      ],
    });

    expect(detail.configured).toBe(true);
    expect(detail.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "qwen3-coder",
          enabled: true,
          contextWindow: 262_144,
          maxTokens: 65_536,
          reasoning: true,
          thinkingOptions: expect.arrayContaining([
            expect.objectContaining({ value: "high", level: "high" }),
            expect.objectContaining({ value: "max", level: "xhigh" }),
          ]),
        }),
      ]),
    );
    expect(
      listModels()
        .find((model) => model.id === `${provider}/qwen3-coder`)
        ?.thinkingOptions?.map((option) => option.value),
    ).toContain("max");

    const modelsJson = await readFile(join(userData, "pi-agent", "models.json"), "utf-8");
    const parsedModelsJson = JSON.parse(modelsJson);
    expect(modelsJson).not.toContain("sk-test-secret");
    expect(parsedModelsJson).toMatchObject({
      providers: {
        [provider]: {
          name: "Relay Test",
          baseUrl: "https://relay.example.test/v1",
          api: "openai-completions",
          apiKey: `$MODUS_RELAY_${provider.split("-")[1]?.toUpperCase()}_API_KEY`,
          authHeader: true,
          headers: { "X-Relay-App": "modus" },
          compat: { supportsDeveloperRole: false, supportsReasoningEffort: true },
          models: [
            {
              id: "qwen3-coder",
              name: "Qwen3 Coder",
              api: "openai-completions",
              baseUrl: "https://model.example.test/v1",
              headers: { "X-Model-Route": "premium" },
              reasoning: true,
              input: ["text", "image"],
              contextWindow: 262_144,
              maxTokens: 65_536,
              cost: { input: 1, output: 2, cacheRead: 0.25, cacheWrite: 0.5 },
              compat: { thinkingFormat: "qwen-chat-template", supportsUsageInStreaming: true },
              thinkingLevelMap: { minimal: null, high: "high", xhigh: "max" },
            },
          ],
        },
      },
    });
    expect(parsedModelsJson.providers[provider].headers).toMatchObject({
      "User-Agent": "Modus/0.1.0",
      "X-Relay-App": "modus",
      "X-Stainless-Lang": "",
      "X-Stainless-Package-Version": "",
    });
  });

  it("preserves custom provider connection fields when editing a model", async () => {
    const provider = `relay-${crypto.randomUUID().slice(0, 8)}`;
    await upsertCustomProvider({
      provider,
      name: "Relay Stable",
      baseUrl: "https://relay-stable.example.test/v1",
      apiKey: "sk-stable-secret",
      api: "openai-completions",
      authHeader: true,
      headers: { "X-Relay-App": "modus" },
      models: [
        {
          id: "stable-model",
          name: "Stable Model",
          contextWindow: 128_000,
          maxTokens: 16_384,
          reasoning: true,
          thinkingLevelMap: { low: "low", medium: "medium", high: "high" },
        },
      ],
    });

    updateModelConfig({ model: `${provider}/stable-model`, thinkingLevel: "high" });

    const row = getDatabase()
      .prepare(
        `select display_name, source, base_url, api, auth_header, headers_json
         from model_provider_configs
         where provider_id = ?`,
      )
      .get(provider) as {
      display_name: string;
      source: string;
      base_url: string;
      api: string;
      auth_header: number;
      headers_json: string;
    };

    expect(row).toEqual({
      display_name: "Relay Stable",
      source: "custom",
      base_url: "https://relay-stable.example.test/v1",
      api: "openai-completions",
      auth_header: 1,
      headers_json: JSON.stringify({ "X-Relay-App": "modus" }),
    });
  });

  it("persists anthropic thinking compat switches and round-trips them for editing", async () => {
    const provider = `relay-${crypto.randomUUID().slice(0, 8)}`;

    const detail = await upsertCustomProvider({
      provider,
      name: "Claude Relay",
      baseUrl: "https://claude-relay.example.test",
      apiKey: "sk-claude-secret",
      api: "anthropic-messages",
      authHeader: false,
      models: [
        {
          id: "claude-opus-4-7",
          name: "Claude Opus 4.7",
          reasoning: true,
          compatibility: {
            thinkingFormat: "none",
            supportsUsageInStreaming: false,
            forceAdaptiveThinking: true,
            allowEmptySignature: true,
          },
          thinkingLevelMap: {
            minimal: null,
            low: "low",
            medium: "medium",
            high: "high",
            xhigh: "xhigh",
            max: "max",
          },
        },
      ],
    });

    const modelsJson = JSON.parse(
      await readFile(join(userData, "pi-agent", "models.json"), "utf-8"),
    );
    const stored = modelsJson.providers[provider].models[0];
    expect(stored.compat).toEqual({
      supportsUsageInStreaming: false,
      forceAdaptiveThinking: true,
      allowEmptySignature: true,
    });
    expect(stored.compat).not.toHaveProperty("thinkingFormat");
    expect(stored.thinkingLevelMap).toEqual({
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    });
    expect(detail.models[0]?.thinkingOptions?.map((option) => option.value)).toEqual([
      "off",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);

    const roundTrip = getCustomProviderConfig(provider);
    expect(roundTrip?.api).toBe("anthropic-messages");
    expect(roundTrip?.models[0]?.compat).toMatchObject({
      forceAdaptiveThinking: true,
      allowEmptySignature: true,
    });
    expect(roundTrip?.models[0]?.thinkingLevelMap).toMatchObject({
      xhigh: "xhigh",
      max: "max",
    });
    const modelId = `${provider}/claude-opus-4-7`;
    const updated = updateModelConfig({ model: modelId, thinkingVariant: "max" });
    expect(updated.thinkingVariant).toBe("max");
    expect(updated.thinkingLevel).toBe("max");

    const model = findModel(modelId);
    if (!model) {
      throw new Error(`expected model ${modelId}`);
    }
    const resolved = resolveModelThinking(model, "max");
    expect(resolved.variant).toBe("max");
    expect(resolved.thinkingLevel).toBe("max");
    expect(resolved.model.thinkingLevelMap?.max).toBe("max");
  });

  it("accepts the string-thinking format for OpenAI-compatible relays", async () => {
    const provider = `relay-${crypto.randomUUID().slice(0, 8)}`;

    await upsertCustomProvider({
      provider,
      name: "String Thinking Relay",
      baseUrl: "https://string-relay.example.test/v1",
      apiKey: "sk-string-secret",
      api: "openai-completions",
      models: [
        {
          id: "kimi-k3",
          reasoning: true,
          compatibility: { thinkingFormat: "string-thinking", supportsUsageInStreaming: true },
        },
      ],
    });

    const modelsJson = JSON.parse(
      await readFile(join(userData, "pi-agent", "models.json"), "utf-8"),
    );
    expect(modelsJson.providers[provider].models[0].compat).toEqual({
      thinkingFormat: "string-thinking",
      supportsUsageInStreaming: true,
    });
  });

  it("migrates runtime defaults for custom OpenAI-compatible models", async () => {
    const provider = `relay-${crypto.randomUUID().slice(0, 8)}`;

    await upsertCustomProvider({
      provider,
      name: "Relay Reasoning",
      baseUrl: "https://relay-reasoning.example.test/v1",
      apiKey: "sk-reasoning-secret",
      api: "openai-completions",
      models: [
        {
          id: "gpt-5.5",
          name: "GPT 5.5",
          reasoning: true,
          thinkingLevelMap: {
            off: null,
            minimal: "minimal",
            low: "low",
            medium: "medium",
            high: "high",
            xhigh: "xhigh",
          },
        },
      ],
    });

    const modelsJson = await readFile(join(userData, "pi-agent", "models.json"), "utf-8");
    const parsedModelsJson = JSON.parse(modelsJson);
    expect(parsedModelsJson).toMatchObject({
      providers: {
        [provider]: {
          headers: {
            "User-Agent": "Modus/0.1.0",
            "X-Stainless-Lang": "",
          },
          models: [
            {
              id: "gpt-5.5",
              thinkingLevelMap: {
                minimal: null,
                low: "low",
                medium: "medium",
                high: "high",
                xhigh: "xhigh",
              },
            },
          ],
        },
      },
    });
    expect(parsedModelsJson.providers[provider].models[0].thinkingLevelMap).not.toHaveProperty(
      "off",
    );
  });
});

describe("model-service built-in provider base URL override", () => {
  async function readProviders(): Promise<Record<string, Record<string, unknown>>> {
    const json = await readFile(join(userData, "pi-agent", "models.json"), "utf-8");
    return (JSON.parse(json).providers ?? {}) as Record<string, Record<string, unknown>>;
  }

  it("relays a built-in provider through a custom base URL without dropping its models", async () => {
    const detail = await configureProvider({
      provider: "anthropic",
      apiKey: "sk-builtin-secret",
      baseUrl: "https://relay.example.test/anthropic",
    });

    // Built-in models are preserved — this is an override, not a replacement.
    expect(detail.source).toBe("builtin");
    expect(detail.baseUrl).toBe("https://relay.example.test/anthropic");
    expect(detail.modelCount).toBeGreaterThan(0);

    const providers = await readProviders();
    const entry = providers.anthropic;
    expect(entry).toBeDefined();
    if (!entry) {
      throw new Error("expected an anthropic override entry");
    }
    expect(entry).toMatchObject({
      api: "anthropic-messages",
      baseUrl: "https://relay.example.test/anthropic",
    });
    // Override-only: no custom model list is written for a built-in relay.
    expect(entry).not.toHaveProperty("models");
    // Fingerprint headers are blanked so the relay gets a clean request.
    expect(entry.headers).toMatchObject({
      "User-Agent": "Modus/0.1.0",
      "X-Stainless-Lang": "",
    });

    // The key lives in auth.json (AuthStorage), never the models.json.
    const modelsJson = await readFile(join(userData, "pi-agent", "models.json"), "utf-8");
    expect(modelsJson).not.toContain("sk-builtin-secret");
  });

  it("reverts to the official endpoint when the base URL is cleared", async () => {
    await configureProvider({
      provider: "google",
      apiKey: "sk-google",
      baseUrl: "https://relay.example.test/google",
    });
    expect((await readProviders()).google).toBeDefined();

    const detail = await configureProvider({ provider: "google", baseUrl: "" });

    expect(detail.baseUrl).toBeUndefined();
    expect(detail.modelCount).toBeGreaterThan(0);
    expect((await readProviders()).google).toBeUndefined();
  });

  it("leaves an existing override untouched when the base URL is omitted", async () => {
    await configureProvider({
      provider: "openai",
      apiKey: "sk-openai",
      baseUrl: "https://relay.example.test/openai",
    });

    // A later call that only refreshes the key (no baseUrl field) must not wipe
    // the relay — `undefined` means "leave untouched".
    const detail = await configureProvider({ provider: "openai", apiKey: "sk-openai-2" });

    expect(detail.baseUrl).toBe("https://relay.example.test/openai");
    expect((await readProviders()).openai).toMatchObject({
      baseUrl: "https://relay.example.test/openai",
    });
  });

  it("rejects a base URL that is not an http(s) endpoint", async () => {
    await expect(
      configureProvider({ provider: "anthropic", baseUrl: "ftp://nope.example.test" }),
    ).rejects.toThrow(/base URL/i);
  });
});

describe("provider disconnection", () => {
  it("discovers native sign-in methods from the runtime provider registry", () => {
    const oauthProvider = getModelRegistry().authStorage.getOAuthProviders()[0];
    if (!oauthProvider) {
      throw new Error("expected a native OAuth provider");
    }

    expect(listProviderConnectionMethods(oauthProvider.id)).toEqual(
      expect.arrayContaining([
        { kind: "api-key", label: "API key" },
        { kind: "oauth", label: oauthProvider.name },
      ]),
    );
  });

  it("clears a built-in provider's local credential, models, and relay override", async () => {
    const provider = "deepseek";
    await configureProvider({
      provider,
      apiKey: "sk-disconnect-builtin",
      baseUrl: "https://relay.example.test/deepseek",
    });

    disconnectProvider(provider);

    expect(getModelRegistry().authStorage.get(provider)).toBeUndefined();
    expect(getModelSettings().providers.find((item) => item.id === provider)).toMatchObject({
      configured: false,
      enabledModelCount: 0,
    });
    expect(
      getDatabase()
        .prepare("select provider_id from model_provider_configs where provider_id = ?")
        .get(provider),
    ).toBeUndefined();

    const modelsJson = JSON.parse(
      await readFile(join(userData, "pi-agent", "models.json"), "utf-8"),
    ) as { providers?: Record<string, unknown> };
    expect(modelsJson.providers?.[provider]).toBeUndefined();
  });

  it("keeps a custom provider definition after disconnecting its stored key", async () => {
    const provider = `disconnect-${crypto.randomUUID().slice(0, 8)}`;
    await upsertCustomProvider({
      provider,
      name: "Reconnectable relay",
      baseUrl: "https://relay.example.test/v1",
      apiKey: "sk-disconnect-custom",
      models: [{ id: "relay-model", name: "Relay model" }],
    });

    disconnectProvider(provider);

    expect(getModelRegistry().authStorage.get(provider)).toBeUndefined();
    expect(getCustomProviderConfig(provider)).toMatchObject({
      provider,
      baseUrl: "https://relay.example.test/v1",
      models: [{ id: "relay-model" }],
    });
    expect(getModelSettings().providers.find((item) => item.id === provider)).toMatchObject({
      source: "custom",
      configured: false,
      enabledModelCount: 0,
    });
  });
});

describe("runtime model catalog", () => {
  it("projects added and retired catalog models from the runtime registry", async () => {
    const shippedPath = fileURLToPath(
      new URL("../../../../../catalog/models.json", import.meta.url),
    );
    const catalog = JSON.parse(await readFile(shippedPath, "utf8")) as {
      providers: Record<string, Array<Record<string, unknown>>>;
    };
    const anthropicModels = catalog.providers.anthropic;
    const anthropicModel = anthropicModels?.[0];
    if (!anthropicModel || typeof anthropicModel.id !== "string")
      throw new Error("expected an Anthropic model in the shipped catalog");
    catalog.providers.anthropic = [
      ...anthropicModels.slice(1),
      {
        ...anthropicModel,
        id: "future-model",
        name: "Future Model",
        reasoningCapability: {
          type: "options",
          source: "models.dev",
          options: [
            { value: "low", label: "Low", level: "low", wireValue: "low" },
            { value: "high", label: "High", level: "high", wireValue: "high" },
          ],
        },
      },
      {
        ...anthropicModel,
        id: "budget-model",
        name: "Budget Model",
        reasoningCapability: {
          type: "budget",
          source: "models.dev",
          min: 128,
          max: 32_768,
        },
      },
    ];

    await upsertCustomProvider({
      provider: "openai",
      name: "Local OpenAI",
      baseUrl: "https://local.example.test/v1",
      apiKey: "sk-local",
      models: [{ id: "local-model", name: "Local Model" }],
    });
    await configureProvider({
      provider: "anthropic",
      apiKey: "sk-relay",
      baseUrl: "https://relay.example.test/anthropic",
    });
    const cachePath = join(userData, "pi-agent", "model-catalog.json");
    await writeFile(cachePath, JSON.stringify(catalog), "utf8");

    try {
      startRemoteModelCatalog(() => undefined);

      expect(findModel("anthropic/future-model")).toBeDefined();
      expect(findModel("anthropic/future-model")?.baseUrl).toBe(
        "https://relay.example.test/anthropic",
      );
      expect(getProviderDetail("anthropic")?.models).toContainEqual(
        expect.objectContaining({ id: "future-model", enabled: false }),
      );
      expect(
        getProviderDetail("anthropic")?.models.some((model) => model.id === anthropicModel.id),
      ).toBe(false);
      expect(listModels().some((model) => model.id === "anthropic/future-model")).toBe(false);
      updateModelConfig({ model: "anthropic/future-model", enabled: true });
      expect(listModels().some((model) => model.id === "anthropic/future-model")).toBe(true);
      expect(
        getProviderDetail("anthropic")?.models.find((model) => model.id === "future-model")
          ?.thinkingOptions,
      ).toEqual([
        { value: "low", label: "Low", level: "low", wireValue: "low" },
        { value: "high", label: "High", level: "high", wireValue: "high" },
      ]);
      const futureModel = findModel("anthropic/future-model");
      if (!futureModel) throw new Error("expected the catalog model to be registered");
      expect(resolveModelThinking(futureModel, "high").model.thinkingLevelMap?.high).toBe("high");
      expect(
        getProviderDetail("anthropic")?.models.find((model) => model.id === "budget-model")
          ?.thinkingBudget,
      ).toEqual({ min: 128, max: 32_768 });
      expect(findModel("openai/local-model")).toBeDefined();
    } finally {
      stopRemoteModelCatalog();
    }
  });
});
