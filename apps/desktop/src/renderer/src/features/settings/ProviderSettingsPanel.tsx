import { IconFolder, IconRefresh } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { ModelProviderDetail, ModelSettingsState } from "../../../../shared/contracts";
import { ProviderLogo } from "../../components/providers/ProviderLogo";
import { SearchField } from "../../components/ui/SearchField";
import { SettingsPageHeader } from "../../components/ui/SettingsPageHeader";
import { cn } from "../../lib/cn";

export function ProviderSettingsPanel({
  state,
  onRefresh,
}: {
  state: ModelSettingsState | null;
  onRefresh(): Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [configuredOnly, setConfiguredOnly] = useState(true);
  const [selected, setSelected] = useState<string>();
  const [detail, setDetail] = useState<ModelProviderDetail>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setDetail(undefined);
    if (selected)
      void window.modus.model
        .providerDetail(selected)
        .then((result) => {
          if (active) setDetail(result);
        })
        .catch((cause: unknown) => {
          if (active) setError(String(cause));
        });
    return () => {
      active = false;
    };
  }, [selected]);
  async function refresh() {
    setBusy(true);
    setError(undefined);
    try {
      await onRefresh();
      if (selected) setDetail(await window.modus.model.providerDetail(selected));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  const providers = (state?.providers ?? []).filter(
    (provider) =>
      (!configuredOnly || provider.configured) &&
      `${provider.id} ${provider.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <SettingsPageHeader
        actions={
          <button
            type="button"
            aria-label="Refresh models"
            title="Refresh models"
            disabled={busy}
            onClick={() => void refresh()}
            className="toolbar-icon-button flex items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
          >
            <IconRefresh aria-hidden size={16} stroke={1.8} />
          </button>
        }
        description="View the models and authentication sources available to the current PI runtime."
        title="Models and providers"
      />
      <div className="flex flex-wrap items-center gap-4">
        <SearchField
          ariaLabel="Search providers"
          className="min-w-[220px] flex-1"
          onChange={setQuery}
          placeholder="Search providers"
          value={query}
        />
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={configuredOnly}
            onChange={(event) => setConfiguredOnly(event.target.checked)}
          />
          Configured only
        </label>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger break-words">
          {error}
        </p>
      ) : null}
      {state?.errors.map((message) => (
        <p role="alert" key={message} className="text-sm text-danger break-words">
          {message}
        </p>
      ))}
      <div className="space-y-1">
        {providers.map((provider) => (
          <button
            type="button"
            aria-pressed={selected === provider.id}
            key={provider.id}
            onClick={() => setSelected(provider.id)}
            className={cn(
              "flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-hover",
              selected === provider.id && "bg-active",
            )}
          >
            <ProviderLogo provider={provider.id} name={provider.name} />
            <span className="min-w-0 flex-1 break-words text-sm">
              {provider.name}
              <span className="block text-xs text-fg-faint">
                {provider.authSource ?? (provider.configured ? "Configured" : "Not configured")}
              </span>
            </span>
            <span className="text-xs text-fg-muted tabular-nums">
              {provider.availableModelCount} / {provider.modelCount}
            </span>
          </button>
        ))}
      </div>
      {!providers.length ? <p className="text-sm text-fg-faint">No matching providers.</p> : null}
      {detail ? (
        <section className="min-w-0 border-t border-hairline-strong pt-6">
          <header className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-medium text-base">{detail.name}</h3>
              {detail.source ? (
                <p className="mt-1 text-xs text-fg-faint break-all">{detail.source}</p>
              ) : null}
            </div>
            <button
              type="button"
              title="Open configuration folder"
              aria-label="Open configuration folder"
              className="grid size-8 shrink-0 place-items-center text-fg-muted"
              onClick={() =>
                void window.modus.model
                  .openConfig(detail.id)
                  .catch((cause: unknown) => setError(String(cause)))
              }
            >
              <IconFolder size={17} />
            </button>
          </header>
          <div className="space-y-1">
            {detail.models.map((model) => (
              <div
                key={model.id}
                className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-3 py-2.5 transition-colors hover:bg-hover"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm">{model.name}</p>
                  <p className="break-all text-xs text-fg-faint">{model.id}</p>
                </div>
                <span className="text-xs text-fg-muted tabular-nums">
                  {model.contextWindow?.toLocaleString()} context /{" "}
                  {model.maxTokens?.toLocaleString()} output
                </span>
                <span className="text-xs text-fg-faint">
                  {model.available ? "Available" : "Unavailable"}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
