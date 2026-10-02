import { IconChevronRight } from "@tabler/icons-react";
import { useRef, useState } from "react";
import type { ModelProviderInfo, ModelSettingsState } from "../../../../shared/contracts";
import { ProviderLogo } from "../../components/providers/ProviderLogo";
import { SearchField } from "../../components/ui/SearchField";
import { SettingsPageHeader } from "../../components/ui/SettingsPageHeader";
import { ProviderDetailsDialog } from "./ProviderDetailsDialog";

export function ProviderSettingsPanel({ state }: { state: ModelSettingsState | null }) {
  const [query, setQuery] = useState("");
  const [configuredOnly, setConfiguredOnly] = useState(true);
  const [selected, setSelected] = useState<ModelProviderInfo>();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const providers = (state?.providers ?? []).filter(
    (provider) =>
      (!configuredOnly || provider.configured) &&
      `${provider.id} ${provider.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <SettingsPageHeader title="Models and providers" />
      <div className="flex flex-wrap items-center gap-4">
        <SearchField
          ariaLabel="Search providers"
          className="min-w-[180px] flex-1"
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
      {state?.errors.map((message) => (
        <p role="alert" key={message} className="break-words text-sm text-danger">
          {message}
        </p>
      ))}
      <div className="divide-y divide-hairline-soft">
        {providers.map((provider) => (
          <button
            type="button"
            key={provider.id}
            aria-haspopup="dialog"
            onClick={(event) => {
              triggerRef.current = event.currentTarget;
              setSelected(provider);
            }}
            className="flex min-h-14 w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-hover focus-visible:outline-focus-ring"
          >
            <ProviderLogo provider={provider.id} name={provider.name} />
            <span className="min-w-0 flex-1 break-words text-sm">
              {provider.name}
              <span className="block text-xs text-fg-faint">
                {provider.configured ? "Configured" : "Not configured"}
              </span>
            </span>
            <span className="text-xs text-fg-muted tabular-nums">
              {provider.availableModelCount} / {provider.modelCount}
            </span>
            <IconChevronRight size={15} className="shrink-0 text-fg-faint" />
          </button>
        ))}
      </div>
      {!state ? (
        <p role="status" className="text-sm text-fg-muted">
          Loading providers...
        </p>
      ) : !providers.length ? (
        <p className="text-sm text-fg-faint">No matching providers.</p>
      ) : null}
      {selected ? (
        <ProviderDetailsDialog
          provider={selected}
          onClose={() => setSelected(undefined)}
          finalFocus={triggerRef}
        />
      ) : null}
    </>
  );
}
