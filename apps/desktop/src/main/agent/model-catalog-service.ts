import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

const DEFAULT_CATALOG_URL =
  "https://raw.githubusercontent.com/brandlll-lee/modus/automation/model-catalog/catalog/models.json";
const CATALOG_TTL_MS = 5 * 60_000;
const REFRESH_INTERVAL_MS = 60 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_CATALOG_BYTES = 10 * 1024 * 1024;

const costSchema = z
  .object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    tiers: z
      .array(
        z.object({
          inputTokensAbove: z.number().nonnegative(),
          input: z.number(),
          output: z.number(),
          cacheRead: z.number(),
          cacheWrite: z.number(),
        }),
      )
      .optional(),
  })
  .strict();

const thinkingLevelSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

const reasoningCapabilitySchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("options"),
      source: z.enum(["models.dev", "pi"]),
      options: z
        .array(
          z
            .object({
              value: z.string().min(1),
              label: z.string().min(1),
              level: thinkingLevelSchema,
              wireValue: z.string().min(1).optional(),
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("budget"),
      source: z.enum(["models.dev", "pi"]),
      min: z.number().int().nonnegative().optional(),
      max: z.number().int().positive().optional(),
    })
    .strict()
    .refine(
      (value) => value.min === undefined || value.max === undefined || value.min <= value.max,
      { message: "Reasoning budget minimum must not exceed its maximum" },
    ),
]);

const catalogModelSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    api: z.string().min(1),
    provider: z.string().min(1),
    baseUrl: z.string(),
    reasoning: z.boolean(),
    reasoningCapability: reasoningCapabilitySchema.optional(),
    thinkingLevelMap: z.record(z.string(), z.string().nullable()).optional(),
    input: z.array(z.enum(["text", "image"])),
    cost: costSchema,
    contextWindow: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
    headers: z.record(z.string(), z.string()).optional(),
    compat: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const modelCatalogSchema = z
  .object({
    schemaVersion: z.literal(2),
    generatedAt: z.string().datetime(),
    piVersion: z.string().min(1),
    providers: z.record(z.string(), z.array(catalogModelSchema).min(1)),
  })
  .strict()
  .superRefine((catalog, context) => {
    for (const [provider, models] of Object.entries(catalog.providers)) {
      for (const [index, model] of models.entries()) {
        if (model.provider !== provider) {
          context.addIssue({
            code: "custom",
            message: `Model provider ${model.provider} does not match catalog provider ${provider}`,
            path: ["providers", provider, index, "provider"],
          });
        }
      }
    }
  });

export type ModelCatalog = z.infer<typeof modelCatalogSchema>;

type CatalogUpdateOptions = {
  cachePath: string;
  currentCatalog: ModelCatalog;
  onCatalog(catalog: ModelCatalog): void;
};

let activeOptions: CatalogUpdateOptions | undefined;
let refreshPromise: Promise<boolean> | undefined;
let refreshTimer: NodeJS.Timeout | undefined;

export function parseModelCatalog(value: unknown): ModelCatalog {
  return modelCatalogSchema.parse(value);
}

export function readModelCatalog(path: string): ModelCatalog | undefined {
  try {
    return parseModelCatalog(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return undefined;
  }
}

function catalogIsFresh(path: string): boolean {
  try {
    return Date.now() - statSync(path).mtimeMs < CATALOG_TTL_MS;
  } catch {
    return false;
  }
}

async function fetchCatalogText(source: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(source, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) {
        const error = new Error(`Model catalog request failed with ${response.status}`);
        if (response.status < 500 && response.status !== 408 && response.status !== 429)
          throw error;
        lastError = error;
      } else {
        const contentLength = Number(response.headers.get("content-length") ?? 0);
        if (contentLength > MAX_CATALOG_BYTES) throw new Error("Model catalog is too large");
        const text = await response.text();
        if (Buffer.byteLength(text) > MAX_CATALOG_BYTES)
          throw new Error("Model catalog is too large");
        return text;
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt < 2) await delay(200 * 2 ** attempt);
  }
  throw lastError;
}

function writeCatalog(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporaryPath, text, "utf8");
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function applyCatalog(options: CatalogUpdateOptions, catalog: ModelCatalog): boolean {
  if (Date.parse(catalog.generatedAt) < Date.parse(options.currentCatalog.generatedAt))
    return false;
  options.onCatalog(catalog);
  options.currentCatalog = catalog;
  return true;
}

export async function updateModelCatalog(
  options: CatalogUpdateOptions,
  force = false,
): Promise<boolean> {
  if (!force && catalogIsFresh(options.cachePath)) return false;
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const source = process.env.MODUS_MODEL_CATALOG_URL ?? DEFAULT_CATALOG_URL;
      const text = await fetchCatalogText(source);
      const catalog = parseModelCatalog(JSON.parse(text));
      const previous = (() => {
        try {
          return readFileSync(options.cachePath, "utf8");
        } catch {
          return undefined;
        }
      })();
      if (text === previous) {
        return false;
      }
      if (!applyCatalog(options, catalog)) return false;
      writeCatalog(options.cachePath, text);
      return true;
    } finally {
      refreshPromise = undefined;
    }
  })();

  return refreshPromise;
}

export function startModelCatalogUpdates(options: CatalogUpdateOptions): () => void {
  if (activeOptions) return () => undefined;
  activeOptions = options;
  const cached = readModelCatalog(options.cachePath);
  if (cached) {
    try {
      if (!applyCatalog(options, cached)) rmSync(options.cachePath, { force: true });
    } catch (error) {
      rmSync(options.cachePath, { force: true });
      console.warn("Ignored an incompatible cached model catalog.", error);
    }
  } else {
    rmSync(options.cachePath, { force: true });
  }
  const refresh = () =>
    void updateModelCatalog(options).catch((error) => console.warn("Catalog refresh:", error));
  refresh();
  refreshTimer = setInterval(refresh, REFRESH_INTERVAL_MS);
  refreshTimer.unref?.();

  return () => {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = undefined;
    activeOptions = undefined;
  };
}

export async function forceModelCatalogRefresh(): Promise<boolean> {
  return activeOptions ? updateModelCatalog(activeOptions, true) : false;
}
