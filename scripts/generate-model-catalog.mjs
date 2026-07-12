import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";

const MODELS_DEV_URL = "https://models.dev/api.json";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, process.argv[2] ?? "catalog/models.json");
const piPackage = JSON.parse(
  readFileSync(resolve(root, "node_modules/@earendil-works/pi-ai/package.json"), "utf8"),
);

function labelFor(value) {
  if (value === "xhigh") return "XHigh";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function levelFor(value) {
  if (value === "none") return "off";
  if (["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value)) {
    return value;
  }
  return "medium";
}

function capabilityFromModelsDev(controls) {
  const effort = controls.find(
    (control) => control.type === "effort" && Array.isArray(control.values),
  );
  if (effort) {
    const values = [
      ...new Set(effort.values.filter((value) => typeof value === "string" && value)),
    ];
    if (values.length > 0) {
      return {
        type: "options",
        source: "models.dev",
        options: values.map((value) => ({
          value,
          label: labelFor(value),
          level: levelFor(value),
          wireValue: value,
        })),
      };
    }
  }

  const budget = controls.find((control) => control.type === "budget_tokens");
  if (budget) {
    return {
      type: "budget",
      source: "models.dev",
      ...(Number.isInteger(budget.min) && budget.min >= 0 ? { min: budget.min } : {}),
      ...(Number.isInteger(budget.max) && budget.max > 0 ? { max: budget.max } : {}),
    };
  }

  if (controls.some((control) => control.type === "toggle")) {
    return {
      type: "options",
      source: "models.dev",
      options: [
        { value: "off", label: "Off", level: "off" },
        { value: "on", label: "On", level: "high" },
      ],
    };
  }

  return undefined;
}

function capabilityFromPi(model) {
  if (!model.reasoning) return undefined;
  return {
    type: "options",
    source: "pi",
    options: getSupportedThinkingLevels(model).map((level) => {
      const wireValue = model.thinkingLevelMap?.[level];
      return {
        value: level,
        label: labelFor(level),
        level,
        ...(typeof wireValue === "string" && wireValue !== level ? { wireValue } : {}),
      };
    }),
  };
}

async function loadModelsDev() {
  try {
    const response = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`models.dev returned ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn(`Unable to load ${MODELS_DEV_URL}; using Pi reasoning metadata.`, error);
    return {};
  }
}

function buildReasoningIndex(modelsDev) {
  const byId = new Map();
  for (const [provider, providerData] of Object.entries(modelsDev)) {
    for (const [id, model] of Object.entries(providerData.models ?? {})) {
      const controls = model.reasoning_options;
      if (!Array.isArray(controls) || controls.length === 0) continue;
      const entries = byId.get(id) ?? [];
      entries.push({ provider, controls });
      byId.set(id, entries);
    }
  }
  return byId;
}

function officialControls(modelsDev, byId, provider, id) {
  const exact = modelsDev[provider]?.models?.[id]?.reasoning_options;
  if (Array.isArray(exact) && exact.length > 0) return exact;

  const candidates = byId.get(id) ?? [];
  const signatures = new Map(
    candidates.map(({ controls }) => [JSON.stringify(controls), controls]),
  );
  return signatures.size === 1 ? signatures.values().next().value : undefined;
}

const modelsDev = await loadModelsDev();
const reasoningById = buildReasoningIndex(modelsDev);
const providers = Object.fromEntries(
  getBuiltinProviders()
    .sort()
    .map((provider) => [
      provider,
      getBuiltinModels(provider)
        .toSorted((a, b) => a.id.localeCompare(b.id))
        .map((model) => {
          const controls = officialControls(modelsDev, reasoningById, provider, model.id);
          const reasoningCapability = controls
            ? capabilityFromModelsDev(controls)
            : capabilityFromPi(model);
          return {
            ...model,
            ...(reasoningCapability ? { reasoningCapability } : {}),
          };
        }),
    ]),
);

let generatedAt = new Date().toISOString();
try {
  const current = JSON.parse(readFileSync(outputPath, "utf8"));
  if (
    current.piVersion === piPackage.version &&
    JSON.stringify(current.providers) === JSON.stringify(providers)
  ) {
    generatedAt = current.generatedAt;
  }
} catch {
  generatedAt = new Date().toISOString();
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(
  outputPath,
  `${JSON.stringify({ schemaVersion: 2, generatedAt, piVersion: piPackage.version, providers })}\n`,
  "utf8",
);
console.log(
  `Generated ${Object.keys(providers).length} provider catalogs from pi-ai ${piPackage.version}.`,
);
