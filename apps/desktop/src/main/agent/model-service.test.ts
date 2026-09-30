import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let userData: string;
vi.mock("electron", () => ({ app: { getPath: () => userData } }));
let service: typeof import("./model-service");

beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "modus-model-runtime-"));
  service = await import("./model-service");
  await service.getModelRuntime();
}, 60_000);

afterAll(async () => {
  await rm(userData, { recursive: true, force: true }).catch(() => undefined);
});

describe("PI model runtime", () => {
  it("shares one initialized runtime with its SDK registry", async () => {
    const runtime = await service.getModelRuntime();
    expect(await service.getModelRuntime()).toBe(runtime);
    expect(service.getModelRegistry().getAll()).toEqual(runtime.getModels());
    expect(runtime.getModelsOfType("image").length).toBeGreaterThan(0);
  });

  it("delegates requested catalog refresh to PI", async () => {
    const runtime = await service.getModelRuntime();
    const refresh = vi
      .spyOn(runtime, "refresh")
      .mockResolvedValue({ aborted: false, errors: new Map() });
    await service.refreshRemoteModelCatalog();
    expect(refresh).toHaveBeenCalledWith({ allowNetwork: true });
    refresh.mockRestore();
  });

  it("discovers login methods from provider capabilities", async () => {
    const runtime = await service.getModelRuntime();
    const provider = runtime.getProviders().find((entry) => entry.auth?.oauth);
    expect(provider).toBeDefined();
    if (!provider?.auth?.oauth) throw new Error("Expected an OAuth provider.");
    expect(service.listProviderConnectionMethods(provider.id)).toContainEqual({
      kind: "oauth",
      label: provider.auth.oauth.loginLabel ?? provider.auth.oauth.name,
    });
  });

  it("keeps credentials in Modus auth storage and custom metadata in models.json", async () => {
    const provider = "synthetic-relay";
    const detail = await service.upsertCustomProvider({
      provider,
      name: "Synthetic Relay",
      baseUrl: "https://relay.example.test/v1",
      apiKey: "stored-secret",
      api: "openai-completions",
      authHeader: true,
      headers: { "X-Route": "custom" },
      models: [
        {
          id: "synthetic-model",
          reasoning: true,
          contextWindow: 262144,
          maxTokens: 8192,
          input: ["text", "image"],
          thinkingLevelMap: { minimal: null, high: "high", xhigh: "max" },
        },
      ],
    });
    expect(detail.configured).toBe(true);
    expect(detail.models).toContainEqual(
      expect.objectContaining({ id: "synthetic-model", enabled: true }),
    );
    const text = await readFile(join(userData, "pi-agent", "models.json"), "utf8");
    expect(text).not.toContain("stored-secret");
    expect(JSON.parse(text).providers[provider]).toMatchObject({
      name: "Synthetic Relay",
      headers: { "X-Route": "custom" },
      models: [{ id: "synthetic-model" }],
    });
    expect(await (await service.getModelRuntime()).getAuth(provider)).toMatchObject({
      auth: { apiKey: "stored-secret" },
    });
    expect(service.listModels()).toContainEqual(
      expect.objectContaining({ id: `${provider}/synthetic-model`, available: true }),
    );
    expect(service.getCustomProviderConfig(provider)?.headers).toEqual({ "X-Route": "custom" });
  });

  it("preserves provider configuration when editing model preferences", () => {
    service.updateModelConfig({ model: "synthetic-relay/synthetic-model", thinkingLevel: "high" });
    expect(service.getCustomProviderConfig("synthetic-relay")).toMatchObject({
      baseUrl: "https://relay.example.test/v1",
      headers: { "X-Route": "custom" },
    });
    expect(service.getModelInfo("synthetic-relay/synthetic-model")?.thinkingLevel).toBe("high");
  });

  it("preserves custom models while disconnecting their credentials", async () => {
    await service.disconnectProvider("synthetic-relay");
    expect(
      (await (await service.getModelRuntime()).listCredentials()).some(
        (entry) => entry.providerId === "synthetic-relay",
      ),
    ).toBe(false);
    expect(service.getCustomProviderConfig("synthetic-relay")?.models[0]?.id).toBe(
      "synthetic-model",
    );
    expect(
      service.getModelSettings().providers.find((entry) => entry.id === "synthetic-relay"),
    ).toMatchObject({ configured: false, enabledModelCount: 0 });
  });

  it("uses override-only native provider configuration for a relay", async () => {
    await service.configureProvider({
      provider: "anthropic",
      apiKey: "relay-secret",
      baseUrl: "https://relay.example.test/anthropic",
    });
    const data = JSON.parse(await readFile(join(userData, "pi-agent", "models.json"), "utf8"));
    expect(data.providers.anthropic.baseUrl).toBe("https://relay.example.test/anthropic");
    expect(data.providers.anthropic).not.toHaveProperty("models");
    expect(
      service
        .getModelRegistry()
        .getAll()
        .filter((entry) => entry.provider === "anthropic")
        .every((entry) => entry.baseUrl === "https://relay.example.test/anthropic"),
    ).toBe(true);
    await service.configureProvider({ provider: "anthropic", baseUrl: "" });
    expect(service.getProviderDetail("anthropic")?.baseUrl).toBeUndefined();
  });

  it("removes a custom provider and its credential together", async () => {
    await service.deleteCustomProvider("synthetic-relay");
    expect(service.findModel("synthetic-relay/synthetic-model")).toBeUndefined();
    expect(service.getCustomProviderConfig("synthetic-relay")).toBeUndefined();
  });

  it("rejects invalid endpoints through the GUI write boundary", async () => {
    await expect(
      service.configureProvider({ provider: "anthropic", baseUrl: "ftp://invalid.test" }),
    ).rejects.toThrow(/base URL/i);
  });
});
