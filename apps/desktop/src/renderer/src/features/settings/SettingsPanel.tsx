import { Select } from "@base-ui/react/select";
import { Switch } from "@base-ui/react/switch";
import {
  IconAdjustments,
  IconArrowLeft,
  IconBrain,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconCodeDots,
  IconFilter,
  IconKey,
  IconLoader2,
  IconPalette,
  IconPhoto,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconServerCog,
  IconSettings,
  IconShieldCheck,
  IconTrash,
  IconVariable,
  IconX,
} from "@tabler/icons-react";
import { AnimatePresence, m } from "motion/react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import type {
  CustomProviderModelInput,
  ModelInputKind,
  ModelProviderDetail,
  ModelProviderInfo,
  ModelSettingsState,
  ProviderModelConfig,
  ThinkingLevel,
} from "../../../../shared/contracts";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";
import { groupProviderModels, modelResultLabel } from "./modelListUtils";
import { ProviderLogo } from "./ProviderLogo";

type SettingsPanelProps = {
  open: boolean;
  state: ModelSettingsState | null;
  onClose(): void;
  onRefresh(): void;
};

type SettingsSectionId = "general" | "model-provider" | "appearance" | "custom-provider";

export function SettingsPanel({ open, state, onClose, onRefresh }: SettingsPanelProps) {
  const [selectedProvider, setSelectedProvider] = useState<string | undefined>();
  const [detail, setDetail] = useState<ModelProviderDetail | undefined>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [customOpen, setCustomOpen] = useState(false);
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("model-provider");
  const [settingsQuery, setSettingsQuery] = useState("");

  const providers = state?.providers ?? [];
  const connected = providers.filter(
    (provider) => provider.configured || provider.enabledModelCount > 0,
  );
  const popular = providers.filter(
    (provider) => !connected.some((item) => item.id === provider.id),
  );
  const currentProvider =
    providers.find((provider) => provider.id === selectedProvider) ?? connected[0] ?? popular[0];

  useEffect(() => {
    if (!open) {
      return;
    }
    if (!selectedProvider && currentProvider) {
      setSelectedProvider(currentProvider.id);
    }
  }, [currentProvider, open, selectedProvider]);

  useEffect(() => {
    if (!open || !selectedProvider) {
      setDetail(undefined);
      setDetailLoading(false);
      return;
    }
    let alive = true;
    setError(undefined);
    setDetail(undefined);
    setDetailLoading(true);
    void window.modus.model
      .providerDetail(selectedProvider)
      .then((next: ModelProviderDetail | undefined) => {
        if (alive) setDetail(next);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setDetailLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, selectedProvider]);

  async function connectProvider(provider: ModelProviderInfo, apiKey?: string): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const providerDetail: ModelProviderDetail | undefined =
        await window.modus.model.providerDetail(provider.id);
      await window.modus.model.configureProvider({
        provider: provider.id,
        apiKey: apiKey?.trim(),
        enabledModelIds: providerDetail?.models.map((model) => model.id),
      });
      setProviderKeys((current) => ({ ...current, [provider.id]: "" }));
      onRefresh();
      setSelectedProvider(provider.id);
      setDetail(await window.modus.model.providerDetail(provider.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleModel(model: ProviderModelConfig, enabled: boolean): Promise<void> {
    if (!detail) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await window.modus.model.updateConfig({
        model: `${detail.id}/${model.id}`,
        enabled,
      });
      onRefresh();
      setDetail(await window.modus.model.providerDetail(detail.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-canvas">
      <SettingsSidebar
        activeSection={activeSection}
        onBack={onClose}
        onQueryChange={setSettingsQuery}
        onSectionChange={(section) => {
          setActiveSection(section);
          if (section === "custom-provider") {
            setCustomOpen(true);
          }
        }}
        query={settingsQuery}
      />

      <main className="scroll-thin min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-8 px-10 pt-16 pb-12">
          {activeSection === "general" ? <GeneralSettingsPanel /> : null}
          {activeSection === "appearance" ? <AppearanceSettingsPanel /> : null}
          {activeSection === "model-provider" || activeSection === "custom-provider" ? (
            <ModelProviderSettingsPanel
              busy={busy}
              connected={connected}
              currentProvider={currentProvider}
              customOpen={customOpen}
              detail={detail}
              detailLoading={detailLoading}
              error={error}
              keyValue={detail ? (providerKeys[detail.id] ?? "") : ""}
              onConnectProvider={(provider, apiKey) => void connectProvider(provider, apiKey)}
              onCustomCancel={() => {
                setCustomOpen(false);
                if (activeSection === "custom-provider") {
                  setActiveSection("model-provider");
                }
              }}
              onCustomComplete={(provider) => {
                setCustomOpen(false);
                setSelectedProvider(provider);
                setActiveSection("model-provider");
                onRefresh();
              }}
              onCustomOpen={() => {
                setCustomOpen((value) => !value);
                setActiveSection("model-provider");
              }}
              onError={setError}
              onKeyChange={(apiKey) => {
                if (!detail) {
                  return;
                }
                setProviderKeys((current) => ({ ...current, [detail.id]: apiKey }));
              }}
              onRefresh={onRefresh}
              onSelectProvider={(provider) => setSelectedProvider(provider.id)}
              onToggleModel={(model, enabled) => void toggleModel(model, enabled)}
              popular={popular}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}

function SettingsSidebar({
  activeSection,
  query,
  onBack,
  onQueryChange,
  onSectionChange,
}: {
  activeSection: SettingsSectionId;
  query: string;
  onBack(): void;
  onQueryChange(query: string): void;
  onSectionChange(section: SettingsSectionId): void;
}) {
  return (
    <aside className="flex w-[434px] shrink-0 flex-col border-hairline-strong border-r bg-panel px-2.5 py-3">
      <button
        className="mb-4 flex h-8 items-center gap-2 rounded-md px-2 text-sm text-fg-muted transition-colors hover:bg-hover hover:text-fg"
        onClick={onBack}
        type="button"
      >
        <IconArrowLeft size={16} stroke={1.7} />
        Back to app
      </button>

      <label className="relative mb-5 block">
        <IconSearch
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-faint"
          size={15}
          stroke={1.7}
        />
        <input
          className="h-9 w-full rounded-lg border border-hairline-soft bg-surface/45 pr-3 pl-8 text-sm text-fg outline-none placeholder:text-fg-faint focus:border-hairline-strong"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search settings..."
          value={query}
        />
      </label>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <SettingsNavGroup title="Personal">
          <SettingsNavItem
            active={activeSection === "general"}
            icon={<IconSettings size={16} stroke={1.7} />}
            onClick={() => onSectionChange("general")}
          >
            General
          </SettingsNavItem>
          <SettingsNavItem
            active={activeSection === "model-provider"}
            icon={<IconServerCog size={16} stroke={1.7} />}
            onClick={() => onSectionChange("model-provider")}
          >
            Model & Provider
          </SettingsNavItem>
          <SettingsNavItem
            active={activeSection === "appearance"}
            icon={<IconPalette size={16} stroke={1.7} />}
            onClick={() => onSectionChange("appearance")}
          >
            Appearance
          </SettingsNavItem>
        </SettingsNavGroup>

        <SettingsNavGroup title="Integrations">
          <SettingsNavItem
            active={activeSection === "custom-provider"}
            icon={<IconPlugConnected size={16} stroke={1.7} />}
            onClick={() => onSectionChange("custom-provider")}
          >
            Custom Provider
          </SettingsNavItem>
        </SettingsNavGroup>
      </div>

      <div className="border-hairline-soft border-t px-2 pt-3 text-xs text-fg-faint">
        <div>Modus Desktop</div>
        <div className="mt-1">v0.1.0</div>
      </div>
    </aside>
  );
}

function SettingsNavGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="mb-7">
      <h3 className="mb-2 px-2 text-xs font-normal text-fg-faint">{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function SettingsNavItem({
  active = false,
  children,
  icon,
  onClick,
}: {
  active?: boolean;
  children: string;
  icon: ReactNode;
  onClick(): void;
}) {
  return (
    <button
      className={cn(
        "flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors",
        active ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
      )}
      onClick={onClick}
      type="button"
    >
      <span className={active ? "text-fg" : "text-fg-subtle"}>{icon}</span>
      <span className="truncate">{children}</span>
    </button>
  );
}

function ModelProviderSettingsPanel({
  busy,
  connected,
  currentProvider,
  customOpen,
  detail,
  detailLoading,
  error,
  keyValue,
  popular,
  onConnectProvider,
  onCustomCancel,
  onCustomComplete,
  onCustomOpen,
  onError,
  onKeyChange,
  onRefresh,
  onSelectProvider,
  onToggleModel,
}: {
  busy: boolean;
  connected: ModelProviderInfo[];
  currentProvider: ModelProviderInfo | undefined;
  customOpen: boolean;
  detail: ModelProviderDetail | undefined;
  detailLoading: boolean;
  error: string | undefined;
  keyValue: string;
  popular: ModelProviderInfo[];
  onConnectProvider(provider: ModelProviderInfo, apiKey?: string): void;
  onCustomCancel(): void;
  onCustomComplete(provider: string): void;
  onCustomOpen(): void;
  onError(message: string | undefined): void;
  onKeyChange(apiKey: string): void;
  onRefresh(): void;
  onSelectProvider(provider: ModelProviderInfo): void;
  onToggleModel(model: ProviderModelConfig, enabled: boolean): void;
}) {
  const [providerQuery, setProviderQuery] = useState("");
  const providers = useMemo(() => [...connected, ...popular], [connected, popular]);
  const enabledModelCount = useMemo(
    () => providers.reduce((total, provider) => total + provider.enabledModelCount, 0),
    [providers],
  );

  return (
    <>
      <SettingsPageHeader
        actions={
          <>
            <Tooltip content="Refresh providers">
              <button
                aria-label="Refresh providers"
                className="flex size-8 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg"
                onClick={onRefresh}
                type="button"
              >
                <IconRefresh size={15} stroke={1.7} />
              </button>
            </Tooltip>
            <button
              className="flex h-8 items-center gap-1.5 rounded-md bg-fg px-3 text-sm text-canvas transition-colors hover:bg-white"
              onClick={onCustomOpen}
              type="button"
            >
              <IconPlus size={14} stroke={2.1} />
              Custom provider
            </button>
          </>
        }
        description="Connect PI providers, enable models, and choose reasoning behavior."
        title="Model & Provider"
      />

      <div className="flex flex-wrap gap-2">
        <ReadOnlyPill>{`${connected.length} connected`}</ReadOnlyPill>
        <ReadOnlyPill>{`${enabledModelCount} enabled models`}</ReadOnlyPill>
        <ReadOnlyPill>{`${providers.length} providers`}</ReadOnlyPill>
      </div>

      <AnimatePresence initial={false}>
        {error ? (
          <m.div
            animate={{ opacity: 1, y: 0 }}
            className="rounded-lg border border-danger/30 bg-danger/8 px-3 py-2 text-xs text-danger"
            exit={{ opacity: 0, y: -4 }}
            initial={{ opacity: 0, y: -4 }}
            key="settings-error"
            transition={{ duration: 0.14, ease: "easeOut" }}
          >
            {error}
          </m.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {customOpen ? (
          <m.div
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            initial={{ opacity: 0, y: -6 }}
            key="custom-provider-form"
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            <CustomProviderForm
              onCancel={onCustomCancel}
              onComplete={onCustomComplete}
              onError={onError}
            />
          </m.div>
        ) : null}
      </AnimatePresence>

      <div className="grid items-start gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <ProviderCatalog
          connected={connected}
          currentProvider={currentProvider}
          onQueryChange={setProviderQuery}
          onSelectProvider={onSelectProvider}
          popular={popular}
          query={providerQuery}
        />

        <AnimatePresence initial={false} mode="wait">
          {detailLoading ? (
            <ProviderDetailLoading key="provider-loading" />
          ) : detail ? (
            <ProviderDetail
              busy={busy}
              detail={detail}
              key={detail.id}
              keyValue={keyValue}
              onConnect={(apiKey) => onConnectProvider(detail, apiKey)}
              onKeyChange={onKeyChange}
              onToggleModel={onToggleModel}
            />
          ) : (
            <ProviderDetailEmpty key="provider-empty" />
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

function ProviderCatalog({
  connected,
  currentProvider,
  popular,
  query,
  onQueryChange,
  onSelectProvider,
}: {
  connected: ModelProviderInfo[];
  currentProvider: ModelProviderInfo | undefined;
  popular: ModelProviderInfo[];
  query: string;
  onQueryChange(query: string): void;
  onSelectProvider(provider: ModelProviderInfo): void;
}) {
  const normalizedQuery = normalizeSearchValue(query);
  const visibleConnected = useMemo(
    () => connected.filter((provider) => providerMatchesQuery(provider, normalizedQuery)),
    [connected, normalizedQuery],
  );
  const visiblePopular = useMemo(
    () => popular.filter((provider) => providerMatchesQuery(provider, normalizedQuery)),
    [popular, normalizedQuery],
  );
  const visibleCount = visibleConnected.length + visiblePopular.length;

  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-normal text-fg">Provider catalog</h3>
          <p className="mt-1 text-xs text-fg-faint">Select a provider to configure models.</p>
        </div>
        <ReadOnlyPill>{`${visibleCount} shown`}</ReadOnlyPill>
      </div>

      <div className="overflow-hidden rounded-lg border border-hairline-soft bg-panel">
        <div className="border-hairline-soft border-b p-3">
          <SearchField
            ariaLabel="Search providers"
            onChange={onQueryChange}
            placeholder="Search providers..."
            value={query}
          />
        </div>

        <div className="scroll-thin max-h-[calc(100vh-280px)] min-h-[320px] overflow-y-auto p-2">
          {visibleCount > 0 ? (
            <>
              <ProviderGroup title="Connected">
                {visibleConnected.map((provider) => (
                  <ProviderRow
                    active={provider.id === currentProvider?.id}
                    key={provider.id}
                    onClick={() => onSelectProvider(provider)}
                    provider={provider}
                  />
                ))}
              </ProviderGroup>

              <ProviderGroup title="Available">
                {visiblePopular.map((provider) => (
                  <ProviderRow
                    active={provider.id === currentProvider?.id}
                    key={provider.id}
                    onClick={() => onSelectProvider(provider)}
                    provider={provider}
                  />
                ))}
              </ProviderGroup>
            </>
          ) : (
            <EmptyState
              description="Try another provider name, model count, or source."
              title="No providers found"
            />
          )}
        </div>
      </div>
    </section>
  );
}

function GeneralSettingsPanel() {
  return (
    <>
      <SettingsPageHeader
        description="General Modus preferences and workspace defaults."
        title="General"
      />
      <SettingsSection title="Workspace">
        <SettingsList>
          <SettingsRow
            control={<ReadOnlyPill>Local-first</ReadOnlyPill>}
            description="Modus runs agent work against your local workspace and filesystem context."
            title="Execution mode"
          />
          <SettingsRow
            control={<ReadOnlyPill>Managed by app</ReadOnlyPill>}
            description="Session creation and model selection are synchronized with the active workspace."
            title="Session defaults"
          />
        </SettingsList>
      </SettingsSection>
    </>
  );
}

function AppearanceSettingsPanel() {
  return (
    <>
      <SettingsPageHeader
        description="Visual preferences aligned with the current Modus desktop theme."
        title="Appearance"
      />
      <SettingsSection title="Theme">
        <SettingsList>
          <SettingsRow
            control={<ReadOnlyPill>Dark</ReadOnlyPill>}
            description="The current release uses a dark, low-contrast desktop theme."
            title="Color scheme"
          />
          <SettingsRow
            control={<ReadOnlyPill>Inter</ReadOnlyPill>}
            description="Typography uses self-hosted Inter Variable and JetBrains Mono Variable."
            title="Font family"
          />
        </SettingsList>
      </SettingsSection>
    </>
  );
}

function SettingsPageHeader({
  actions,
  description,
  title,
}: {
  actions?: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <header className="sticky top-0 z-10 -mx-10 -mt-16 flex items-end justify-between gap-5 bg-gradient-to-b from-canvas via-canvas to-canvas/0 px-10 pt-16 pb-8">
      <div className="min-w-0">
        <h2 className="text-lg font-normal text-fg">{title}</h2>
        <p className="mt-2 text-sm text-fg-muted">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2 pb-0.5">{actions}</div> : null}
    </header>
  );
}

function SettingsSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-sm font-normal text-fg">{title}</h3>
      {children}
    </section>
  );
}

function SettingsList({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-hairline-soft bg-panel">
      {children}
    </div>
  );
}

function SettingsRow({
  control,
  description,
  title,
}: {
  control: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="flex min-h-[72px] items-center gap-5 border-hairline-soft border-b px-5 py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-fg">{title}</div>
        <div className="mt-1 text-xs text-fg-muted">{description}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function ReadOnlyPill({ children }: { children: string }) {
  return (
    <span className="rounded-md bg-white/5 px-2.5 py-1 text-xs text-fg-muted">{children}</span>
  );
}

function ProviderGroup({ children, title }: { children: ReactNode; title: string }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="mb-4 last:mb-0">
      <div className="mb-2 flex items-center justify-between px-2">
        <h4 className="text-xs font-normal text-fg-faint">{title}</h4>
        <span className="font-mono text-2xs text-fg-faint">{items.length}</span>
      </div>
      <div className="grid gap-1">{items}</div>
    </section>
  );
}

function ProviderRow({
  provider,
  active,
  onClick,
}: {
  provider: ModelProviderInfo;
  active: boolean;
  onClick(): void;
}) {
  const status = providerStatus(provider);

  return (
    <m.button
      aria-current={active ? "true" : undefined}
      className={cn(
        "group grid min-h-[58px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 text-left outline-none transition-colors",
        active
          ? "border-hairline-strong bg-active text-fg"
          : "border-transparent text-fg-muted hover:border-hairline-soft hover:bg-hover hover:text-fg",
      )}
      layout
      onClick={onClick}
      type="button"
      whileTap={{ scale: 0.992 }}
    >
      <ProviderLogo name={provider.name} provider={provider.id} />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm text-fg">{provider.name}</span>
          {provider.source === "custom" ? <TinyBadge>custom</TinyBadge> : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-fg-faint">
          {providerSummary(provider)}
        </span>
      </span>
      <span className="flex items-center gap-2">
        <ProviderStatusPill status={status} />
        <IconChevronRight
          className={cn(
            "text-fg-faint transition-transform group-hover:translate-x-0.5 group-hover:text-fg-subtle",
            active && "text-fg-subtle",
          )}
          size={14}
          stroke={1.7}
        />
      </span>
    </m.button>
  );
}

function ProviderDetail({
  detail,
  busy,
  keyValue,
  onConnect,
  onKeyChange,
  onToggleModel,
}: {
  detail: ModelProviderDetail;
  busy: boolean;
  keyValue: string;
  onConnect(apiKey: string): void;
  onKeyChange(apiKey: string): void;
  onToggleModel(model: ProviderModelConfig, enabled: boolean): void;
}) {
  const [modelQuery, setModelQuery] = useState("");
  const [modelFilter, setModelFilter] = useState<ModelFilter>("all");
  const models = useMemo(() => detail.models.slice().sort(compareModelConfig), [detail.models]);
  const enabledCount = useMemo(() => models.filter((model) => model.enabled).length, [models]);
  const thinkingCount = useMemo(() => models.filter((model) => model.reasoning).length, [models]);
  const filteredModels = useMemo(
    () =>
      models.filter(
        (model) =>
          modelMatchesFilter(model, modelFilter) &&
          modelMatchesQuery(model, normalizeSearchValue(modelQuery)),
      ),
    [models, modelFilter, modelQuery],
  );
  const modelGroups = useMemo(() => groupProviderModels(filteredModels), [filteredModels]);

  useEffect(() => {
    setModelQuery("");
    setModelFilter("all");
  }, []);

  return (
    <m.section
      animate={{ opacity: 1, y: 0 }}
      className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-hairline-soft bg-panel"
      exit={{ opacity: 0, y: 8 }}
      initial={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
    >
      <div className="border-hairline-soft border-b px-5 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <ProviderLogo name={detail.name} provider={detail.id} size="lg" />
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h3 className="truncate text-md font-normal text-fg">{detail.name}</h3>
                {detail.source === "custom" ? <TinyBadge>custom</TinyBadge> : null}
              </div>
              <p className="mt-1 truncate text-xs text-fg-faint">{providerIdentity(detail)}</p>
            </div>
          </div>
          <ProviderStatusPill status={providerStatus(detail)} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <ReadOnlyPill>{`${detail.modelCount} models`}</ReadOnlyPill>
          <ReadOnlyPill>{`${enabledCount} enabled`}</ReadOnlyPill>
          <ReadOnlyPill>{`${thinkingCount} thinking`}</ReadOnlyPill>
        </div>
      </div>

      <ProviderCredentials
        busy={busy}
        detail={detail}
        keyValue={keyValue}
        onConnect={onConnect}
        onKeyChange={onKeyChange}
      />

      <div className="px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h4 className="text-sm font-normal text-fg">Models</h4>
            <p className="mt-1 text-xs text-fg-faint">
              Choose which models appear in the composer.
            </p>
          </div>
          {busy ? (
            <span className="flex items-center gap-1.5 rounded-md bg-white/5 px-2.5 py-1 text-xs text-fg-muted">
              <IconLoader2 className="animate-spin" size={13} stroke={1.8} />
              Saving
            </span>
          ) : (
            <ReadOnlyPill>{modelResultLabel(filteredModels.length)}</ReadOnlyPill>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchField
            ariaLabel="Search models"
            onChange={setModelQuery}
            placeholder="Search models..."
            value={modelQuery}
          />
          <SegmentedFilter
            enabledCount={enabledCount}
            onChange={setModelFilter}
            thinkingCount={thinkingCount}
            value={modelFilter}
          />
        </div>

        <div className="scroll-thin mt-4 -mx-5 max-h-[clamp(300px,calc(100vh-520px),520px)] overflow-y-auto border-hairline-soft border-t">
          {filteredModels.length > 0 ? (
            modelGroups.map((group) => (
              <ModelGroupSection
                busy={busy}
                group={group}
                key={group.id}
                onToggleModel={onToggleModel}
              />
            ))
          ) : (
            <EmptyState
              description="Adjust the search text or filter to bring models back."
              title="No models match"
            />
          )}
        </div>
      </div>
    </m.section>
  );
}

function ProviderCredentials({
  detail,
  busy,
  keyValue,
  onConnect,
  onKeyChange,
}: {
  detail: ModelProviderDetail;
  busy: boolean;
  keyValue: string;
  onConnect(apiKey: string): void;
  onKeyChange(apiKey: string): void;
}) {
  return (
    <form
      className="border-hairline-soft border-b px-5 py-5"
      onSubmit={(event) => {
        event.preventDefault();
        onConnect(keyValue);
      }}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h4 className="text-sm font-normal text-fg">Provider credentials</h4>
          <p className="mt-1 text-xs text-fg-faint">
            {detail.configured
              ? "Update the stored key without changing enabled models."
              : "Connect an API key before using this provider in the composer."}
          </p>
        </div>
        {detail.configured ? (
          <span className="flex items-center gap-1 rounded-md bg-success/10 px-2 py-1 text-xs text-success">
            <IconCircleCheck size={13} stroke={1.8} />
            Connected
          </span>
        ) : null}
      </div>

      <div className="flex gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">API key for {detail.name}</span>
          <IconKey
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-faint"
            size={15}
            stroke={1.7}
          />
          <input
            className="h-9 w-full rounded-md border border-hairline bg-canvas pr-3 pl-9 text-sm text-fg outline-none placeholder:text-fg-faint transition-colors focus:border-hairline-strong"
            onChange={(event) => onKeyChange(event.target.value)}
            placeholder={detail.configured ? "Update API key" : "API key"}
            type="password"
            value={keyValue}
          />
        </label>
        <button
          className="flex h-9 min-w-[92px] items-center justify-center gap-1.5 rounded-md bg-fg px-3 text-sm text-canvas transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy || !keyValue.trim()}
          type="submit"
        >
          {busy ? <IconLoader2 className="animate-spin" size={13} stroke={1.8} /> : null}
          {detail.configured ? "Update" : "Connect"}
        </button>
      </div>
    </form>
  );
}

function ModelGroupSection({
  group,
  busy,
  onToggleModel,
}: {
  group: ReturnType<typeof groupProviderModels>[number];
  busy: boolean;
  onToggleModel(model: ProviderModelConfig, enabled: boolean): void;
}) {
  return (
    <section>
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-hairline-soft border-b bg-panel/95 px-5 py-2.5 backdrop-blur">
        <div className="min-w-0">
          <h5 className="text-xs font-normal text-fg-muted">{group.title}</h5>
          <p className="mt-0.5 text-2xs text-fg-faint">{group.description}</p>
        </div>
        <ReadOnlyPill>{group.models.length.toString()}</ReadOnlyPill>
      </div>
      <AnimatePresence initial={false}>
        {group.models.map((model) => (
          <ModelRow busy={busy} key={model.id} model={model} onToggleModel={onToggleModel} />
        ))}
      </AnimatePresence>
    </section>
  );
}

function ModelRow({
  model,
  busy,
  onToggleModel,
}: {
  model: ProviderModelConfig;
  busy: boolean;
  onToggleModel(model: ProviderModelConfig, enabled: boolean): void;
}) {
  return (
    <m.div
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "grid min-h-[68px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-hairline-soft border-b px-5 py-3 last:border-b-0",
        model.enabled ? "bg-white/[0.025]" : "hover:bg-hover",
      )}
      exit={{ opacity: 0, y: -4 }}
      initial={{ opacity: 0, y: 4 }}
      layout
      transition={{ duration: 0.14, ease: "easeOut" }}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm text-fg">{model.name}</span>
          <ModelKindBadge model={model} />
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs text-fg-faint">
          <span className="min-w-0 truncate font-mono">{model.id}</span>
          {model.contextWindow ? (
            <span>{`${model.contextWindow.toLocaleString()} ctx`}</span>
          ) : null}
          {model.maxTokens ? <span>{`${model.maxTokens.toLocaleString()} out`}</span> : null}
          {model.thinkingLevel !== "off" ? <span>{model.thinkingLevel}</span> : null}
        </div>
      </div>
      <SwitchControl
        ariaLabel={`${model.enabled ? "Disable" : "Enable"} ${model.name}`}
        checked={model.enabled}
        disabled={busy}
        onCheckedChange={(checked) => onToggleModel(model, checked)}
      />
    </m.div>
  );
}

function SegmentedFilter({
  enabledCount,
  thinkingCount,
  value,
  onChange,
}: {
  enabledCount: number;
  thinkingCount: number;
  value: ModelFilter;
  onChange(value: ModelFilter): void;
}) {
  const options: Array<{ value: ModelFilter; label: string; count?: number }> = [
    { value: "all", label: "All" },
    { value: "enabled", label: "Enabled", count: enabledCount },
    { value: "thinking", label: "Thinking", count: thinkingCount },
  ];

  return (
    <fieldset className="flex shrink-0 items-center gap-1 rounded-lg border border-hairline bg-canvas p-1">
      <legend className="sr-only">Filter models</legend>
      <IconFilter className="ml-1 text-fg-faint" size={14} stroke={1.7} />
      {options.map((option) => (
        <button
          className={cn(
            "flex h-7 items-center gap-1 rounded-md px-2 text-xs transition-colors",
            value === option.value
              ? "bg-active text-fg"
              : "text-fg-subtle hover:bg-hover hover:text-fg",
          )}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
          {option.count !== undefined ? (
            <span className="font-mono text-2xs text-fg-faint">{option.count}</span>
          ) : null}
        </button>
      ))}
    </fieldset>
  );
}

function ProviderDetailLoading() {
  return (
    <m.section
      animate={{ opacity: 1, y: 0 }}
      className="flex min-h-[420px] min-w-0 items-center justify-center rounded-lg border border-hairline-soft bg-panel px-5 py-10"
      exit={{ opacity: 0, y: 8 }}
      initial={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
    >
      <div className="flex items-center gap-2 text-sm text-fg-muted">
        <IconLoader2 className="animate-spin text-fg-faint" size={16} stroke={1.8} />
        Loading provider
      </div>
    </m.section>
  );
}

function ProviderDetailEmpty() {
  return (
    <m.section
      animate={{ opacity: 1, y: 0 }}
      className="flex min-h-[420px] min-w-0 items-center justify-center rounded-lg border border-hairline-soft bg-panel px-5 py-10"
      exit={{ opacity: 0, y: 8 }}
      initial={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
    >
      <EmptyState
        description="Choose a provider from the catalog to inspect credentials and model availability."
        title="No provider selected"
      />
    </m.section>
  );
}

function SearchField({
  ariaLabel,
  placeholder,
  value,
  onChange,
}: {
  ariaLabel: string;
  placeholder: string;
  value: string;
  onChange(value: string): void;
}) {
  return (
    <label className="relative block min-w-0 flex-1">
      <span className="sr-only">{ariaLabel}</span>
      <IconSearch
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-faint"
        size={15}
        stroke={1.7}
      />
      <input
        aria-label={ariaLabel}
        className="h-9 w-full rounded-md border border-hairline bg-canvas pr-8 pl-8 text-sm text-fg outline-none placeholder:text-fg-faint transition-colors focus:border-hairline-strong"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
      {value ? (
        <button
          aria-label={`Clear ${ariaLabel.toLowerCase()}`}
          className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg"
          onClick={() => onChange("")}
          type="button"
        >
          <IconX size={13} stroke={1.8} />
        </button>
      ) : null}
    </label>
  );
}

function SwitchControl({
  ariaLabel,
  checked,
  disabled,
  onCheckedChange,
}: {
  ariaLabel: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange(checked: boolean): void;
}) {
  return (
    <Switch.Root
      aria-label={ariaLabel}
      checked={checked}
      className={cn(
        "relative flex h-5 w-9 shrink-0 items-center rounded-full border border-hairline bg-white/6 px-0.5 outline-none transition-colors",
        "data-[checked]:border-fg data-[checked]:bg-fg",
        "data-[unchecked]:hover:bg-white/10",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        "focus-visible:border-hairline-strong focus-visible:ring-2 focus-visible:ring-white/10",
      )}
      disabled={disabled}
      onCheckedChange={(nextChecked) => onCheckedChange(nextChecked)}
    >
      <Switch.Thumb
        className={cn(
          "block size-4 rounded-full bg-fg-muted transition-transform duration-150 ease-out",
          "data-[checked]:translate-x-4 data-[checked]:bg-canvas",
          "data-[unchecked]:translate-x-0",
        )}
      />
    </Switch.Root>
  );
}

function ProviderStatusPill({ status }: { status: ProviderStatus }) {
  if (status === "error") {
    return (
      <span className="rounded-md bg-danger/10 px-2 py-1 text-xs text-danger">Needs review</span>
    );
  }

  if (status === "connected") {
    return (
      <span className="flex items-center gap-1 rounded-md bg-success/10 px-2 py-1 text-xs text-success">
        <IconCheck size={12} stroke={2} />
        Connected
      </span>
    );
  }

  return <span className="rounded-md bg-white/5 px-2 py-1 text-xs text-fg-muted">Setup</span>;
}

function ModelKindBadge({ model }: { model: ProviderModelConfig }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs",
        model.reasoning ? "bg-white/7 text-fg-muted" : "bg-white/5 text-fg-faint",
      )}
    >
      {model.reasoning ? <IconBrain size={11} stroke={1.8} /> : null}
      {model.reasoning ? "thinking" : "standard"}
    </span>
  );
}

function TinyBadge({ children }: { children: string }) {
  return (
    <span className="rounded bg-white/5 px-1.5 py-0.5 text-2xs text-fg-faint">{children}</span>
  );
}

function EmptyState({ description, title }: { description: string; title: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <div className="text-sm text-fg-muted">{title}</div>
      <div className="mx-auto mt-1 max-w-[300px] text-xs text-fg-faint">{description}</div>
    </div>
  );
}

type ProviderStatus = "available" | "connected" | "error";
type ModelFilter = "all" | "enabled" | "thinking";

function providerStatus(provider: ModelProviderInfo): ProviderStatus {
  if (provider.error) {
    return "error";
  }
  if (provider.configured || provider.enabledModelCount > 0) {
    return "connected";
  }
  return "available";
}

function providerSummary(provider: ModelProviderInfo): string {
  if (provider.enabledModelCount > 0) {
    return `${provider.enabledModelCount} enabled · ${provider.modelCount} models`;
  }
  if (provider.configured) {
    return `${provider.modelCount} models · key configured`;
  }
  return `${provider.modelCount} models`;
}

function providerIdentity(provider: ModelProviderInfo): string {
  return provider.baseUrl ?? provider.authLabel ?? provider.authSource ?? "PI built-in provider";
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function providerMatchesQuery(provider: ModelProviderInfo, query: string): boolean {
  if (!query) {
    return true;
  }
  const haystack = [
    provider.name,
    provider.id,
    provider.source,
    provider.baseUrl,
    provider.authSource,
    provider.authLabel,
    provider.modelCount.toString(),
    provider.enabledModelCount.toString(),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function compareModelConfig(a: ProviderModelConfig, b: ProviderModelConfig): number {
  if (a.enabled !== b.enabled) {
    return a.enabled ? -1 : 1;
  }
  if (a.reasoning !== b.reasoning) {
    return a.reasoning ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

function modelMatchesFilter(model: ProviderModelConfig, filter: ModelFilter): boolean {
  if (filter === "enabled") {
    return model.enabled;
  }
  if (filter === "thinking") {
    return model.reasoning;
  }
  return true;
}

function modelMatchesQuery(model: ProviderModelConfig, query: string): boolean {
  if (!query) {
    return true;
  }
  const haystack = [
    model.name,
    model.id,
    model.contextWindow?.toString(),
    model.maxTokens?.toString(),
    model.thinkingLevel,
    model.reasoning ? "thinking reasoning" : "standard",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

type KeyValueRow = {
  rowId: string;
  key: string;
  value: string;
};

function CustomProviderForm({
  onCancel,
  onComplete,
  onError,
}: {
  onCancel(): void;
  onComplete(provider: string): void;
  onError(message: string | undefined): void;
}) {
  const [rows, setRows] = useState<CustomModelRow[]>(() => [createCustomModelRow()]);
  const [provider, setProvider] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [api, setApi] = useState("openai-completions");
  const [authHeader, setAuthHeader] = useState(true);
  const [providerHeaders, setProviderHeaders] = useState<KeyValueRow[]>(() => []);
  const [supportsDeveloperRole, setSupportsDeveloperRole] = useState(false);
  const [supportsReasoningEffort, setSupportsReasoningEffort] = useState(false);
  const [busy, setBusy] = useState(false);

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

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    onError(undefined);
    try {
      const modelInputs = rows.map(rowToModelInput);
      await window.modus.model.upsertCustomProvider({
        provider,
        name,
        baseUrl,
        apiKey,
        api,
        authHeader,
        headers: keyValueRowsToRecord(providerHeaders),
        compatibility: {
          supportsDeveloperRole,
          supportsReasoningEffort,
        },
        models: modelInputs,
      });
      onComplete(provider.trim().toLowerCase());
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const providerTitle = name.trim() || provider.trim() || "Custom OpenAI-compatible provider";
  const providerId = provider.trim() || "new-provider";
  const configuredHeaderCount = providerHeaders.filter(
    (row) => row.key.trim() || row.value.trim(),
  ).length;
  const thinkingModelCount = rows.filter((row) => row.reasoning).length;

  return (
    <m.form
      className="grid gap-6"
      layout
      onSubmit={(event) => void submit(event)}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      <CustomProviderOverview
        api={api}
        authHeader={authHeader}
        headerCount={configuredHeaderCount}
        modelCount={rows.length}
        providerId={providerId}
        thinkingModelCount={thinkingModelCount}
        title={providerTitle}
      />

      <SettingsFormSection
        description="Define the provider identity, endpoint, credentials, and protocol before enabling models."
        icon={<IconPlugConnected size={16} stroke={1.7} />}
        title="Connection"
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <Field
            description="Lowercase id used by Modus configuration."
            label="Provider id"
            onChange={setProvider}
            placeholder="my-relay"
            value={provider}
          />
          <Field
            description="Human-readable name shown in the model picker."
            label="Display name"
            onChange={setName}
            placeholder="My Relay"
            value={name}
          />
          <Field
            description="OpenAI-compatible endpoint including version path when required."
            label="Base URL"
            onChange={setBaseUrl}
            placeholder="https://api.example.com/v1"
            type="url"
            value={baseUrl}
          />
          <Field
            autoComplete="off"
            description="Stored through the provider configuration flow."
            label="API key"
            onChange={setApiKey}
            placeholder="sk-..."
            type="password"
            value={apiKey}
          />
          <SelectField label="API type" onChange={setApi} options={API_TYPE_OPTIONS} value={api} />
          <ToggleField
            checked={authHeader}
            description="Send the API key as an Authorization bearer token."
            label="Authorization header"
            onChange={setAuthHeader}
          />
        </div>
      </SettingsFormSection>

      <SettingsFormSection
        description="Expose only the capabilities the provider actually supports so composer controls stay honest."
        icon={<IconShieldCheck size={16} stroke={1.7} />}
        title="Provider compatibility"
      >
        <div className="grid gap-3 md:grid-cols-2">
          <ToggleField
            checked={supportsDeveloperRole}
            description="Allow system/developer instructions when the provider supports them."
            label="Developer role"
            onChange={setSupportsDeveloperRole}
          />
          <ToggleField
            checked={supportsReasoningEffort}
            description="Expose reasoning effort when this provider accepts that option."
            label="Reasoning effort"
            onChange={setSupportsReasoningEffort}
          />
        </div>
      </SettingsFormSection>

      <KeyValueEditor
        addLabel="Add header"
        description="Optional headers sent with every request to this provider."
        emptyLabel="No custom provider headers"
        icon={<IconVariable size={16} stroke={1.7} />}
        keyPlaceholder="Header"
        onAdd={() => setProviderHeaders((current) => [...current, createKeyValueRow()])}
        onChange={updateProviderHeader}
        onRemove={(rowId) =>
          setProviderHeaders((current) => current.filter((row) => row.rowId !== rowId))
        }
        rows={providerHeaders}
        title="Provider headers"
        valuePlaceholder="Value"
        variant="section"
      />

      <SettingsFormSection
        action={
          <button
            className="flex h-8 items-center gap-1.5 rounded-md border border-hairline bg-white/3 px-3 text-sm text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
            onClick={() => setRows((current) => [...current, createCustomModelRow()])}
            type="button"
          >
            <IconPlus size={14} stroke={1.8} />
            Add model
          </button>
        }
        description="Add the concrete model ids exposed by this custom endpoint, plus optional routing and capability overrides."
        icon={<IconCodeDots size={16} stroke={1.7} />}
        title="Custom models"
      >
        <AnimatePresence initial={false}>
          {rows.map((row, index) => (
            <CustomModelEditor
              index={index}
              key={row.rowId}
              onChange={(patch) => updateRow(row.rowId, patch)}
              onRemove={() => removeRow(row.rowId)}
              removable={rows.length > 1}
              row={row}
            />
          ))}
        </AnimatePresence>
      </SettingsFormSection>

      <m.div
        className="sticky bottom-0 z-10 flex justify-end gap-2 border-hairline-soft border-t bg-canvas/95 pt-4 pb-1 backdrop-blur"
        layout
      >
        <button
          className="h-9 rounded-md px-3 text-sm text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="flex h-9 items-center gap-2 rounded-md bg-fg px-3 text-sm text-canvas transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy}
          type="submit"
        >
          {busy ? <IconLoader2 className="animate-spin" size={13} stroke={1.8} /> : null}
          Save provider
        </button>
      </m.div>
    </m.form>
  );
}

type CustomModelRow = {
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
  thinkingOff: string;
  thinkingMinimal: string;
  thinkingLow: string;
  thinkingMedium: string;
  thinkingHigh: string;
  thinkingXHigh: string;
};

type ModelThinkingFormat =
  | "none"
  | "openai"
  | "openrouter"
  | "deepseek"
  | "together"
  | "zai"
  | "qwen"
  | "qwen-chat-template";

const API_TYPE_OPTIONS = [
  { label: "OpenAI chat completions", value: "openai-completions" },
  { label: "Anthropic messages", value: "anthropic-messages" },
  { label: "Google Gemini", value: "google-generative-ai" },
] as const;

const THINKING_FORMAT_OPTIONS = [
  { label: "None", value: "none" },
  { label: "OpenAI reasoning effort", value: "openai" },
  { label: "OpenRouter reasoning", value: "openrouter" },
  { label: "DeepSeek thinking", value: "deepseek" },
  { label: "Together reasoning", value: "together" },
  { label: "zAI enable thinking", value: "zai" },
  { label: "Qwen enable thinking", value: "qwen" },
  { label: "Qwen chat template", value: "qwen-chat-template" },
] as const;

const DEFAULT_THINKING_LEVEL_MAP: Partial<Record<ThinkingLevel, string | null>> = {
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
};

function createCustomModelRow(): CustomModelRow {
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
    thinkingOff: "",
    thinkingMinimal: "",
    thinkingLow: "low",
    thinkingMedium: "medium",
    thinkingHigh: "high",
    thinkingXHigh: "xhigh",
  };
}

function CustomModelEditor({
  row,
  index,
  removable,
  onChange,
  onRemove,
}: {
  row: CustomModelRow;
  index: number;
  removable: boolean;
  onChange(patch: Partial<CustomModelRow>): void;
  onRemove(): void;
}) {
  function updateHeader(rowId: string, patch: Partial<KeyValueRow>): void {
    onChange({
      headers: row.headers.map((header) =>
        header.rowId === rowId ? { ...header, ...patch } : header,
      ),
    });
  }

  return (
    <m.section
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-lg border border-hairline-soft bg-panel"
      exit={{ opacity: 0, y: -6 }}
      initial={{ opacity: 0, y: 6 }}
      layout
      transition={{ duration: 0.16, ease: "easeOut" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-hairline-soft border-b px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-hairline-soft bg-white/4 text-fg-subtle">
            <IconCodeDots size={16} stroke={1.7} />
          </span>
          <div className="min-w-0">
            <h4 className="truncate text-sm font-normal text-fg">
              {row.name.trim() || row.id.trim() || `Model ${index + 1}`}
            </h4>
            <p className="mt-1 truncate font-mono text-xs text-fg-faint">
              {row.id.trim() || "model-id"}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <FormMetaPill>{row.reasoning ? "thinking" : "standard"}</FormMetaPill>
              <FormMetaPill>{row.imageInput ? "text + image" : "text only"}</FormMetaPill>
              <FormMetaPill>
                {row.headers.filter((header) => header.key.trim() || header.value.trim()).length}{" "}
                headers
              </FormMetaPill>
            </div>
          </div>
        </div>
        <button
          aria-label="Remove model"
          className="flex size-8 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-35"
          disabled={!removable}
          onClick={onRemove}
          type="button"
        >
          <IconTrash size={14} stroke={1.7} />
        </button>
      </div>

      <div className="grid gap-6 px-5 py-5">
        <SettingsSubCard
          description="The ids that Modus stores and the names users see in the composer."
          title="Identity"
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <Field
              label="Model id"
              onChange={(value) => onChange({ id: value })}
              placeholder="qwen3-coder"
              value={row.id}
            />
            <Field
              label="Display name"
              onChange={(value) => onChange({ name: value })}
              placeholder="Qwen3 Coder"
              value={row.name}
            />
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
        </SettingsSubCard>

        <SettingsSubCard
          description="Leave these blank to inherit the provider-level endpoint and API behavior."
          title="Routing overrides"
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <Field
              label="Model API override"
              onChange={(value) => onChange({ api: value })}
              placeholder="provider default"
              value={row.api}
            />
            <Field
              label="Model base URL override"
              onChange={(value) => onChange({ baseUrl: value })}
              placeholder="provider default"
              type="url"
              value={row.baseUrl}
            />
          </div>
        </SettingsSubCard>

        <SettingsSubCard
          description="Describe model behavior so Modus can show the right composer affordances."
          title="Capabilities"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <ToggleField
              checked={row.reasoning}
              description="Expose thinking-level controls and optional level mapping."
              icon={<IconBrain size={15} stroke={1.7} />}
              label="Supports thinking"
              onChange={(value) => onChange({ reasoning: value })}
            />
            <ToggleField
              checked={row.imageInput}
              description="Allow image inputs for this model when the provider supports them."
              icon={<IconPhoto size={15} stroke={1.7} />}
              label="Image input"
              onChange={(value) => onChange({ imageInput: value })}
            />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <SelectField
              label="Thinking format"
              onChange={(value) => onChange({ thinkingFormat: value as ModelThinkingFormat })}
              options={THINKING_FORMAT_OPTIONS}
              value={row.thinkingFormat}
            />
            <ToggleField
              checked={row.supportsUsageInStreaming}
              description="Read token usage from streaming responses when supported."
              label="Streaming usage"
              onChange={(value) => onChange({ supportsUsageInStreaming: value })}
            />
          </div>
        </SettingsSubCard>

        <SettingsSubCard
          description="Optional per-million token prices used for display and budgeting metadata."
          title="Pricing"
        >
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            <Field
              label="Input cost"
              onChange={(value) => onChange({ costInput: value })}
              placeholder="0"
              value={row.costInput}
            />
            <Field
              label="Output cost"
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
        </SettingsSubCard>

        <AnimatePresence initial={false}>
          {row.reasoning ? (
            <m.div
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              initial={{ opacity: 0, y: -6 }}
              key="thinking-levels"
              layout
              transition={{ duration: 0.16, ease: "easeOut" }}
            >
              <SettingsSubCard
                description="Map Modus thinking presets to provider-specific values."
                title="Thinking levels"
              >
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  <Field
                    label="Off"
                    onChange={(value) => onChange({ thinkingOff: value })}
                    placeholder="leave blank"
                    value={row.thinkingOff}
                  />
                  <Field
                    label="Minimal"
                    onChange={(value) => onChange({ thinkingMinimal: value })}
                    placeholder="leave blank if unsupported"
                    value={row.thinkingMinimal}
                  />
                  <Field
                    label="Low"
                    onChange={(value) => onChange({ thinkingLow: value })}
                    placeholder="low"
                    value={row.thinkingLow}
                  />
                  <Field
                    label="Medium"
                    onChange={(value) => onChange({ thinkingMedium: value })}
                    placeholder="medium"
                    value={row.thinkingMedium}
                  />
                  <Field
                    label="High"
                    onChange={(value) => onChange({ thinkingHigh: value })}
                    placeholder="high"
                    value={row.thinkingHigh}
                  />
                  <Field
                    label="Extra high"
                    onChange={(value) => onChange({ thinkingXHigh: value })}
                    placeholder="xhigh"
                    value={row.thinkingXHigh}
                  />
                </div>
              </SettingsSubCard>
            </m.div>
          ) : null}
        </AnimatePresence>

        <KeyValueEditor
          addLabel="Add model header"
          description="Headers here override or extend the provider defaults for this model."
          emptyLabel="No model-specific headers"
          icon={<IconVariable size={16} stroke={1.7} />}
          keyPlaceholder="Header"
          onAdd={() => onChange({ headers: [...row.headers, createKeyValueRow()] })}
          onChange={updateHeader}
          onRemove={(rowId) =>
            onChange({ headers: row.headers.filter((header) => header.rowId !== rowId) })
          }
          rows={row.headers}
          title="Model headers"
          valuePlaceholder="Value"
          variant="embedded"
        />
      </div>
    </m.section>
  );
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const next = Number(value.replaceAll(",", ""));
  return Number.isInteger(next) && next > 0 ? next : undefined;
}

function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const next = Number(value.replaceAll(",", ""));
  if (!Number.isFinite(next) || next < 0) {
    throw new Error(`Invalid number: ${value}`);
  }
  return next;
}

function rowToModelInput(row: CustomModelRow): CustomProviderModelInput {
  const id = row.id.trim();
  if (!id) {
    throw new Error("Every custom model needs a model id.");
  }

  const input: ModelInputKind[] = row.imageInput ? ["text", "image"] : ["text"];
  const thinkingLevelMap = row.reasoning ? customThinkingLevelMap(row) : undefined;
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
      thinkingFormat: row.thinkingFormat,
      supportsUsageInStreaming: row.supportsUsageInStreaming,
    },
  };
}

function hasDefinedCost(cost: {
  input?: number | undefined;
  output?: number | undefined;
  cacheRead?: number | undefined;
  cacheWrite?: number | undefined;
}): boolean {
  return Object.values(cost).some((value) => value !== undefined);
}

function customThinkingLevelMap(
  row: CustomModelRow,
): Partial<Record<ThinkingLevel, string | null>> {
  const values: Partial<Record<ThinkingLevel, string | null>> = {};
  if (row.thinkingOff.trim()) values.off = row.thinkingOff.trim();
  values.minimal = row.thinkingMinimal.trim() || null;
  if (row.thinkingLow.trim()) values.low = row.thinkingLow.trim();
  if (row.thinkingMedium.trim()) values.medium = row.thinkingMedium.trim();
  if (row.thinkingHigh.trim()) values.high = row.thinkingHigh.trim();
  if (row.thinkingXHigh.trim()) values.xhigh = row.thinkingXHigh.trim();
  return Object.keys(values).length > 1 ? values : DEFAULT_THINKING_LEVEL_MAP;
}

function createKeyValueRow(): KeyValueRow {
  return { rowId: crypto.randomUUID(), key: "", value: "" };
}

function keyValueRowsToRecord(rows: KeyValueRow[]): Record<string, string> | undefined {
  const result = Object.fromEntries(
    rows
      .map((row) => [row.key.trim(), row.value.trim()] as const)
      .filter(([key, value]) => key && value),
  );
  return Object.keys(result).length > 0 ? result : undefined;
}

function CustomProviderOverview({
  api,
  authHeader,
  headerCount,
  modelCount,
  providerId,
  thinkingModelCount,
  title,
}: {
  api: string;
  authHeader: boolean;
  headerCount: number;
  modelCount: number;
  providerId: string;
  thinkingModelCount: number;
  title: string;
}) {
  return (
    <m.section
      className="rounded-lg border border-hairline-soft bg-panel px-5 py-5"
      layout
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg border border-hairline-soft bg-white/4 text-fg-subtle">
            <IconAdjustments size={17} stroke={1.7} />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-normal text-fg">{title}</h3>
            <p className="mt-1 truncate font-mono text-xs text-fg-faint">{providerId}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <FormMetaPill>{optionLabel(API_TYPE_OPTIONS, api)}</FormMetaPill>
              <FormMetaPill>{modelCount} models</FormMetaPill>
              <FormMetaPill>{thinkingModelCount} thinking</FormMetaPill>
              <FormMetaPill>{headerCount} headers</FormMetaPill>
              <FormMetaPill>{authHeader ? "bearer auth" : "manual auth"}</FormMetaPill>
            </div>
          </div>
        </div>
      </div>
    </m.section>
  );
}

function SettingsFormSection({
  action,
  children,
  description,
  icon,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <m.section
      className="overflow-hidden rounded-lg border border-hairline-soft bg-panel"
      layout
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-hairline-soft border-b px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-hairline-soft bg-white/4 text-fg-subtle">
            {icon}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-normal text-fg">{title}</h3>
            <p className="mt-1 max-w-[640px] text-xs leading-5 text-fg-faint">{description}</p>
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="grid gap-6 px-5 py-5">{children}</div>
    </m.section>
  );
}

function SettingsSubCard({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="grid gap-4 border-hairline-soft border-t pt-5 first:border-t-0 first:pt-0">
      <div>
        <h4 className="text-xs font-normal text-fg-muted">{title}</h4>
        <p className="mt-1 max-w-[620px] text-xs leading-5 text-fg-faint">{description}</p>
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

function Field({
  autoComplete,
  description,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  autoComplete?: string;
  description?: string;
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder: string;
  type?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs text-fg-muted">{label}</span>
      <input
        autoComplete={autoComplete}
        className="h-10 w-full rounded-md border border-hairline bg-canvas px-3 text-sm text-fg outline-none placeholder:text-fg-faint transition-colors hover:border-hairline-strong focus:border-hairline-strong focus:ring-2 focus:ring-white/5"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
      {description ? <span className="text-xs leading-5 text-fg-faint">{description}</span> : null}
    </label>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { label: string; value: T }[];
  onChange(value: T): void;
}) {
  return (
    <div className="grid gap-2">
      <span className="text-xs text-fg-muted">{label}</span>
      <Select.Root
        onValueChange={(next) => {
          if (typeof next === "string") {
            onChange(next as T);
          }
        }}
        value={value}
      >
        <Select.Trigger
          aria-label={label}
          className="flex h-10 w-full items-center justify-between gap-3 rounded-md border border-hairline bg-canvas px-3 text-sm text-fg outline-none transition-colors hover:border-hairline-strong focus-visible:border-hairline-strong focus-visible:ring-2 focus-visible:ring-white/5 data-popup-open:border-hairline-strong"
        >
          <Select.Value>{(selected) => optionLabel(options, String(selected))}</Select.Value>
          <Select.Icon>
            <IconChevronDown className="text-fg-faint" size={14} stroke={1.8} />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner
            align="start"
            alignItemWithTrigger={false}
            collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
            side="bottom"
            sideOffset={5}
          >
            <Select.Popup className="scroll-thin origin-(--transform-origin) min-w-[var(--anchor-width)] overflow-y-auto rounded-lg border border-hairline bg-elevated p-1 shadow-popup transition-[transform,opacity] duration-100 data-[side=bottom]:data-ending-style:translate-y-[-4px] data-[side=bottom]:data-starting-style:translate-y-[-4px] data-[side=top]:data-ending-style:translate-y-[4px] data-[side=top]:data-starting-style:translate-y-[4px] data-ending-style:opacity-0 data-starting-style:opacity-0">
              {options.map((option) => (
                <Select.Item
                  className="grid h-8 cursor-default grid-cols-[minmax(0,1fr)_16px] items-center gap-2 rounded-md px-2 text-sm text-fg-muted outline-none select-none data-highlighted:bg-hover data-highlighted:text-fg"
                  key={option.value}
                  value={option.value}
                >
                  <Select.ItemText className="min-w-0 truncate">{option.label}</Select.ItemText>
                  <span className="flex justify-center text-fg">
                    <Select.ItemIndicator>
                      <IconCheck size={13} stroke={2} />
                    </Select.ItemIndicator>
                  </span>
                </Select.Item>
              ))}
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

function ToggleField({
  checked,
  description,
  icon,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  icon?: ReactNode;
  label: string;
  onChange(value: boolean): void;
}) {
  return (
    <div className="flex min-h-[76px] items-center justify-between gap-4 rounded-md border border-hairline-soft bg-canvas/45 px-4 py-3 transition-colors hover:bg-hover">
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-white/4 text-fg-subtle">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0">
          <span className="block text-sm text-fg">{label}</span>
          <span className="mt-1 block text-xs leading-5 text-fg-faint">{description}</span>
        </span>
      </div>
      <SwitchControl ariaLabel={label} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function KeyValueEditor({
  addLabel,
  description,
  emptyLabel,
  icon,
  keyPlaceholder,
  rows,
  title,
  valuePlaceholder,
  variant,
  onAdd,
  onChange,
  onRemove,
}: {
  addLabel: string;
  description: string;
  emptyLabel: string;
  icon?: ReactNode;
  keyPlaceholder: string;
  rows: KeyValueRow[];
  title: string;
  valuePlaceholder: string;
  variant: "section" | "embedded";
  onAdd(): void;
  onChange(rowId: string, patch: Partial<KeyValueRow>): void;
  onRemove(rowId: string): void;
}) {
  const header = (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-hairline-soft bg-white/4 text-fg-subtle">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h3 className="text-sm font-normal text-fg">{title}</h3>
          <p className="mt-1 max-w-[620px] text-xs leading-5 text-fg-faint">{description}</p>
        </div>
      </div>
      <button
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-hairline bg-white/3 px-3 text-sm text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
        onClick={onAdd}
        type="button"
      >
        <IconPlus size={14} stroke={1.8} />
        {addLabel}
      </button>
    </div>
  );

  const body = (
    <div className="grid gap-3">
      <AnimatePresence initial={false}>
        {rows.map((row) => (
          <m.div
            animate={{ opacity: 1, y: 0 }}
            className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_40px]"
            exit={{ opacity: 0, y: -4 }}
            initial={{ opacity: 0, y: 4 }}
            key={row.rowId}
            layout
            transition={{ duration: 0.14, ease: "easeOut" }}
          >
            <input
              aria-label={`${title} key`}
              className="h-10 rounded-md border border-hairline bg-canvas px-3 text-sm text-fg outline-none placeholder:text-fg-faint transition-colors hover:border-hairline-strong focus:border-hairline-strong focus:ring-2 focus:ring-white/5"
              onChange={(event) => onChange(row.rowId, { key: event.target.value })}
              placeholder={keyPlaceholder}
              value={row.key}
            />
            <input
              aria-label={`${title} value`}
              className="h-10 rounded-md border border-hairline bg-canvas px-3 text-sm text-fg outline-none placeholder:text-fg-faint transition-colors hover:border-hairline-strong focus:border-hairline-strong focus:ring-2 focus:ring-white/5"
              onChange={(event) => onChange(row.rowId, { value: event.target.value })}
              placeholder={valuePlaceholder}
              value={row.value}
            />
            <button
              aria-label="Remove row"
              className="flex size-10 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg"
              onClick={() => onRemove(row.rowId)}
              type="button"
            >
              <IconTrash size={14} stroke={1.7} />
            </button>
          </m.div>
        ))}
      </AnimatePresence>
      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-hairline-soft bg-canvas/35 px-4 py-4 text-sm text-fg-faint">
          {emptyLabel}
        </div>
      ) : null}
    </div>
  );

  if (variant === "section") {
    return (
      <m.section
        className="overflow-hidden rounded-lg border border-hairline-soft bg-panel"
        layout
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        <div className="border-hairline-soft border-b px-5 py-4">{header}</div>
        <div className="px-5 py-5">{body}</div>
      </m.section>
    );
  }

  return (
    <section className="grid gap-4 border-hairline-soft border-t pt-5">
      {header}
      {body}
    </section>
  );
}

function FormMetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-white/5 px-2.5 py-1 text-xs text-fg-muted">{children}</span>
  );
}

function optionLabel<T extends string>(
  options: readonly { label: string; value: T }[],
  value: string,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}
