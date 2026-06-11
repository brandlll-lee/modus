import {
  IconCheck,
  IconChevronRight,
  IconCircleCheck,
  IconCircleX,
  IconLoader2,
  IconPlugConnected,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { AnimatePresence, m } from "motion/react";
import { type FormEvent, type ReactNode, useState } from "react";
import type { CustomProviderConfig, TestCustomProviderResult } from "../../../../shared/contracts";
import { CollapsibleMotion } from "../../components/ui/CollapsibleMotion";
import { cn } from "../../lib/cn";
import {
  Disclosure,
  Field,
  KeyValueEditor,
  SelectField,
  SwitchControl,
  ToggleField,
} from "./form-controls";
import {
  type CustomModelRow,
  createCustomModelRow,
  createKeyValueRow,
  type KeyValueRow,
  keyValueRowsToRecord,
  MODEL_API_OPTIONS,
  type ModelThinkingFormat,
  modelConfigToRow,
  PROTOCOLS,
  type ProtocolValue,
  protocolFor,
  recordToKeyValueRows,
  rowProtocol,
  rowToModelInput,
  slugifyProviderId,
  THINKING_FORMAT_OPTIONS,
  THINKING_PRESET_OPTIONS,
  type ThinkingPreset,
} from "./provider-form-mapping";

/**
 * Custom provider editor — protocol-first, flat, single column.
 *
 * The protocol choice (OpenAI / Responses / Anthropic / Gemini) is the primary
 * decision: it drives endpoint placeholders, key semantics (bearer vs
 * x-api-key), and which thinking controls each model exposes. Models are
 * compact rows whose advanced options stay folded until needed, and the footer
 * carries a live "Test connection" probe that runs the exact pi-ai driver a
 * chat would use — endpoint, key, protocol and thinking config are validated
 * before anything is saved.
 */

/* ── Component ──────────────────────────────────────────────────────────── */

export function CustomProviderForm({
  initial,
  onCancel,
  onComplete,
  onError,
}: {
  initial?: CustomProviderConfig | undefined;
  onCancel(): void;
  onComplete(provider: string): void;
  onError(message: string | undefined): void;
}) {
  const editing = Boolean(initial);
  const initialCompat = (initial?.compat ?? {}) as Record<string, unknown>;
  const [rows, setRows] = useState<CustomModelRow[]>(() =>
    initial && initial.models.length > 0
      ? initial.models.map(modelConfigToRow)
      : [createCustomModelRow()],
  );
  const [provider, setProvider] = useState(initial?.provider ?? "");
  const [providerTouched, setProviderTouched] = useState(editing);
  const [name, setName] = useState(initial?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [api, setApi] = useState(initial?.api ?? "openai-completions");
  const [authHeader, setAuthHeader] = useState(initial?.authHeader ?? true);
  const [authHeaderTouched, setAuthHeaderTouched] = useState(editing);
  const [providerHeaders, setProviderHeaders] = useState<KeyValueRow[]>(() =>
    recordToKeyValueRows(initial?.headers),
  );
  const [supportsDeveloperRole, setSupportsDeveloperRole] = useState(
    Boolean(initialCompat.supportsDeveloperRole),
  );
  const [supportsReasoningEffort, setSupportsReasoningEffort] = useState(
    Boolean(initialCompat.supportsReasoningEffort),
  );
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    (TestCustomProviderResult & { snapshot: string }) | undefined
  >();

  const protocol = protocolFor(api);
  const isOpenAiFamily = api === "openai-completions" || api === "openai-responses";
  const testTarget = rows.find((row) => row.id.trim());
  // Anything that changes the request invalidates a previous probe result.
  const testSnapshot = JSON.stringify([
    api,
    baseUrl,
    apiKey,
    authHeader,
    keyValueRowsToRecord(providerHeaders) ?? {},
    testTarget
      ? [
          testTarget.id,
          testTarget.api,
          testTarget.baseUrl,
          testTarget.reasoning,
          testTarget.thinkingPreset,
          testTarget.adaptiveThinking,
          testTarget.allowEmptySignature,
          testTarget.thinkingFormat,
        ]
      : [],
  ]);
  const visibleTestResult = testResult?.snapshot === testSnapshot ? testResult : undefined;

  function changeName(next: string): void {
    setName(next);
    if (!providerTouched && !editing) {
      setProvider(slugifyProviderId(next));
    }
  }

  function changeProtocol(next: ProtocolValue): void {
    setApi(next);
    if (!authHeaderTouched) {
      setAuthHeader(protocolFor(next)?.bearerByDefault ?? true);
    }
  }

  function updateRow(rowId: string, patch: Partial<CustomModelRow>): void {
    setRows((current) => current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  }

  function removeRow(rowId: string): void {
    setRows((current) =>
      current.length === 1 ? current : current.filter((row) => row.rowId !== rowId),
    );
  }

  function updateProviderHeader(rowId: string, patch: Partial<KeyValueRow>): void {
    setProviderHeaders((current) =>
      current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)),
    );
  }

  function reportError(message: string | undefined): void {
    setFormError(message);
    onError(message);
  }

  async function runConnectionTest(): Promise<void> {
    if (!testTarget || testing) {
      return;
    }
    setTesting(true);
    setTestResult(undefined);
    reportError(undefined);
    try {
      const model = rowToModelInput(testTarget, api);
      const result = await window.modus.model.testCustomProvider({
        ...(editing && initial ? { provider: initial.provider } : {}),
        baseUrl,
        api,
        apiKey,
        authHeader,
        ...(keyValueRowsToRecord(providerHeaders)
          ? { headers: keyValueRowsToRecord(providerHeaders) }
          : {}),
        model: {
          id: model.id,
          ...(model.api !== undefined ? { api: model.api } : {}),
          ...(model.baseUrl !== undefined ? { baseUrl: model.baseUrl } : {}),
          ...(model.headers !== undefined ? { headers: model.headers } : {}),
          ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
          ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
          ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
          ...(model.compatibility !== undefined ? { compatibility: model.compatibility } : {}),
          ...(model.thinkingLevelMap !== undefined
            ? { thinkingLevelMap: model.thinkingLevelMap }
            : {}),
        },
      });
      setTestResult({ ...result, snapshot: testSnapshot });
    } catch (error) {
      setTestResult({
        ok: false,
        latencyMs: 0,
        message: error instanceof Error ? error.message : String(error),
        sawThinking: false,
        snapshot: testSnapshot,
      });
    } finally {
      setTesting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    reportError(undefined);
    try {
      const modelInputs = rows.map((row) => rowToModelInput(row, api));
      await window.modus.model.upsertCustomProvider({
        provider,
        name,
        baseUrl,
        apiKey,
        api,
        authHeader,
        headers: keyValueRowsToRecord(providerHeaders),
        compatibility: isOpenAiFamily ? { supportsDeveloperRole, supportsReasoningEffort } : {},
        models: modelInputs,
      });
      onComplete(provider.trim().toLowerCase());
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const missingReason = !name.trim()
    ? "Add a display name first."
    : !baseUrl.trim()
      ? "Add the provider base URL first."
      : !rows.some((row) => row.id.trim())
        ? "Add at least one model id first."
        : undefined;

  return (
    <form
      className="mx-auto flex w-full max-w-[640px] flex-col gap-8 pt-1"
      onSubmit={(event) => void submit(event)}
    >
      <header>
        <h2 className="text-md text-fg">
          {editing ? `Edit ${initial?.name || initial?.provider}` : "Connect custom provider"}
        </h2>
        <p className="mt-1 text-xs leading-5 text-fg-faint">
          One endpoint, any protocol — OpenAI, Anthropic or Gemini compatible, including relays and
          coding-plan gateways.
        </p>
      </header>

      <FormSection title="Protocol">
        <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <legend className="sr-only">Provider protocol</legend>
          {PROTOCOLS.map((option) => {
            const selected = api === option.value;
            return (
              <button
                aria-pressed={selected}
                className={cn(
                  "flex h-9 items-center justify-center gap-1.5 rounded-md border text-sm transition-colors",
                  selected
                    ? "border-fg-subtle bg-active text-fg"
                    : "border-hairline text-fg-subtle hover:bg-hover hover:text-fg",
                )}
                key={option.value}
                onClick={() => changeProtocol(option.value)}
                type="button"
              >
                {selected ? <IconCheck size={13} stroke={2.2} /> : null}
                {option.label}
              </button>
            );
          })}
        </fieldset>
        <p className="text-xs leading-5 text-fg-faint">
          {protocol?.hint ?? `Custom protocol: ${api}`}
        </p>
      </FormSection>

      <FormSection title="Connection">
        <Field
          description="Shown in the model picker. The provider id is derived automatically."
          label="Display name"
          onChange={changeName}
          placeholder="My Relay"
          value={name}
        />
        <Field
          description={protocol?.urlHint ?? "Endpoint base URL."}
          label="Base URL"
          mono
          onChange={setBaseUrl}
          placeholder={protocol?.urlPlaceholder ?? "https://api.example.com/v1"}
          type="url"
          value={baseUrl}
        />
        <Field
          autoComplete="off"
          description={
            editing
              ? `Leave blank to keep the stored key. ${protocol?.keyHint ?? ""}`
              : `Stored securely on this device. ${protocol?.keyHint ?? ""}`
          }
          label="API key"
          onChange={setApiKey}
          placeholder={editing ? "••••••• (unchanged)" : "sk-..."}
          type="password"
          value={apiKey}
        />

        <Disclosure label="Advanced connection">
          <Field
            description={
              editing
                ? "Locked while editing an existing provider."
                : "Lowercase id used in Modus configuration."
            }
            label="Provider id"
            mono
            onChange={(value) => {
              setProviderTouched(true);
              setProvider(value);
            }}
            placeholder="my-relay"
            value={provider}
          />
          <ToggleField
            checked={authHeader}
            description="Also send the key as Authorization: Bearer — required by most relays, redundant on native Anthropic/Gemini endpoints."
            label="Authorization bearer header"
            onChange={(value) => {
              setAuthHeaderTouched(true);
              setAuthHeader(value);
            }}
          />
          {isOpenAiFamily ? (
            <>
              <ToggleField
                checked={supportsDeveloperRole}
                description="Send system instructions with the developer role when the endpoint supports it."
                label="Developer role"
                onChange={setSupportsDeveloperRole}
              />
              <ToggleField
                checked={supportsReasoningEffort}
                description="Endpoint accepts the reasoning_effort request field."
                label="Reasoning effort field"
                onChange={setSupportsReasoningEffort}
              />
            </>
          ) : null}
          <KeyValueEditor
            addLabel="Add header"
            description="Sent with every request to this provider."
            emptyLabel="No custom headers."
            keyPlaceholder="Header"
            onAdd={() => setProviderHeaders((current) => [...current, createKeyValueRow()])}
            onChange={updateProviderHeader}
            onRemove={(rowId) =>
              setProviderHeaders((current) => current.filter((row) => row.rowId !== rowId))
            }
            rows={providerHeaders}
            title="Provider headers"
            valuePlaceholder="Value"
          />
        </Disclosure>
      </FormSection>

      <FormSection
        action={
          <button
            className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
            onClick={() => setRows((current) => [...current, createCustomModelRow()])}
            type="button"
          >
            <IconPlus size={13} stroke={1.8} />
            Add model
          </button>
        }
        title="Models"
      >
        <div className="grid gap-2.5">
          <AnimatePresence initial={false}>
            {rows.map((row) => (
              <ModelRowEditor
                key={row.rowId}
                onChange={(patch) => updateRow(row.rowId, patch)}
                onRemove={() => removeRow(row.rowId)}
                protocol={rowProtocol(row, api)}
                removable={rows.length > 1}
                row={row}
              />
            ))}
          </AnimatePresence>
        </div>
      </FormSection>

      <div className="sticky bottom-0 z-10 border-hairline-soft border-t bg-canvas/95 pt-3 pb-1 backdrop-blur">
        {formError ? (
          <p className="mb-2 text-xs leading-5 text-danger" title={formError}>
            {formError}
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <button
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-hairline px-3 text-sm text-fg-subtle transition-colors hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            disabled={testing || !testTarget || !baseUrl.trim()}
            onClick={() => void runConnectionTest()}
            title={
              testTarget
                ? "Send a one-token probe through the real driver."
                : "Add a model id first."
            }
            type="button"
          >
            {testing ? (
              <IconLoader2 className="animate-spin" size={13} stroke={1.8} />
            ) : (
              <IconPlugConnected size={13} stroke={1.8} />
            )}
            Test connection
          </button>
          <ConnectionTestStatus result={visibleTestResult} testing={testing} />
          <div className="flex-1" />
          <button
            className="h-9 shrink-0 rounded-md px-3 text-sm text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="flex h-9 shrink-0 items-center gap-2 rounded-md bg-fg px-3.5 text-sm text-canvas transition-colors hover:bg-fg-muted disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || Boolean(missingReason)}
            title={missingReason}
            type="submit"
          >
            {busy ? <IconLoader2 className="animate-spin" size={13} stroke={1.8} /> : null}
            Save provider
          </button>
        </div>
      </div>
    </form>
  );
}

function ConnectionTestStatus({
  result,
  testing,
}: {
  result: TestCustomProviderResult | undefined;
  testing: boolean;
}) {
  if (testing) {
    return <span className="text-xs text-fg-faint">Contacting endpoint…</span>;
  }
  if (!result) {
    return null;
  }
  if (!result.ok) {
    return (
      <span
        className="flex min-w-0 items-center gap-1.5 text-xs text-danger"
        title={result.message}
      >
        <IconCircleX className="shrink-0" size={14} stroke={1.8} />
        <span className="min-w-0 truncate">{result.message}</span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-success" title={result.message}>
      <IconCircleCheck className="shrink-0" size={14} stroke={1.8} />
      <span className="min-w-0 truncate">
        Connected · {result.latencyMs.toLocaleString()} ms
        {result.sawThinking ? " · thinking verified" : ""}
      </span>
    </span>
  );
}

function FormSection({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="grid gap-4 border-hairline-soft border-t pt-6 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs text-fg-subtle">{title}</h3>
        {action ?? null}
      </div>
      {children}
    </section>
  );
}

/* ── Model row ──────────────────────────────────────────────────────────── */

function ModelRowEditor({
  row,
  protocol,
  removable,
  onChange,
  onRemove,
}: {
  row: CustomModelRow;
  /** Effective wire protocol for this model (row override beats provider). */
  protocol: string;
  removable: boolean;
  onChange(patch: Partial<CustomModelRow>): void;
  onRemove(): void;
}) {
  const [open, setOpen] = useState(false);
  const isAnthropic = protocol === "anthropic-messages";
  const isOpenAiCompletions = protocol === "openai-completions";

  function updateHeader(rowId: string, patch: Partial<KeyValueRow>): void {
    onChange({
      headers: row.headers.map((header) =>
        header.rowId === rowId ? { ...header, ...patch } : header,
      ),
    });
  }

  const summary = [
    row.reasoning ? `thinking · ${optionSummary(row.thinkingPreset, isAnthropic)}` : "no thinking",
    row.imageInput ? "image input" : undefined,
    row.api.trim() ? row.api.trim() : undefined,
  ]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <m.div
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-hairline-soft"
      exit={{ opacity: 0, y: -6 }}
      initial={{ opacity: 0, y: 6 }}
      layout
      transition={{ duration: 0.16, ease: "easeOut" }}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-2.5">
        <input
          aria-label="Model id"
          className="h-9 min-w-0 rounded-md border border-hairline bg-canvas px-3 font-mono text-xs text-fg outline-none placeholder:text-fg-faint transition-colors hover:border-hairline-strong focus:border-hairline-strong"
          onChange={(event) => onChange({ id: event.target.value })}
          placeholder="model-id"
          value={row.id}
        />
        <input
          aria-label="Model display name"
          className="h-9 min-w-0 rounded-md border border-hairline bg-canvas px-3 text-sm text-fg outline-none placeholder:text-fg-faint transition-colors hover:border-hairline-strong focus:border-hairline-strong"
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="Display name"
          value={row.name}
        />
        <span className="flex shrink-0 items-center gap-2 pl-1 text-xs text-fg-subtle">
          Thinking
          <SwitchControl
            ariaLabel={`${row.id.trim() || "model"} supports thinking`}
            checked={row.reasoning}
            onCheckedChange={(value) => onChange({ reasoning: value })}
          />
        </span>
        <button
          aria-label="Remove model"
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-35"
          disabled={!removable}
          onClick={onRemove}
          type="button"
        >
          <IconTrash size={14} stroke={1.7} />
        </button>
      </div>

      <button
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 border-hairline-soft border-t px-3 py-2 text-left text-xs text-fg-faint transition-colors hover:text-fg-subtle"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <IconChevronRight
          className={cn("shrink-0 transition-transform duration-150", open && "rotate-90")}
          size={12}
          stroke={1.8}
        />
        Options
        <span className="min-w-0 truncate">{summary ? `— ${summary}` : ""}</span>
      </button>

      <CollapsibleMotion open={open} preset="default">
        <div className="grid gap-6 border-hairline-soft border-t px-3.5 pt-4 pb-4">
          {row.reasoning ? (
            <OptionGroup
              hint={
                isAnthropic
                  ? "Claude relays use effort levels; pick the Claude preset (low – max) or map your own."
                  : "Map Modus thinking presets to what this endpoint expects."
              }
              title="Thinking"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label="Thinking levels"
                  onChange={(value) => onChange({ thinkingPreset: value as ThinkingPreset })}
                  options={THINKING_PRESET_OPTIONS}
                  value={row.thinkingPreset}
                />
                {isOpenAiCompletions ? (
                  <SelectField
                    label="Request format"
                    onChange={(value) => onChange({ thinkingFormat: value as ModelThinkingFormat })}
                    options={[
                      { label: "OpenAI default", value: "none" },
                      ...THINKING_FORMAT_OPTIONS,
                    ]}
                    value={row.thinkingFormat}
                  />
                ) : null}
              </div>
              {row.thinkingPreset === "custom" ? (
                <div className="grid gap-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field
                      label="Off"
                      mono
                      onChange={(value) => onChange({ thinkingOff: value })}
                      placeholder="default"
                      value={row.thinkingOff}
                    />
                    <Field
                      label="Minimal"
                      mono
                      onChange={(value) => onChange({ thinkingMinimal: value })}
                      placeholder="hidden"
                      value={row.thinkingMinimal}
                    />
                    <Field
                      label="Low"
                      mono
                      onChange={(value) => onChange({ thinkingLow: value })}
                      placeholder="hidden"
                      value={row.thinkingLow}
                    />
                    <Field
                      label="Medium"
                      mono
                      onChange={(value) => onChange({ thinkingMedium: value })}
                      placeholder="hidden"
                      value={row.thinkingMedium}
                    />
                    <Field
                      label="High"
                      mono
                      onChange={(value) => onChange({ thinkingHigh: value })}
                      placeholder="hidden"
                      value={row.thinkingHigh}
                    />
                    <Field
                      label="Extra high"
                      mono
                      onChange={(value) => onChange({ thinkingXHigh: value })}
                      placeholder="hidden"
                      value={row.thinkingXHigh}
                    />
                  </div>
                  <p className="text-xs leading-5 text-fg-faint">
                    The value in each box is sent to the provider for that level; leave a box empty
                    to hide the level in Modus. Off stays available either way.
                  </p>
                </div>
              ) : null}
              {isAnthropic ? (
                <div className="grid gap-1">
                  <ToggleField
                    checked={row.adaptiveThinking}
                    description="Send thinking.type: adaptive with output_config.effort — required for Claude Opus 4.7+ class models, recommended for 4.6."
                    label="Adaptive thinking"
                    onChange={(value) => onChange({ adaptiveThinking: value })}
                  />
                  <ToggleField
                    checked={row.allowEmptySignature}
                    description="Replay thinking blocks even when the relay strips signatures — keeps thinking visible across turns."
                    label="Allow unsigned thinking"
                    onChange={(value) => onChange({ allowEmptySignature: value })}
                  />
                </div>
              ) : null}
              {isOpenAiCompletions ? (
                <ToggleField
                  checked={row.supportsUsageInStreaming}
                  description="Read token usage from streaming responses when the endpoint reports it."
                  label="Streaming usage"
                  onChange={(value) => onChange({ supportsUsageInStreaming: value })}
                />
              ) : null}
            </OptionGroup>
          ) : null}

          <OptionGroup hint="Defaults suit most relays." title="Capabilities & limits">
            <ToggleField
              checked={row.imageInput}
              description="Allow image attachments for this model."
              label="Image input"
              onChange={(value) => onChange({ imageInput: value })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Context window"
                onChange={(value) => onChange({ contextWindow: value })}
                placeholder="128000"
                value={row.contextWindow}
              />
              <Field
                label="Max output tokens"
                onChange={(value) => onChange({ maxTokens: value })}
                placeholder="16384"
                value={row.maxTokens}
              />
            </div>
          </OptionGroup>

          <OptionGroup
            hint="Only needed when this model lives on a different endpoint or protocol."
            title="Endpoint override"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Protocol"
                onChange={(value) => onChange({ api: value })}
                options={MODEL_API_OPTIONS}
                value={
                  (MODEL_API_OPTIONS.some((option) => option.value === row.api)
                    ? row.api
                    : "") as (typeof MODEL_API_OPTIONS)[number]["value"]
                }
              />
              <Field
                label="Base URL"
                mono
                onChange={(value) => onChange({ baseUrl: value })}
                placeholder="provider default"
                type="url"
                value={row.baseUrl}
              />
            </div>
          </OptionGroup>

          <OptionGroup hint="Optional $ per 1M tokens, for cost display." title="Pricing">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field
                label="Input"
                onChange={(value) => onChange({ costInput: value })}
                placeholder="0"
                value={row.costInput}
              />
              <Field
                label="Output"
                onChange={(value) => onChange({ costOutput: value })}
                placeholder="0"
                value={row.costOutput}
              />
              <Field
                label="Cache read"
                onChange={(value) => onChange({ costCacheRead: value })}
                placeholder="0"
                value={row.costCacheRead}
              />
              <Field
                label="Cache write"
                onChange={(value) => onChange({ costCacheWrite: value })}
                placeholder="0"
                value={row.costCacheWrite}
              />
            </div>
          </OptionGroup>

          <KeyValueEditor
            addLabel="Add header"
            description="Override or extend the provider headers for this model."
            emptyLabel="No model-specific headers."
            keyPlaceholder="Header"
            onAdd={() => onChange({ headers: [...row.headers, createKeyValueRow()] })}
            onChange={updateHeader}
            onRemove={(rowId) =>
              onChange({ headers: row.headers.filter((header) => header.rowId !== rowId) })
            }
            rows={row.headers}
            title="Model headers"
            valuePlaceholder="Value"
          />
        </div>
      </CollapsibleMotion>
    </m.div>
  );
}

function optionSummary(preset: ThinkingPreset, isAnthropic: boolean): string {
  if (preset === "default") {
    return isAnthropic ? "provider default" : "provider default";
  }
  if (preset === "claude") {
    return "claude effort";
  }
  if (preset === "openai") {
    return "openai effort";
  }
  return "custom levels";
}

function OptionGroup({
  children,
  hint,
  title,
}: {
  children: ReactNode;
  hint: string;
  title: string;
}) {
  return (
    <section className="grid gap-3">
      <div>
        <h4 className="text-xs text-fg-muted">{title}</h4>
        <p className="mt-0.5 text-xs leading-5 text-fg-faint">{hint}</p>
      </div>
      {children}
    </section>
  );
}
