import type {
  CustomProviderConfig,
  CustomProviderModelInput,
  ModelInputKind,
  ThinkingLevel,
} from "../../../../shared/contracts";

/**
 * Pure state/mapping layer for the custom provider form: protocol metadata,
 * thinking-level presets, and the lossless row <-> config conversions. Kept
 * free of React so the contract with the main process stays unit-testable.
 */

/* ── Key/value rows (headers) ───────────────────────────────────────────── */

export type KeyValueRow = {
  rowId: string;
  key: string;
  value: string;
};

export function createKeyValueRow(): KeyValueRow {
  return { rowId: crypto.randomUUID(), key: "", value: "" };
}

export function recordToKeyValueRows(record: Record<string, string> | undefined): KeyValueRow[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({
    rowId: crypto.randomUUID(),
    key,
    value,
  }));
}

export function keyValueRowsToRecord(rows: KeyValueRow[]): Record<string, string> | undefined {
  const result = Object.fromEntries(
    rows
      .map((row) => [row.key.trim(), row.value.trim()] as const)
      .filter(([key, value]) => key && value),
  );
  return Object.keys(result).length > 0 ? result : undefined;
}

/* ── Numeric field parsing ──────────────────────────────────────────────── */

export function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const next = Number(value.replaceAll(",", ""));
  return Number.isInteger(next) && next > 0 ? next : undefined;
}

export function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const next = Number(value.replaceAll(",", ""));
  if (!Number.isFinite(next) || next < 0) {
    throw new Error(`Invalid number: ${value}`);
  }
  return next;
}

/* ── Protocols ──────────────────────────────────────────────────────────── */

export type ProtocolValue =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";

export type Protocol = {
  value: ProtocolValue;
  label: string;
  /** One-line hint shown under the picker while selected. */
  hint: string;
  urlPlaceholder: string;
  urlHint: string;
  keyHint: string;
  /** Whether the Authorization-bearer toggle should default on. */
  bearerByDefault: boolean;
};

export const PROTOCOLS: readonly Protocol[] = [
  {
    value: "openai-completions",
    label: "OpenAI",
    hint: "Chat Completions protocol — OpenAI, most relays, vLLM, Ollama, LM Studio.",
    urlPlaceholder: "https://api.example.com/v1",
    urlHint: "OpenAI-compatible endpoint, including the version path when required.",
    keyHint: "Sent as Authorization: Bearer.",
    bearerByDefault: true,
  },
  {
    value: "openai-responses",
    label: "Responses",
    hint: "OpenAI Responses protocol — newer relays and gateways exposing /responses.",
    urlPlaceholder: "https://api.example.com/v1",
    urlHint: "Responses-compatible endpoint, including the version path when required.",
    keyHint: "Sent as Authorization: Bearer.",
    bearerByDefault: true,
  },
  {
    value: "anthropic-messages",
    label: "Anthropic",
    hint: "Messages protocol — Claude relays and coding-plan endpoints.",
    urlPlaceholder: "https://api.anthropic.com",
    urlHint: "Messages-compatible endpoint; Modus appends /v1/messages.",
    keyHint:
      "Sent as x-api-key. Enable the bearer header below if your relay expects Authorization.",
    bearerByDefault: false,
  },
  {
    value: "google-generative-ai",
    label: "Gemini",
    hint: "Google Generative Language protocol — Gemini-compatible endpoints.",
    urlPlaceholder: "https://generativelanguage.googleapis.com/v1beta",
    urlHint: "Gemini-compatible endpoint, including the version path when required.",
    keyHint: "Sent as the Google API key header.",
    bearerByDefault: false,
  },
];

export function protocolFor(api: string): Protocol | undefined {
  return PROTOCOLS.find((protocol) => protocol.value === api);
}

export const MODEL_API_OPTIONS = [
  { label: "Provider protocol", value: "" },
  { label: "OpenAI chat completions", value: "openai-completions" },
  { label: "OpenAI responses", value: "openai-responses" },
  { label: "Anthropic messages", value: "anthropic-messages" },
  { label: "Google Gemini", value: "google-generative-ai" },
] as const;

/* ── Thinking presets ───────────────────────────────────────────────────
 * pi semantics per level: missing key → provider default, null → hidden,
 * string → value sent to the provider. Presets cover the two real-world
 * families; Custom exposes the raw mapping for everything else.
 */

export type ThinkingPreset = "default" | "claude" | "openai" | "custom";

export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

/** Claude adaptive-thinking efforts — xhigh maps onto Anthropic's "max". */
export const CLAUDE_EFFORT_MAP: Partial<Record<ThinkingLevel, string | null>> = {
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "max",
};

export const OPENAI_EFFORT_MAP: Partial<Record<ThinkingLevel, string | null>> = {
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
};

export const THINKING_PRESET_OPTIONS = [
  { label: "Provider default", value: "default" },
  { label: "Claude effort (low – max)", value: "claude" },
  { label: "OpenAI effort (low – xhigh)", value: "openai" },
  { label: "Custom mapping", value: "custom" },
] as const;

export const THINKING_FORMAT_OPTIONS = [
  { label: "OpenAI reasoning effort", value: "openai" },
  { label: "OpenRouter reasoning", value: "openrouter" },
  { label: "DeepSeek thinking", value: "deepseek" },
  { label: "Together reasoning", value: "together" },
  { label: "zAI enable thinking", value: "zai" },
  { label: "Qwen enable thinking", value: "qwen" },
  { label: "Qwen chat template", value: "qwen-chat-template" },
  { label: "String thinking", value: "string-thinking" },
] as const;

export type ModelThinkingFormat = (typeof THINKING_FORMAT_OPTIONS)[number]["value"] | "none";

function presetMapEquals(
  map: Partial<Record<ThinkingLevel, string | null>>,
  preset: Partial<Record<ThinkingLevel, string | null>>,
): boolean {
  return (
    THINKING_LEVELS.every((level) => (map[level] ?? undefined) === (preset[level] ?? undefined)) &&
    Object.keys(map).every((key) => THINKING_LEVELS.includes(key as ThinkingLevel))
  );
}

export function detectThinkingPreset(
  map: Partial<Record<ThinkingLevel, string | null>> | undefined,
): ThinkingPreset {
  if (!map) {
    return "default";
  }
  if (presetMapEquals(map, CLAUDE_EFFORT_MAP)) {
    return "claude";
  }
  if (presetMapEquals(map, OPENAI_EFFORT_MAP)) {
    return "openai";
  }
  return "custom";
}

/* ── Model rows ─────────────────────────────────────────────────────────── */

export type CustomModelRow = {
  rowId: string;
  id: string;
  name: string;
  api: string;
  baseUrl: string;
  contextWindow: string;
  maxTokens: string;
  reasoning: boolean;
  imageInput: boolean;
  costInput: string;
  costOutput: string;
  costCacheRead: string;
  costCacheWrite: string;
  headers: KeyValueRow[];
  thinkingFormat: ModelThinkingFormat;
  supportsUsageInStreaming: boolean;
  adaptiveThinking: boolean;
  allowEmptySignature: boolean;
  thinkingPreset: ThinkingPreset;
  thinkingOff: string;
  thinkingMinimal: string;
  thinkingLow: string;
  thinkingMedium: string;
  thinkingHigh: string;
  thinkingXHigh: string;
};

export function createCustomModelRow(): CustomModelRow {
  return {
    rowId: crypto.randomUUID(),
    id: "",
    name: "",
    api: "",
    baseUrl: "",
    contextWindow: "128000",
    maxTokens: "16384",
    reasoning: false,
    imageInput: false,
    costInput: "",
    costOutput: "",
    costCacheRead: "",
    costCacheWrite: "",
    headers: [],
    thinkingFormat: "none",
    supportsUsageInStreaming: false,
    adaptiveThinking: false,
    allowEmptySignature: false,
    thinkingPreset: "default",
    thinkingOff: "",
    thinkingMinimal: "",
    thinkingLow: "low",
    thinkingMedium: "medium",
    thinkingHigh: "high",
    thinkingXHigh: "xhigh",
  };
}

/** Map a stored custom model config back into the editable row (lossless). */
export function modelConfigToRow(model: CustomProviderConfig["models"][number]): CustomModelRow {
  const map = model.thinkingLevelMap;
  const compat = (model.compat ?? {}) as Record<string, unknown>;
  const thinkingFormat = compat.thinkingFormat;

  return {
    ...createCustomModelRow(),
    rowId: crypto.randomUUID(),
    id: model.id,
    name: model.name,
    api: model.api ?? "",
    baseUrl: model.baseUrl ?? "",
    contextWindow: model.contextWindow != null ? String(model.contextWindow) : "128000",
    maxTokens: model.maxTokens != null ? String(model.maxTokens) : "16384",
    reasoning: model.reasoning,
    imageInput: (model.input ?? []).includes("image"),
    costInput: model.cost?.input != null ? String(model.cost.input) : "",
    costOutput: model.cost?.output != null ? String(model.cost.output) : "",
    costCacheRead: model.cost?.cacheRead != null ? String(model.cost.cacheRead) : "",
    costCacheWrite: model.cost?.cacheWrite != null ? String(model.cost.cacheWrite) : "",
    headers: recordToKeyValueRows(model.headers),
    thinkingFormat:
      typeof thinkingFormat === "string" ? (thinkingFormat as ModelThinkingFormat) : "none",
    supportsUsageInStreaming: Boolean(compat.supportsUsageInStreaming),
    adaptiveThinking: Boolean(compat.forceAdaptiveThinking),
    allowEmptySignature: Boolean(compat.allowEmptySignature),
    thinkingPreset: detectThinkingPreset(map),
    thinkingOff: map?.off ?? "",
    thinkingMinimal: map?.minimal ?? "",
    thinkingLow: map?.low ?? "",
    thinkingMedium: map?.medium ?? "",
    thinkingHigh: map?.high ?? "",
    thinkingXHigh: map?.xhigh ?? "",
  };
}

/**
 * The thinking map this row persists. Custom mode: a filled field sends that
 * value, a blank field hides the level (off stays available when blank).
 */
export function rowThinkingLevelMap(
  row: CustomModelRow,
): Partial<Record<ThinkingLevel, string | null>> | undefined {
  if (!row.reasoning || row.thinkingPreset === "default") {
    return undefined;
  }
  if (row.thinkingPreset === "claude") {
    return { ...CLAUDE_EFFORT_MAP };
  }
  if (row.thinkingPreset === "openai") {
    return { ...OPENAI_EFFORT_MAP };
  }
  const values: Partial<Record<ThinkingLevel, string | null>> = {};
  if (row.thinkingOff.trim()) values.off = row.thinkingOff.trim();
  values.minimal = row.thinkingMinimal.trim() || null;
  values.low = row.thinkingLow.trim() || null;
  values.medium = row.thinkingMedium.trim() || null;
  values.high = row.thinkingHigh.trim() || null;
  values.xhigh = row.thinkingXHigh.trim() || null;
  return values;
}

/** The wire protocol this model effectively speaks (row override beats provider). */
export function rowProtocol(row: CustomModelRow, providerApi: string): string {
  return row.api.trim() || providerApi;
}

function hasDefinedCost(cost: {
  input?: number | undefined;
  output?: number | undefined;
  cacheRead?: number | undefined;
  cacheWrite?: number | undefined;
}): boolean {
  return Object.values(cost).some((value) => value !== undefined);
}

export function rowToModelInput(
  row: CustomModelRow,
  providerApi: string,
): CustomProviderModelInput {
  const id = row.id.trim();
  if (!id) {
    throw new Error("Every model needs a model id.");
  }

  const protocol = rowProtocol(row, providerApi);
  const isOpenAiCompletions = protocol === "openai-completions";
  const isAnthropic = protocol === "anthropic-messages";
  const input: ModelInputKind[] = row.imageInput ? ["text", "image"] : ["text"];
  const thinkingLevelMap = rowThinkingLevelMap(row);
  const cost = {
    input: parseOptionalNumber(row.costInput),
    output: parseOptionalNumber(row.costOutput),
    cacheRead: parseOptionalNumber(row.costCacheRead),
    cacheWrite: parseOptionalNumber(row.costCacheWrite),
  };

  return {
    id,
    name: row.name.trim() || id,
    ...(row.api.trim() ? { api: row.api.trim() } : {}),
    ...(row.baseUrl.trim() ? { baseUrl: row.baseUrl.trim() } : {}),
    ...(parsePositiveInteger(row.contextWindow)
      ? { contextWindow: parsePositiveInteger(row.contextWindow) }
      : {}),
    ...(parsePositiveInteger(row.maxTokens)
      ? { maxTokens: parsePositiveInteger(row.maxTokens) }
      : {}),
    reasoning: row.reasoning,
    input,
    ...(hasDefinedCost(cost) ? { cost } : {}),
    ...(keyValueRowsToRecord(row.headers) ? { headers: keyValueRowsToRecord(row.headers) } : {}),
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    compatibility: {
      thinkingFormat: isOpenAiCompletions && row.reasoning ? row.thinkingFormat : "none",
      supportsUsageInStreaming: row.supportsUsageInStreaming,
      ...(isAnthropic && row.adaptiveThinking ? { forceAdaptiveThinking: true } : {}),
      ...(isAnthropic && row.allowEmptySignature ? { allowEmptySignature: true } : {}),
    },
  };
}

/** Derive a backend-valid provider id (lowercase, dashes) from a display name. */
export function slugifyProviderId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
