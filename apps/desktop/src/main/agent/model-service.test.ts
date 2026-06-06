import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let userData: string;
let getDatabase: typeof import("../db/database").getDatabase;
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
  ({ updateModelConfig, upsertCustomProvider } = await import("./model-service"));
}, 60_000);

afterAll(async () => {
  await rm(userData, { recursive: true, force: true }).catch(() => undefined);
});

describe("model-service custom provider config", () => {
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
        }),
      ]),
    );

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
