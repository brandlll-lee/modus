import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forceModelCatalogRefresh,
  parseModelCatalog,
  startModelCatalogUpdates,
  updateModelCatalog,
} from "./model-catalog-service";

const model = {
  id: "future-model",
  name: "Future Model",
  api: "openai-responses",
  provider: "synthetic-provider",
  baseUrl: "https://example.test/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 16_384,
};

const catalog = {
  schemaVersion: 2,
  generatedAt: "2026-07-12T00:00:00.000Z",
  piVersion: "1.0.0",
  providers: { "synthetic-provider": [model] },
};

let stopUpdates: (() => void) | undefined;

afterEach(() => {
  stopUpdates?.();
  stopUpdates = undefined;
  vi.unstubAllGlobals();
});

describe("model catalog", () => {
  it("rejects models stored under a different provider", () => {
    expect(() =>
      parseModelCatalog({
        ...catalog,
        providers: { "other-provider": [model] },
      }),
    ).toThrow(/does not match catalog provider/);
  });

  it("ships a catalog that satisfies the runtime schema", () => {
    const path = fileURLToPath(new URL("../../../../../catalog/models.json", import.meta.url));
    const shipped = parseModelCatalog(JSON.parse(readFileSync(path, "utf8")));

    expect(Object.keys(shipped.providers).length).toBeGreaterThan(0);
    expect(Object.values(shipped.providers).every((models) => models.length > 0)).toBe(true);
    expect(
      Object.values(shipped.providers)
        .flat()
        .filter((model) => model.reasoning)
        .every((model) => model.reasoningCapability !== undefined),
    ).toBe(true);
  });

  it("accepts explicit option and budget capabilities", () => {
    const parsed = parseModelCatalog({
      ...catalog,
      providers: {
        "synthetic-provider": [
          {
            ...model,
            reasoningCapability: {
              type: "options",
              source: "models.dev",
              options: [
                { value: "low", label: "Low", level: "low", wireValue: "low" },
                { value: "max", label: "Max", level: "max", wireValue: "max" },
              ],
            },
          },
          {
            ...model,
            id: "budget-model",
            reasoningCapability: {
              type: "budget",
              source: "models.dev",
              min: 128,
              max: 32_768,
            },
          },
        ],
      },
    });

    expect(parsed.providers["synthetic-provider"]?.[0]?.reasoningCapability).toMatchObject({
      type: "options",
      options: [{ value: "low" }, { value: "max" }],
    });
    expect(parsed.providers["synthetic-provider"]?.[1]?.reasoningCapability).toEqual({
      type: "budget",
      source: "models.dev",
      min: 128,
      max: 32_768,
    });
  });

  it("atomically caches a validated remote catalog", async () => {
    const directory = await mkdtemp(join(tmpdir(), "modus-model-catalog-"));
    const cachePath = join(directory, "models.json");
    const onCatalog = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(catalog), { status: 200 })),
    );

    try {
      await expect(updateModelCatalog({ cachePath, onCatalog }, true)).resolves.toBe(true);
      expect(onCatalog).toHaveBeenCalledWith(parseModelCatalog(catalog));
      expect(JSON.parse(await readFile(cachePath, "utf8"))).toEqual(catalog);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("replaces a fresh cache from an incompatible schema", async () => {
    const directory = await mkdtemp(join(tmpdir(), "modus-model-catalog-"));
    const cachePath = join(directory, "models.json");
    const onCatalog = vi.fn();
    await writeFile(cachePath, JSON.stringify({ ...catalog, schemaVersion: 1 }), "utf8");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(catalog), { status: 200 })),
    );

    try {
      stopUpdates = startModelCatalogUpdates({ cachePath, onCatalog });
      await forceModelCatalogRefresh();
      expect(JSON.parse(await readFile(cachePath, "utf8"))).toEqual(catalog);
      expect(onCatalog).toHaveBeenCalledWith(parseModelCatalog(catalog));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("removes a cached catalog rejected by the runtime", async () => {
    const directory = await mkdtemp(join(tmpdir(), "modus-model-catalog-"));
    const cachePath = join(directory, "models.json");
    const onCatalog = vi.fn(() => {
      throw new Error("unsupported runtime capability");
    });
    await writeFile(cachePath, JSON.stringify(catalog), "utf8");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(catalog), { status: 200 })),
    );

    try {
      stopUpdates = startModelCatalogUpdates({ cachePath, onCatalog });
      await forceModelCatalogRefresh();
      await expect(stat(cachePath)).rejects.toMatchObject({ code: "ENOENT" });
      expect(onCatalog).toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
