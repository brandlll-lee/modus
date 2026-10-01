import { Dialog } from "@base-ui/react/dialog";
import { IconFolder, IconRefresh, IconX } from "@tabler/icons-react";
import { type RefObject, useEffect, useState } from "react";
import type { ModelProviderDetail, ModelProviderInfo } from "../../../../shared/contracts";
import { ProviderLogo } from "../../components/providers/ProviderLogo";
import { Button } from "../../components/ui/Button";
import { useSuppressNativeSurface } from "../../components/ui/nativeSurface";
import { SearchField } from "../../components/ui/SearchField";
import { ToolbarButton } from "../../components/ui/ToolbarButton";

export function ProviderDetailsDialog({
  provider,
  onClose,
  finalFocus,
}: {
  provider: ModelProviderInfo;
  onClose(): void;
  finalFocus: RefObject<HTMLButtonElement | null>;
}) {
  useSuppressNativeSurface();
  const [detail, setDetail] = useState<ModelProviderDetail>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: Explicit retry invalidates the request.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void window.modus.model
      .providerDetail(provider.id)
      .then((result) => {
        if (!result) throw new Error("Provider is no longer available.");
        if (active) setDetail(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [provider.id, revision]);
  const models = (detail?.models ?? []).filter((model) =>
    `${model.name} ${model.id}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-fg/20 backdrop-blur-[1px]" />
        <Dialog.Popup
          finalFocus={finalFocus}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-hairline bg-panel text-fg shadow-lg"
        >
          <header className="flex shrink-0 items-start gap-3 border-b border-hairline-soft p-5">
            <ProviderLogo provider={provider.id} name={provider.name} />
            <div className="min-w-0 flex-1">
              <Dialog.Title className="break-words text-lg font-semibold">
                {provider.name}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-fg-muted">
                {provider.configured ? "Configured" : "Not configured"}
              </Dialog.Description>
              {detail?.source ? (
                <p className="mt-2 break-all text-xs text-fg-faint">{detail.source}</p>
              ) : null}
            </div>
            <ToolbarButton
              label="Open configuration folder"
              onClick={() =>
                void window.modus.model
                  .openConfig(provider.id)
                  .catch((cause: unknown) => setError(String(cause)))
              }
            >
              <IconFolder size={16} />
            </ToolbarButton>
            <Dialog.Close render={<ToolbarButton label="Close provider details" />}>
              <IconX size={16} />
            </Dialog.Close>
          </header>
          <div className="shrink-0 space-y-2 px-5 py-3">
            <SearchField
              ariaLabel="Search models"
              placeholder="Search models"
              value={query}
              onChange={setQuery}
            />
            {detail ? (
              <p className="text-xs text-fg-faint tabular-nums">
                {models.length} models / {detail.availableModelCount} available
              </p>
            ) : null}
          </div>
          <div className="min-h-32 min-w-0 overflow-y-auto overscroll-contain px-5 pb-5">
            {loading ? (
              <p role="status" className="py-6 text-sm text-fg-muted">
                Loading models...
              </p>
            ) : null}
            {error ? (
              <div role="alert" className="space-y-3 py-4">
                <p className="break-words text-sm text-danger">{error}</p>
                <Button onClick={() => setRevision((value) => value + 1)}>
                  <IconRefresh size={15} /> Retry
                </Button>
              </div>
            ) : null}
            {!loading && !error ? (
              <div className="divide-y divide-hairline-soft">
                {models.map((model) => (
                  <div key={model.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                    <div className="min-w-0 flex-[1_1_220px]">
                      <p className="break-words text-sm font-medium">{model.name}</p>
                      <p className="mt-0.5 break-all text-xs text-fg-faint">{model.id}</p>
                    </div>
                    <div className="text-xs text-fg-muted tabular-nums">
                      <p>{model.contextWindow?.toLocaleString() ?? "Unknown"} context</p>
                      <p>{model.maxTokens?.toLocaleString() ?? "Unknown"} output</p>
                    </div>
                    <span className="w-20 text-right text-xs text-fg-faint">
                      {model.available ? "Available" : "Unavailable"}
                    </span>
                  </div>
                ))}
                {!models.length ? (
                  <p className="py-6 text-sm text-fg-muted">
                    {detail?.models.length ? "No matching models." : "No models available."}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
