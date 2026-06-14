import { Dialog } from "@base-ui/react/dialog";
import { Switch } from "@base-ui/react/switch";
import {
  IconAdjustments,
  IconArrowLeft,
  IconBrain,
  IconCheck,
  IconChevronRight,
  IconCircleCheck,
  IconCodeDots,
  IconCube,
  IconEdit,
  IconFilter,
  IconGavel,
  IconKey,
  IconLoader2,
  IconMoon,
  IconPalette,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconServerCog,
  IconSettings,
  IconSun,
  IconTerminal2,
  IconTrash,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { AnimatePresence, m } from "motion/react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { joinCommandLine, splitCommandLine } from "../../../../shared/command-line";
import type {
  CustomProviderConfig,
  McpServerInfo,
  ModelProviderDetail,
  ModelProviderInfo,
  ModelSettingsState,
  ProviderModelConfig,
  RuleFileInfo,
  RuleMode,
  RuleSource,
  SkillInfo,
  ThinkingLevel,
} from "../../../../shared/contracts";
import { CollapsibleMotion } from "../../components/ui/CollapsibleMotion";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";
import { type ThemeMode, useTheme } from "../../lib/theme";
import { CustomProviderForm } from "./CustomProviderForm";
import { Field, parsePositiveInteger, SelectField, SwitchControl } from "./form-controls";
import { groupProviderModels, modelResultLabel } from "./modelListUtils";
import { ProviderLogo } from "./ProviderLogo";

type SettingsPanelProps = {
  open: boolean;
  state: ModelSettingsState | null;
  onClose(): void;
  onRefresh(): void;
  /** Active workspace root — enables the MCP section's config + sync actions. */
  workspaceCwd?: string | undefined;
};

type SettingsSectionId = "general" | "model-provider" | "appearance" | "skills" | "mcp" | "rules";

export function SettingsPanel({
  open,
  state,
  onClose,
  onRefresh,
  workspaceCwd,
}: SettingsPanelProps) {
  const [selectedProvider, setSelectedProvider] = useState<string | undefined>();
  const [detail, setDetail] = useState<ModelProviderDetail | undefined>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [providerDetailOpen, setProviderDetailOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customInitial, setCustomInitial] = useState<CustomProviderConfig | undefined>();
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
  const currentProvider = providers.find((provider) => provider.id === selectedProvider);

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

  async function connectProvider(
    provider: ModelProviderInfo,
    apiKey?: string,
    baseUrl?: string,
  ): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const providerDetail: ModelProviderDetail | undefined =
        await window.modus.model.providerDetail(provider.id);
      await window.modus.model.configureProvider({
        provider: provider.id,
        apiKey: apiKey?.trim(),
        ...(baseUrl !== undefined ? { baseUrl } : {}),
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

  async function editModel(
    model: ProviderModelConfig,
    patch: { thinkingLevel?: ThinkingLevel; contextWindow?: number; maxTokens?: number },
  ): Promise<void> {
    if (!detail) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await window.modus.model.updateConfig({ model: `${detail.id}/${model.id}`, ...patch });
      onRefresh();
      setDetail(await window.modus.model.providerDetail(detail.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function openCustomEditor(providerId: string): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const config = await window.modus.model.customProviderConfig(providerId);
      setCustomInitial(config ?? undefined);
      setActiveSection("model-provider");
      setProviderDetailOpen(false);
      setCustomOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteProvider(provider: ModelProviderInfo): Promise<void> {
    const confirmed = window.confirm(
      `Remove "${provider.name}"? This deletes its local configuration and models from Modus.`,
    );
    if (!confirmed) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await window.modus.model.deleteCustomProvider(provider.id);
      if (selectedProvider === provider.id) {
        setSelectedProvider(undefined);
        setDetail(undefined);
        setProviderDetailOpen(false);
      }
      setCustomOpen(false);
      setCustomInitial(undefined);
      onRefresh();
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
        onSectionChange={setActiveSection}
        query={settingsQuery}
      />

      <main className="scroll-thin min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-8 px-10 pt-16 pb-12">
          {activeSection === "general" ? <GeneralSettingsPanel /> : null}
          {activeSection === "appearance" ? <AppearanceSettingsPanel /> : null}
          {activeSection === "skills" ? <SkillsSettingsPanel cwd={workspaceCwd} /> : null}
          {activeSection === "mcp" ? <McpSettingsPanel cwd={workspaceCwd} /> : null}
          {activeSection === "rules" ? <RulesSettingsPanel cwd={workspaceCwd} /> : null}
          {activeSection === "model-provider" ? (
            <ModelProviderSettingsPanel
              busy={busy}
              connected={connected}
              currentProvider={currentProvider}
              customInitial={customInitial}
              customOpen={customOpen}
              detail={detail}
              detailLoading={detailLoading}
              error={error}
              keyValue={detail ? (providerKeys[detail.id] ?? "") : ""}
              providerDetailOpen={providerDetailOpen}
              onConnectProvider={(provider, apiKey, baseUrl) =>
                void connectProvider(provider, apiKey, baseUrl)
              }
              onCustomCancel={() => {
                setCustomOpen(false);
                setCustomInitial(undefined);
              }}
              onCustomComplete={(provider) => {
                setCustomOpen(false);
                setCustomInitial(undefined);
                setDetail(undefined);
                setDetailLoading(true);
                setSelectedProvider(provider);
                setProviderDetailOpen(true);
                setActiveSection("model-provider");
                onRefresh();
              }}
              onCustomOpen={() => {
                setCustomInitial(undefined);
                setProviderDetailOpen(false);
                setCustomOpen(true);
                setActiveSection("model-provider");
              }}
              onEditModel={(model, patch) => void editModel(model, patch)}
              onEditProvider={(providerId) => void openCustomEditor(providerId)}
              onDeleteProvider={(provider) => void deleteProvider(provider)}
              onError={setError}
              onKeyChange={(apiKey) => {
                if (!detail) {
                  return;
                }
                setProviderKeys((current) => ({ ...current, [detail.id]: apiKey }));
              }}
              onProviderDetailClose={() => {
                setProviderDetailOpen(false);
                setSelectedProvider(undefined);
                setDetail(undefined);
                setDetailLoading(false);
              }}
              onRefresh={onRefresh}
              onSelectProvider={(provider) => {
                setCustomOpen(false);
                setDetail(undefined);
                setDetailLoading(true);
                setSelectedProvider(provider.id);
                setProviderDetailOpen(true);
              }}
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
          <SettingsNavItem
            active={activeSection === "mcp"}
            icon={<IconPlugConnected size={16} stroke={1.7} />}
            onClick={() => onSectionChange("mcp")}
          >
            MCP
          </SettingsNavItem>
          <SettingsNavItem
            active={activeSection === "skills"}
            icon={<IconCube size={16} stroke={1.7} />}
            onClick={() => onSectionChange("skills")}
          >
            Skills
          </SettingsNavItem>
          <SettingsNavItem
            active={activeSection === "rules"}
            icon={<IconGavel size={16} stroke={1.7} />}
            onClick={() => onSectionChange("rules")}
          >
            Rules
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
  customInitial,
  customOpen,
  detail,
  detailLoading,
  error,
  keyValue,
  popular,
  providerDetailOpen,
  onConnectProvider,
  onCustomCancel,
  onCustomComplete,
  onCustomOpen,
  onDeleteProvider,
  onEditModel,
  onEditProvider,
  onError,
  onKeyChange,
  onProviderDetailClose,
  onRefresh,
  onSelectProvider,
  onToggleModel,
}: {
  busy: boolean;
  connected: ModelProviderInfo[];
  currentProvider: ModelProviderInfo | undefined;
  customInitial: CustomProviderConfig | undefined;
  customOpen: boolean;
  detail: ModelProviderDetail | undefined;
  detailLoading: boolean;
  error: string | undefined;
  keyValue: string;
  popular: ModelProviderInfo[];
  providerDetailOpen: boolean;
  onConnectProvider(provider: ModelProviderInfo, apiKey?: string, baseUrl?: string): void;
  onCustomCancel(): void;
  onCustomComplete(provider: string): void;
  onCustomOpen(): void;
  onDeleteProvider(provider: ModelProviderInfo): void;
  onEditModel(
    model: ProviderModelConfig,
    patch: { thinkingLevel?: ThinkingLevel; contextWindow?: number; maxTokens?: number },
  ): void;
  onEditProvider(providerId: string): void;
  onError(message: string | undefined): void;
  onKeyChange(apiKey: string): void;
  onProviderDetailClose(): void;
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
              Connect custom provider
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

      <div className="grid gap-5">
        <ProviderCatalog
          connected={connected}
          currentProvider={currentProvider}
          onDeleteProvider={onDeleteProvider}
          onQueryChange={setProviderQuery}
          onSelectProvider={onSelectProvider}
          popular={popular}
          query={providerQuery}
        />
      </div>

      <ProviderDetailDialog
        busy={busy}
        detail={detail}
        detailLoading={detailLoading}
        keyValue={keyValue}
        open={providerDetailOpen}
        onClose={onProviderDetailClose}
        onConnectProvider={onConnectProvider}
        onEditModel={onEditModel}
        onEditProvider={onEditProvider}
        onKeyChange={onKeyChange}
        onToggleModel={onToggleModel}
      />

      <CustomProviderDialog
        initial={customInitial}
        open={customOpen}
        onCancel={onCustomCancel}
        onComplete={onCustomComplete}
        onError={onError}
      />
    </>
  );
}

function ProviderCatalog({
  connected,
  currentProvider,
  popular,
  query,
  onDeleteProvider,
  onQueryChange,
  onSelectProvider,
}: {
  connected: ModelProviderInfo[];
  currentProvider: ModelProviderInfo | undefined;
  popular: ModelProviderInfo[];
  query: string;
  onDeleteProvider(provider: ModelProviderInfo): void;
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
          <h3 className="text-sm font-normal text-fg">Providers</h3>
          <p className="mt-1 text-xs text-fg-faint">
            Connected, available, and custom providers in one place.
          </p>
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

        <div className="scroll-thin max-h-[min(560px,calc(100vh-280px))] min-h-[320px] overflow-y-auto p-2">
          {visibleCount > 0 ? (
            <>
              <ProviderGroup title="Connected">
                {visibleConnected.map((provider) => (
                  <ProviderCatalogRow
                    active={provider.id === currentProvider?.id}
                    key={provider.id}
                    onClick={() => onSelectProvider(provider)}
                    onDelete={
                      provider.source === "custom" ? () => onDeleteProvider(provider) : undefined
                    }
                    provider={provider}
                  />
                ))}
              </ProviderGroup>

              <ProviderGroup title="Available">
                {visiblePopular.map((provider) => (
                  <ProviderCatalogRow
                    active={provider.id === currentProvider?.id}
                    key={provider.id}
                    onClick={() => onSelectProvider(provider)}
                    onDelete={
                      provider.source === "custom" ? () => onDeleteProvider(provider) : undefined
                    }
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

function ProviderConfigDialogShell({
  children,
  description,
  open,
  title,
  closeLabel,
  onClose,
}: {
  children: ReactNode;
  description?: string;
  open: boolean;
  title: string;
  closeLabel: string;
  onClose(): void;
}) {
  return (
    <Dialog.Root
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-fg/20 backdrop-blur-[1px] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden px-6 py-6">
          <Dialog.Popup className="flex h-[min(820px,calc(100vh-48px))] w-full max-w-[760px] flex-col overflow-hidden rounded-lg border border-hairline-soft bg-canvas shadow-popup outline-none transition-[opacity,transform] duration-150 data-ending-style:translate-y-2 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0">
            <div className="flex h-[52px] items-center justify-between gap-3 px-5">
              <Dialog.Close
                aria-label={`Back from ${title}`}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg"
              >
                <IconArrowLeft size={16} stroke={1.7} />
              </Dialog.Close>
              <Dialog.Close
                aria-label={closeLabel}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg"
              >
                <IconX size={16} stroke={1.7} />
              </Dialog.Close>
            </div>
            <div className="sr-only">
              <Dialog.Title>{title}</Dialog.Title>
              {description ? <Dialog.Description>{description}</Dialog.Description> : null}
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ProviderDetailDialog({
  busy,
  detail,
  detailLoading,
  keyValue,
  open,
  onClose,
  onConnectProvider,
  onEditModel,
  onEditProvider,
  onKeyChange,
  onToggleModel,
}: {
  busy: boolean;
  detail: ModelProviderDetail | undefined;
  detailLoading: boolean;
  keyValue: string;
  open: boolean;
  onClose(): void;
  onConnectProvider(provider: ModelProviderInfo, apiKey?: string, baseUrl?: string): void;
  onEditModel(
    model: ProviderModelConfig,
    patch: { thinkingLevel?: ThinkingLevel; contextWindow?: number; maxTokens?: number },
  ): void;
  onEditProvider(providerId: string): void;
  onKeyChange(apiKey: string): void;
  onToggleModel(model: ProviderModelConfig, enabled: boolean): void;
}) {
  const title = detail ? `Configure ${detail.name}` : "Configure provider";

  return (
    <ProviderConfigDialogShell
      closeLabel="Close provider configuration"
      description="Connect provider credentials and choose which models Modus should expose."
      open={open}
      title={title}
      onClose={onClose}
    >
      {detailLoading ? (
        <ProviderDetailLoading />
      ) : detail ? (
        <ProviderDetail
          busy={busy}
          detail={detail}
          key={detail.id}
          keyValue={keyValue}
          onConnect={(apiKey, baseUrl) => onConnectProvider(detail, apiKey, baseUrl)}
          onEditModel={onEditModel}
          onEditProvider={onEditProvider}
          onKeyChange={onKeyChange}
          onToggleModel={onToggleModel}
        />
      ) : (
        <EmptyState
          description="The selected provider is not available anymore. Close this panel and choose another provider."
          title="Provider unavailable"
        />
      )}
    </ProviderConfigDialogShell>
  );
}

function CustomProviderDialog({
  initial,
  open,
  onCancel,
  onComplete,
  onError,
}: {
  initial: CustomProviderConfig | undefined;
  open: boolean;
  onCancel(): void;
  onComplete(provider: string): void;
  onError(message: string | undefined): void;
}) {
  const title = initial ? `Edit ${initial.name || initial.provider}` : "Connect custom provider";

  return (
    <ProviderConfigDialogShell
      closeLabel="Close custom provider dialog"
      description="Connect an OpenAI, Anthropic or Gemini compatible endpoint and choose the models Modus should expose."
      open={open}
      title={title}
      onClose={onCancel}
    >
      <CustomProviderForm
        initial={initial}
        key={initial?.provider ?? "new-custom-provider"}
        onCancel={onCancel}
        onComplete={onComplete}
        onError={onError}
      />
    </ProviderConfigDialogShell>
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
  const [theme, setTheme] = useTheme();
  return (
    <>
      <SettingsPageHeader
        description="Visual preferences aligned with the current Modus desktop theme."
        title="Appearance"
      />
      <SettingsSection title="Theme">
        <SettingsList>
          <SettingsRow
            control={<ThemeToggle onChange={setTheme} value={theme} />}
            description="Switch between the dark and light desktop palettes."
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

const MCP_STATUS_STYLE: Record<McpServerInfo["status"], { dot: string; label: string }> = {
  connected: { dot: "bg-success", label: "Connected" },
  connecting: { dot: "bg-focus-ring-soft", label: "Connecting" },
  failed: { dot: "bg-danger", label: "Failed" },
  disabled: { dot: "bg-fg-faint", label: "Disabled" },
};

/** One-click starting points so first-time users never face an empty form. */
const MCP_PRESETS: ReadonlyArray<{ label: string; name: string; command: string }> = [
  {
    label: "Filesystem",
    name: "filesystem",
    command: "npx -y @modelcontextprotocol/server-filesystem .",
  },
  { label: "Fetch", name: "fetch", command: "npx -y @modelcontextprotocol/server-fetch" },
  { label: "Memory", name: "memory", command: "npx -y @modelcontextprotocol/server-memory" },
];

type KeyValuePair = { id: string; key: string; value: string };

type McpFormState = {
  /** undefined = creating; otherwise the server being edited. */
  originalName: string | undefined;
  name: string;
  transport: "stdio" | "http";
  commandLine: string;
  url: string;
  env: KeyValuePair[];
  headers: KeyValuePair[];
  enabled: boolean;
};

const emptyMcpForm = (): McpFormState => ({
  originalName: undefined,
  name: "",
  transport: "stdio",
  commandLine: "",
  url: "",
  env: [],
  headers: [],
  enabled: true,
});

const pair = (key = "", value = ""): KeyValuePair => ({ id: crypto.randomUUID(), key, value });

const pairsToRecord = (pairs: KeyValuePair[]): Record<string, string> =>
  Object.fromEntries(
    pairs.filter((item) => item.key.trim()).map((item) => [item.key.trim(), item.value]),
  );

const recordToPairs = (record: unknown): KeyValuePair[] =>
  typeof record === "object" && record !== null
    ? Object.entries(record as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([key, value]) => pair(key, value))
    : [];

/**
 * MCP server management — fully graphical. Add/edit/toggle/delete servers
 * without touching JSON; Modus writes the Cursor-compatible mcp.json behind
 * the scenes (the file stays available for power users).
 */
function McpSettingsPanel({ cwd }: { cwd: string | undefined }) {
  const [serverList, setServerList] = useState<McpServerInfo[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mcpError, setMcpError] = useState<string | undefined>();
  const [form, setForm] = useState<McpFormState | undefined>();
  const [confirmingDelete, setConfirmingDelete] = useState<string | undefined>();

  async function refresh(sync: boolean): Promise<void> {
    setMcpError(undefined);
    try {
      if (sync && cwd) {
        setSyncing(true);
        setServerList(await window.modus.mcp.sync(cwd));
      } else {
        setServerList(await window.modus.mcp.list());
      }
    } catch (err) {
      setMcpError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: initial load only — refresh is stable per render and sync runs on demand.
  useEffect(() => {
    void refresh(false);
  }, []);

  async function openEdit(server: McpServerInfo): Promise<void> {
    if (!cwd) return;
    setMcpError(undefined);
    try {
      const raw = await window.modus.mcp.entry({ cwd, name: server.name });
      const entry = raw?.entry ?? {};
      const command = typeof entry.command === "string" ? entry.command : "";
      const args = Array.isArray(entry.args)
        ? entry.args.filter((item: unknown): item is string => typeof item === "string")
        : [];
      setForm({
        originalName: server.name,
        name: server.name,
        transport: typeof entry.url === "string" ? "http" : "stdio",
        commandLine: command ? joinCommandLine([command, ...args]) : "",
        url: typeof entry.url === "string" ? entry.url : "",
        env: recordToPairs(entry.env),
        headers: recordToPairs(entry.headers),
        enabled: server.status !== "disabled",
      });
    } catch (err) {
      setMcpError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveForm(current: McpFormState): Promise<void> {
    if (!cwd) return;
    setSaving(true);
    setMcpError(undefined);
    try {
      const [command, ...args] = splitCommandLine(current.commandLine);
      setServerList(
        await window.modus.mcp.upsert({
          cwd,
          name: current.name.trim(),
          originalName: current.originalName,
          transport: current.transport,
          enabled: current.enabled,
          ...(current.transport === "stdio"
            ? { command: command ?? "", args, env: pairsToRecord(current.env) }
            : { url: current.url.trim(), headers: pairsToRecord(current.headers) }),
        }),
      );
      setForm(undefined);
    } catch (err) {
      setMcpError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleServer(server: McpServerInfo, enabled: boolean): Promise<void> {
    if (!cwd) return;
    setMcpError(undefined);
    try {
      setServerList(await window.modus.mcp.setEnabled({ cwd, name: server.name, enabled }));
    } catch (err) {
      setMcpError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteServer(server: McpServerInfo): Promise<void> {
    if (!cwd) return;
    setMcpError(undefined);
    setConfirmingDelete(undefined);
    try {
      setServerList(await window.modus.mcp.delete({ cwd, name: server.name }));
    } catch (err) {
      setMcpError(err instanceof Error ? err.message : String(err));
    }
  }

  function sourceBadge(source: string): string {
    if (cwd && source.startsWith(cwd)) {
      return source.includes(".cursor") ? "project · .cursor" : "project";
    }
    return "user";
  }

  return (
    <>
      <SettingsPageHeader
        actions={
          <>
            <button
              className="flex h-8 items-center gap-1.5 rounded-md border border-hairline bg-surface px-2.5 text-xs text-fg transition-colors hover:bg-hover disabled:opacity-40"
              disabled={!cwd || syncing}
              onClick={() => void refresh(true)}
              type="button"
            >
              {syncing ? (
                <IconLoader2 className="animate-spin" size={14} stroke={1.7} />
              ) : (
                <IconRefresh size={14} stroke={1.7} />
              )}
              {syncing ? "Connecting…" : "Reload"}
            </button>
            <button
              className="flex h-8 items-center gap-1.5 rounded-md bg-fg px-2.5 text-canvas text-xs transition-colors hover:bg-fg-muted disabled:opacity-40"
              disabled={!cwd}
              onClick={() => {
                setConfirmingDelete(undefined);
                setForm((current) => (current ? undefined : emptyMcpForm()));
              }}
              type="button"
            >
              <IconPlus size={14} stroke={2} />
              Add server
            </button>
          </>
        }
        description="Give the agent extra tools — databases, issue trackers, web search and more — by connecting Model Context Protocol servers. No JSON required."
        title="MCP"
      />

      {mcpError ? <p className="-mt-4 text-danger text-xs">{mcpError}</p> : null}

      <CollapsibleMotion open={Boolean(form && cwd)} preset="default">
        {form ? (
          <McpServerForm
            busy={saving}
            form={form}
            isNew={form.originalName === undefined}
            onCancel={() => setForm(undefined)}
            onChange={setForm}
            onSubmit={(state) => void saveForm(state)}
          />
        ) : null}
      </CollapsibleMotion>

      <SettingsSection title="Servers">
        {serverList.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-hairline-soft bg-panel px-5 py-6">
            <p className="text-sm text-fg-muted">
              {cwd
                ? "No MCP servers yet. Add one to unlock extra agent tools — try a starter:"
                : "Open a workspace to configure MCP servers."}
            </p>
            {cwd ? (
              <div className="flex flex-wrap gap-1.5">
                {MCP_PRESETS.map((preset) => (
                  <button
                    className="flex h-7 items-center gap-1.5 rounded-md border border-hairline bg-surface px-2.5 text-xs text-fg transition-colors hover:bg-hover"
                    key={preset.name}
                    onClick={() =>
                      setForm({
                        ...emptyMcpForm(),
                        name: preset.name,
                        commandLine: preset.command,
                      })
                    }
                    type="button"
                  >
                    <IconPlus size={12} stroke={2} />
                    {preset.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <SettingsList>
            {serverList.map((server) => {
              const status = MCP_STATUS_STYLE[server.status];
              const deleting = confirmingDelete === server.name;
              return (
                <div
                  className="group/mcp border-hairline-soft border-b px-4 py-3 last:border-b-0"
                  key={server.name}
                >
                  <div className="flex items-center gap-2.5">
                    <span aria-hidden className={cn("size-2 shrink-0 rounded-full", status.dot)} />
                    <span className="min-w-0 truncate text-sm text-fg">{server.name}</span>
                    <span className="shrink-0 rounded bg-chip px-1.5 py-px font-mono text-2xs text-fg-subtle">
                      {server.transport === "stdio" ? "local" : "remote"}
                    </span>
                    <span className="shrink-0 rounded bg-chip-faint px-1.5 py-px text-2xs text-fg-faint">
                      {sourceBadge(server.source)}
                    </span>
                    <span className="shrink-0 text-2xs text-fg-faint">{status.label}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-0.5">
                      {deleting ? (
                        <button
                          className="flex h-6 items-center gap-1 rounded-md bg-danger/10 px-1.5 text-2xs text-danger transition-colors hover:bg-danger/20"
                          onClick={() => void deleteServer(server)}
                          type="button"
                        >
                          <IconTrash size={12} stroke={1.9} />
                          Delete “{server.name}”?
                        </button>
                      ) : (
                        <>
                          <span className="text-2xs text-fg-faint">
                            {server.tools.length > 0
                              ? `${server.tools.length} tool${server.tools.length === 1 ? "" : "s"}`
                              : ""}
                          </span>
                          <Tooltip content="Edit server" side="bottom" sideOffset={6}>
                            <button
                              aria-label={`Edit ${server.name}`}
                              className="flex size-6 items-center justify-center rounded-md text-fg-faint opacity-0 transition-all hover:bg-hover hover:text-fg-muted group-hover/mcp:opacity-100"
                              onClick={() => void openEdit(server)}
                              type="button"
                            >
                              <IconEdit size={13} stroke={1.8} />
                            </button>
                          </Tooltip>
                          <Tooltip content="Remove server" side="bottom" sideOffset={6}>
                            <button
                              aria-label={`Remove ${server.name}`}
                              className="flex size-6 items-center justify-center rounded-md text-fg-faint opacity-0 transition-all hover:bg-danger/10 hover:text-danger group-hover/mcp:opacity-100"
                              onClick={() => setConfirmingDelete(server.name)}
                              type="button"
                            >
                              <IconTrash size={13} stroke={1.8} />
                            </button>
                          </Tooltip>
                          <Switch.Root
                            checked={server.status !== "disabled"}
                            className="ml-1 flex h-4.5 w-8 shrink-0 cursor-pointer rounded-full bg-chip-strong p-0.5 transition-colors data-checked:bg-success/70"
                            onCheckedChange={(checked) => void toggleServer(server, checked)}
                          >
                            <Switch.Thumb className="size-3.5 rounded-full bg-fg transition-transform data-checked:translate-x-3.5" />
                          </Switch.Root>
                        </>
                      )}
                    </span>
                  </div>
                  {server.error ? (
                    <p className="mt-1.5 pl-[18px] text-danger text-xs leading-relaxed">
                      {server.error}
                    </p>
                  ) : null}
                  {server.tools.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1 pl-[18px]">
                      {server.tools.map((tool) => (
                        <span
                          className="rounded bg-chip-faint px-1.5 py-0.5 font-mono text-2xs text-fg-subtle"
                          key={tool.registeredName}
                          title={tool.description}
                        >
                          {tool.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </SettingsList>
        )}
        <div className="flex items-center justify-between">
          <p className="text-fg-faint text-xs leading-relaxed">
            MCP tools always ask for permission first; “Always allow” trusts a tool for this
            workspace. New servers apply to new chats.
          </p>
          <button
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-fg-faint text-xs transition-colors hover:bg-hover hover:text-fg-subtle disabled:opacity-40"
            disabled={!cwd}
            onClick={() => void window.modus.mcp.openConfig(cwd ?? "")}
            title="Advanced: edit the underlying mcp.json directly"
            type="button"
          >
            <IconCodeDots size={13} stroke={1.7} />
            Edit JSON
          </button>
        </div>
      </SettingsSection>
    </>
  );
}

/** The add/edit server form — one paste-friendly command field, no JSON. */
function McpServerForm({
  busy,
  form,
  isNew,
  onCancel,
  onChange,
  onSubmit,
}: {
  busy: boolean;
  form: McpFormState;
  isNew: boolean;
  onCancel(): void;
  onChange(next: McpFormState): void;
  onSubmit(state: McpFormState): void;
}) {
  const canSave =
    form.name.trim().length > 0 &&
    (form.transport === "stdio"
      ? form.commandLine.trim().length > 0
      : /^https?:\/\//.test(form.url.trim()));

  const set = (patch: Partial<McpFormState>): void => onChange({ ...form, ...patch });

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-hairline bg-panel p-5"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (canSave && !busy) {
          onSubmit(form);
        }
      }}
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm text-fg">
          {isNew ? "Add MCP server" : `Edit “${form.originalName}”`}
        </h4>
        {isNew ? (
          <div className="flex gap-1">
            {MCP_PRESETS.map((preset) => (
              <button
                className="h-6 rounded-md bg-chip px-2 text-2xs text-fg-subtle transition-colors hover:bg-chip-strong hover:text-fg"
                key={preset.name}
                onClick={() =>
                  set({
                    name: form.name || preset.name,
                    transport: "stdio",
                    commandLine: preset.command,
                  })
                }
                type="button"
              >
                {preset.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <McpTypeCard
          active={form.transport === "stdio"}
          description="Runs a command on this machine. Most servers from npm work this way."
          icon={<IconTerminal2 size={16} stroke={1.7} />}
          label="Local command"
          onClick={() => set({ transport: "stdio" })}
        />
        <McpTypeCard
          active={form.transport === "http"}
          description="Connects to a hosted MCP endpoint over HTTP or SSE."
          icon={<IconWorld size={16} stroke={1.7} />}
          label="Remote URL"
          onClick={() => set({ transport: "http" })}
        />
      </div>

      <McpField hint="Shown in tool calls, e.g. “linear”. Letters, numbers, - _ ." label="Name">
        <input
          className="h-9 w-full rounded-md border border-hairline-soft bg-surface px-3 font-mono text-sm text-fg outline-none placeholder:text-fg-faint focus:border-focus-ring"
          onChange={(event) => set({ name: event.target.value })}
          placeholder="my-server"
          value={form.name}
        />
      </McpField>

      {form.transport === "stdio" ? (
        <>
          <McpField
            hint="Paste the full command from the server's README — Modus splits it for you."
            label="Command"
          >
            <input
              className="h-9 w-full rounded-md border border-hairline-soft bg-surface px-3 font-mono text-sm text-fg outline-none placeholder:text-fg-faint focus:border-focus-ring"
              onChange={(event) => set({ commandLine: event.target.value })}
              placeholder="npx -y @modelcontextprotocol/server-filesystem ."
              value={form.commandLine}
            />
          </McpField>
          <McpKeyValueRows
            addLabel="Add variable"
            hint="Secrets the server needs. Use ${env:NAME} to reference your system environment."
            label="Environment variables"
            onChange={(env) => set({ env })}
            pairs={form.env}
            placeholderKey="API_KEY"
            placeholderValue="value or ${env:MY_KEY}"
          />
        </>
      ) : (
        <>
          <McpField hint="The server's MCP endpoint." label="URL">
            <input
              className="h-9 w-full rounded-md border border-hairline-soft bg-surface px-3 font-mono text-sm text-fg outline-none placeholder:text-fg-faint focus:border-focus-ring"
              onChange={(event) => set({ url: event.target.value })}
              placeholder="https://example.com/mcp"
              value={form.url}
            />
          </McpField>
          <McpKeyValueRows
            addLabel="Add header"
            hint="Sent with every request — auth tokens usually go here."
            label="Headers"
            onChange={(headers) => set({ headers })}
            pairs={form.headers}
            placeholderKey="Authorization"
            placeholderValue="Bearer ${env:MY_TOKEN}"
          />
        </>
      )}

      <div className="flex items-center justify-between border-hairline-soft border-t pt-4">
        <div className="flex items-center gap-2 text-fg-muted text-xs">
          <Switch.Root
            aria-label="Connect automatically"
            checked={form.enabled}
            className="flex h-4.5 w-8 shrink-0 cursor-pointer rounded-full bg-chip-strong p-0.5 transition-colors data-checked:bg-success/70"
            onCheckedChange={(enabled) => set({ enabled })}
          >
            <Switch.Thumb className="size-3.5 rounded-full bg-fg transition-transform data-checked:translate-x-3.5" />
          </Switch.Root>
          Connect automatically
        </div>
        <div className="flex items-center gap-2">
          <button
            className="h-8 rounded-md px-3 text-fg-muted text-xs transition-colors hover:bg-hover hover:text-fg"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="flex h-8 items-center gap-1.5 rounded-md bg-fg px-3 text-canvas text-xs transition-colors hover:bg-fg-muted disabled:opacity-40"
            disabled={!canSave || busy}
            type="submit"
          >
            {busy ? <IconLoader2 className="animate-spin" size={13} stroke={1.8} /> : null}
            {busy ? "Connecting…" : isNew ? "Add server" : "Save changes"}
          </button>
        </div>
      </div>
    </form>
  );
}

function McpTypeCard({
  active,
  description,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  description: string;
  icon: ReactNode;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
        active
          ? "border-focus-ring bg-chip-faint"
          : "border-hairline-soft bg-surface/45 hover:border-hairline-strong",
      )}
      onClick={onClick}
      type="button"
    >
      <span
        className={cn("flex items-center gap-1.5 text-sm", active ? "text-fg" : "text-fg-muted")}
      >
        {icon}
        {label}
      </span>
      <span className="text-2xs text-fg-faint leading-relaxed">{description}</span>
    </button>
  );
}

function McpField({
  children,
  hint,
  label,
}: {
  children: ReactNode;
  hint?: string;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-fg-muted text-xs">{label}</span>
      {children}
      {hint ? <span className="text-2xs text-fg-faint">{hint}</span> : null}
    </div>
  );
}

function McpKeyValueRows({
  addLabel,
  hint,
  label,
  onChange,
  pairs,
  placeholderKey,
  placeholderValue,
}: {
  addLabel: string;
  hint: string;
  label: string;
  onChange(pairs: KeyValuePair[]): void;
  pairs: KeyValuePair[];
  placeholderKey: string;
  placeholderValue: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-fg-muted text-xs">{label}</span>
      {pairs.map((item) => (
        <div className="flex items-center gap-1.5" key={item.id}>
          <input
            className="h-8 w-2/5 rounded-md border border-hairline-soft bg-surface px-2.5 font-mono text-fg text-xs outline-none placeholder:text-fg-faint focus:border-focus-ring"
            onChange={(event) =>
              onChange(
                pairs.map((existing) =>
                  existing.id === item.id ? { ...existing, key: event.target.value } : existing,
                ),
              )
            }
            placeholder={placeholderKey}
            value={item.key}
          />
          <input
            className="h-8 min-w-0 flex-1 rounded-md border border-hairline-soft bg-surface px-2.5 font-mono text-fg text-xs outline-none placeholder:text-fg-faint focus:border-focus-ring"
            onChange={(event) =>
              onChange(
                pairs.map((existing) =>
                  existing.id === item.id ? { ...existing, value: event.target.value } : existing,
                ),
              )
            }
            placeholder={placeholderValue}
            value={item.value}
          />
          <button
            aria-label="Remove row"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg-muted"
            onClick={() => onChange(pairs.filter((existing) => existing.id !== item.id))}
            type="button"
          >
            <IconX size={13} stroke={1.8} />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button
          className="flex h-7 items-center gap-1 rounded-md px-2 text-fg-subtle text-xs transition-colors hover:bg-hover hover:text-fg"
          onClick={() => onChange([...pairs, pair()])}
          type="button"
        >
          <IconPlus size={12} stroke={2} />
          {addLabel}
        </button>
        <span className="text-2xs text-fg-faint">{hint}</span>
      </div>
    </div>
  );
}

const THEME_OPTIONS: ReadonlyArray<{ value: ThemeMode; label: string; icon: typeof IconSun }> = [
  { value: "light", label: "Light", icon: IconSun },
  { value: "dark", label: "Dark", icon: IconMoon },
];

function ThemeToggle({
  value,
  onChange,
}: {
  value: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-hairline-soft bg-canvas p-0.5">
      {THEME_OPTIONS.map(({ value: option, label, icon: Icon }) => {
        const active = option === value;
        return (
          <button
            aria-pressed={active}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors",
              active ? "bg-active text-fg shadow-composer" : "text-fg-subtle hover:text-fg-muted",
            )}
            key={option}
            onClick={() => onChange(option)}
            title={`${label} theme`}
            type="button"
          >
            <Icon size={14} stroke={1.8} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

function RulesSettingsPanel({ cwd }: { cwd: string | undefined }) {
  const [rules, setRules] = useState<RuleFileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [rulesError, setRulesError] = useState<string | undefined>();

  async function refresh(): Promise<void> {
    if (!cwd) {
      setRules([]);
      return;
    }
    setLoading(true);
    setRulesError(undefined);
    try {
      setRules(await window.modus.rules.list(cwd));
    } catch (error) {
      setRulesError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh is recreated each render; cwd is the real trigger.
  useEffect(() => {
    void refresh();
  }, [cwd]);

  async function openRule(rule: RuleFileInfo): Promise<void> {
    if (!cwd) {
      return;
    }
    try {
      await window.modus.file.open({ cwd, path: rule.relPath });
    } catch (error) {
      setRulesError(error instanceof Error ? error.message : String(error));
    }
  }

  const autoApplied = rules.filter((rule) => rule.mode === "always");

  return (
    <>
      <SettingsPageHeader
        actions={
          <button
            className="flex h-8 items-center gap-1.5 rounded-md border border-hairline bg-surface px-2.5 text-xs text-fg transition-colors hover:bg-hover disabled:opacity-40"
            disabled={!cwd || loading}
            onClick={() => void refresh()}
            type="button"
          >
            {loading ? (
              <IconLoader2 className="animate-spin" size={14} stroke={1.7} />
            ) : (
              <IconRefresh size={14} stroke={1.7} />
            )}
            Refresh
          </button>
        }
        description="Project rules are injected into every agent session automatically when marked Always Apply (AGENTS.md, CLAUDE.md, .cursorrules, or .cursor/rules/*.mdc with alwaysApply: true). Other rules stay available through the @rules context attachment."
        title="Rules"
      />

      {rulesError ? <p className="-mt-4 text-danger text-xs">{rulesError}</p> : null}

      <SettingsSection title="Detected rule files">
        {!cwd ? (
          <div className="rounded-lg border border-hairline-soft bg-panel px-5 py-6">
            <p className="text-sm text-fg-muted">Open a workspace to discover project rules.</p>
          </div>
        ) : loading && rules.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-hairline-soft bg-panel px-5 py-6 text-sm text-fg-muted">
            <IconLoader2 className="animate-spin" size={15} stroke={1.7} />
            Scanning workspace…
          </div>
        ) : rules.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-hairline-soft bg-panel px-5 py-6">
            <p className="text-sm text-fg-muted">
              No rule files found. Add <span className="font-mono text-xs">AGENTS.md</span> at the
              workspace root, or create{" "}
              <span className="font-mono text-xs">.cursor/rules/*.mdc</span> with{" "}
              <span className="font-mono text-xs">alwaysApply: true</span>.
            </p>
          </div>
        ) : (
          <SettingsList>
            {rules.map((rule) => (
              <button
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-hairline-soft border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-hover"
                key={rule.path}
                onClick={() => void openRule(rule)}
                type="button"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex size-5 shrink-0 items-center justify-center text-fg-faint">
                      <IconGavel size={15} stroke={1.7} />
                    </span>
                    <span className="shrink-0 font-mono text-sm text-fg">{rule.relPath}</span>
                    <RuleModeBadge mode={rule.mode} />
                  </div>
                  {rule.description ? (
                    <p className="mt-1 truncate pl-7.5 text-xs text-fg-subtle">
                      {rule.description}
                    </p>
                  ) : null}
                  {rule.globs ? (
                    <p className="mt-0.5 truncate pl-7.5 font-mono text-2xs text-fg-faint">
                      globs: {rule.globs}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 rounded bg-chip-faint px-1.5 py-px text-2xs text-fg-faint">
                  {ruleSourceLabel(rule.source)}
                </span>
              </button>
            ))}
          </SettingsList>
        )}
      </SettingsSection>

      {cwd && autoApplied.length > 0 ? (
        <SettingsSection title="Auto-applied">
          <div className="rounded-lg border border-hairline-soft bg-panel px-5 py-4">
            <p className="text-sm text-fg-muted">
              {autoApplied.length} rule file{autoApplied.length === 1 ? "" : "s"} injected into the
              system prompt for every new agent session in this workspace.
            </p>
          </div>
        </SettingsSection>
      ) : null}
    </>
  );
}

function ruleSourceLabel(source: RuleSource): string {
  switch (source) {
    case "agents-md":
      return "AGENTS.md";
    case "claude-md":
      return "CLAUDE.md";
    case "cursorrules":
      return ".cursorrules";
    case "cursor-rule":
      return ".mdc";
  }
}

function RuleModeBadge({ mode }: { mode: RuleMode }) {
  const label =
    mode === "always"
      ? "Always"
      : mode === "glob"
        ? "Glob"
        : mode === "intelligent"
          ? "Intelligent"
          : "Manual";
  const tone =
    mode === "always"
      ? "bg-focus-ring-soft/15 text-focus-ring-soft"
      : "bg-chip-faint text-fg-faint";
  return <span className={cn("shrink-0 rounded px-1.5 py-px text-2xs", tone)}>{label}</span>;
}

function SkillsSettingsPanel({ cwd }: { cwd: string | undefined }) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [saving, setSaving] = useState(false);

  async function refresh(): Promise<void> {
    if (!cwd) {
      setSkills([]);
      return;
    }
    setLoading(true);
    setSkillsError(undefined);
    try {
      setSkills(await window.modus.skills.list(cwd));
    } catch (error) {
      setSkillsError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh is recreated each render; cwd is the real trigger.
  useEffect(() => {
    void refresh();
  }, [cwd]);

  async function saveSkill(): Promise<void> {
    if (!cwd || !draftName.trim()) {
      return;
    }
    setSaving(true);
    setSkillsError(undefined);
    try {
      await window.modus.skills.create({
        cwd,
        name: draftName.trim(),
        description: draftDescription.trim(),
        body: draftBody.trim(),
      });
      setCreating(false);
      setDraftName("");
      setDraftDescription("");
      setDraftBody("");
      await refresh();
    } catch (error) {
      setSkillsError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  function scopeBadge(skill: SkillInfo): string {
    return skill.scope === "user" ? `user · ${skill.source}` : `project · ${skill.source}`;
  }

  return (
    <>
      <SettingsPageHeader
        actions={
          <>
            <button
              className="flex h-8 items-center gap-1.5 rounded-md border border-hairline bg-surface px-2.5 text-xs text-fg transition-colors hover:bg-hover disabled:opacity-40"
              disabled={!cwd}
              onClick={() => void window.modus.skills.openDir(cwd as string)}
              type="button"
            >
              <IconWorld size={14} stroke={1.7} />
              Open folder
            </button>
            <button
              className="flex h-8 items-center gap-1.5 rounded-md bg-fg px-2.5 text-canvas text-xs transition-colors hover:bg-fg-muted disabled:opacity-40"
              disabled={!cwd}
              onClick={() => setCreating((value) => !value)}
              type="button"
            >
              <IconPlus size={14} stroke={2} />
              New
            </button>
          </>
        }
        description="Skills are specialized capabilities that help the agent accomplish specific tasks. Skills are invoked by the agent when relevant, or triggered manually with / in chat."
        title="Skills"
      />

      {skillsError ? <p className="-mt-4 text-danger text-xs">{skillsError}</p> : null}

      <CollapsibleMotion open={creating && Boolean(cwd)} preset="default">
        <div className="flex flex-col gap-3 rounded-lg border border-hairline-soft bg-panel px-5 py-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-fg-subtle">Name</span>
            <input
              className="h-8 rounded-md border border-hairline bg-surface px-2.5 text-sm text-fg outline-none focus:border-focus-ring"
              onChange={(event) => setDraftName(event.target.value)}
              placeholder="code-review"
              value={draftName}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-fg-subtle">Description</span>
            <textarea
              className="scroll-thin min-h-[68px] resize-none rounded-md border border-hairline bg-surface px-2.5 py-2 text-sm text-fg leading-5 outline-none focus:border-focus-ring"
              maxLength={280}
              onChange={(event) => setDraftDescription(event.target.value)}
              placeholder="Review a diff for correctness and security"
              value={draftDescription}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-fg-subtle">Instructions</span>
            <textarea
              className="scroll-thin min-h-48 resize-y rounded-md border border-hairline bg-surface px-3 py-2 font-mono text-xs text-fg leading-5 outline-none placeholder:text-fg-faint focus:border-focus-ring"
              onChange={(event) => setDraftBody(event.target.value)}
              placeholder={
                "# code-review\n\nUse this skill when reviewing code.\n\n## Steps\n\n1. Read the diff.\n2. Find correctness risks.\n3. Return concise findings first."
              }
              value={draftBody}
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            <button
              className="flex h-8 items-center rounded-md border border-hairline bg-surface px-3 text-xs text-fg-muted transition-colors hover:bg-hover"
              onClick={() => setCreating(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="flex h-8 items-center gap-1.5 rounded-md bg-fg px-3 text-canvas text-xs transition-colors hover:bg-fg-muted disabled:opacity-40"
              disabled={!draftName.trim() || !draftBody.trim() || saving}
              onClick={() => void saveSkill()}
              type="button"
            >
              {saving ? <IconLoader2 className="animate-spin" size={14} stroke={1.7} /> : null}
              Create skill
            </button>
          </div>
        </div>
      </CollapsibleMotion>

      <SettingsSection title="Available skills">
        {!cwd ? (
          <div className="rounded-lg border border-hairline-soft bg-panel px-5 py-6">
            <p className="text-sm text-fg-muted">Open a workspace to discover and create skills.</p>
          </div>
        ) : loading && skills.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-hairline-soft bg-panel px-5 py-6 text-sm text-fg-muted">
            <IconLoader2 className="animate-spin" size={15} stroke={1.7} />
            Discovering skills…
          </div>
        ) : skills.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-hairline-soft bg-panel px-5 py-6">
            <p className="text-sm text-fg-muted">
              No skills yet. Create one, or drop a{" "}
              <span className="font-mono text-xs">SKILL.md</span> into{" "}
              <span className="font-mono text-xs">.modus/skills/&lt;name&gt;/</span>.
            </p>
          </div>
        ) : (
          <SettingsList>
            {skills.map((skill) => (
              <div
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-hairline-soft border-b px-4 py-3 last:border-b-0"
                key={skill.id}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center text-fg-faint">
                    <IconCube size={15} stroke={1.7} />
                  </span>
                  <span className="shrink-0 font-mono text-sm text-fg">/{skill.name}</span>
                  {skill.description ? (
                    <span className="min-w-0 truncate text-xs text-fg-subtle">
                      {skill.description}
                    </span>
                  ) : null}
                </div>
                <span className="shrink-0 rounded bg-chip-faint px-1.5 py-px text-2xs text-fg-faint">
                  {scopeBadge(skill)}
                </span>
              </div>
            ))}
          </SettingsList>
        )}
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
  return <span className="rounded-md bg-chip px-2.5 py-1 text-xs text-fg-muted">{children}</span>;
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

function ProviderCatalogRow({
  provider,
  active,
  onClick,
  onDelete,
}: {
  provider: ModelProviderInfo;
  active: boolean;
  onClick(): void;
  onDelete?: (() => void) | undefined;
}) {
  return (
    <div className="group/row relative">
      <ProviderRow active={active} onClick={onClick} provider={provider} />
      {onDelete ? (
        <button
          aria-label={`Delete ${provider.name}`}
          className="absolute top-1/2 right-2 hidden size-7 -translate-y-1/2 items-center justify-center rounded-md bg-canvas/80 text-[#ef4444] transition-colors hover:bg-[#ef4444]/15 hover:text-[#f87171] group-hover/row:flex"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          type="button"
        >
          <IconTrash size={15} stroke={1.7} />
        </button>
      ) : null}
    </div>
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
  onEditModel,
  onEditProvider,
  onKeyChange,
  onToggleModel,
}: {
  detail: ModelProviderDetail;
  busy: boolean;
  keyValue: string;
  onConnect(apiKey: string, baseUrl?: string): void;
  onEditModel(
    model: ProviderModelConfig,
    patch: { thinkingLevel?: ThinkingLevel; contextWindow?: number; maxTokens?: number },
  ): void;
  onEditProvider(providerId: string): void;
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
      className="flex min-w-0 flex-col"
      exit={{ opacity: 0, y: 8 }}
      initial={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
    >
      <div className="pb-5">
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

      <div className="pt-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h4 className="text-sm font-normal text-fg">Models</h4>
            <p className="mt-1 text-xs text-fg-faint">
              Choose which models appear in the composer. Expand a model to set its thinking level
              {detail.source === "custom" ? " or limits" : ""}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {busy ? (
              <span className="flex items-center gap-1.5 rounded-md bg-chip px-2.5 py-1 text-xs text-fg-muted">
                <IconLoader2 className="animate-spin" size={13} stroke={1.8} />
                Saving
              </span>
            ) : (
              <ReadOnlyPill>{modelResultLabel(filteredModels.length)}</ReadOnlyPill>
            )}
            {detail.source === "custom" ? (
              <button
                className="flex h-8 items-center gap-1.5 rounded-md border border-hairline bg-chip-faint px-3 text-sm text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
                onClick={() => onEditProvider(detail.id)}
                type="button"
              >
                <IconPlus size={14} stroke={1.8} />
                Add / edit models
              </button>
            ) : null}
          </div>
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

        <div className="mt-4 overflow-hidden rounded-lg border border-hairline-soft bg-panel">
          {filteredModels.length > 0 ? (
            modelGroups.map((group) => (
              <ModelGroupSection
                busy={busy}
                editableLimits={detail.source === "custom"}
                group={group}
                key={group.id}
                onEditModel={onEditModel}
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
  onConnect(apiKey: string, baseUrl?: string): void;
  onKeyChange(apiKey: string): void;
}) {
  // Custom providers own their base URL through the custom-provider form; only
  // built-in providers expose an optional relay endpoint here. Seeded per
  // provider (ProviderDetail is keyed by id, so this remounts on switch).
  const supportsBaseUrl = detail.source === "builtin";
  const storedBaseUrl = detail.baseUrl ?? "";
  const [baseUrl, setBaseUrl] = useState(storedBaseUrl);
  const baseUrlChanged = supportsBaseUrl && baseUrl.trim() !== storedBaseUrl;
  const canSubmit = Boolean(keyValue.trim()) || baseUrlChanged;

  return (
    <form
      className="border-hairline-soft border-y py-5"
      onSubmit={(event) => {
        event.preventDefault();
        onConnect(keyValue, supportsBaseUrl ? baseUrl.trim() : undefined);
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
          disabled={busy || !canSubmit}
          type="submit"
        >
          {busy ? <IconLoader2 className="animate-spin" size={13} stroke={1.8} /> : null}
          {detail.configured ? "Update" : "Connect"}
        </button>
      </div>

      {supportsBaseUrl ? (
        <div className="mt-3">
          <label className="relative block min-w-0">
            <span className="sr-only">Custom base URL for {detail.name}</span>
            <IconWorld
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-faint"
              size={15}
              stroke={1.7}
            />
            <input
              autoComplete="off"
              className="h-9 w-full rounded-md border border-hairline bg-canvas pr-3 pl-9 font-mono text-sm text-fg outline-none placeholder:text-fg-faint transition-colors focus:border-hairline-strong"
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="Custom base URL — official endpoint by default"
              spellCheck={false}
              type="url"
              value={baseUrl}
            />
          </label>
          <p className="mt-1.5 text-xs text-fg-faint">
            Optional. Route this provider's protocol through a compatible gateway (e.g.
            {" https://relay.example.com/v1"}). Leave empty to use the official endpoint.
          </p>
        </div>
      ) : null}
    </form>
  );
}

function ModelGroupSection({
  group,
  busy,
  editableLimits,
  onEditModel,
  onToggleModel,
}: {
  group: ReturnType<typeof groupProviderModels>[number];
  busy: boolean;
  editableLimits: boolean;
  onEditModel(
    model: ProviderModelConfig,
    patch: { thinkingLevel?: ThinkingLevel; contextWindow?: number; maxTokens?: number },
  ): void;
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
          <ModelRow
            busy={busy}
            editableLimits={editableLimits}
            key={model.id}
            model={model}
            onEditModel={onEditModel}
            onToggleModel={onToggleModel}
          />
        ))}
      </AnimatePresence>
    </section>
  );
}

function ModelRow({
  model,
  busy,
  editableLimits,
  onEditModel,
  onToggleModel,
}: {
  model: ProviderModelConfig;
  busy: boolean;
  editableLimits: boolean;
  onEditModel(
    model: ProviderModelConfig,
    patch: { thinkingLevel?: ThinkingLevel; contextWindow?: number; maxTokens?: number },
  ): void;
  onToggleModel(model: ProviderModelConfig, enabled: boolean): void;
}) {
  const [open, setOpen] = useState(false);
  const thinkingOptions = useMemo(
    () => model.thinkingLevels.map((level) => ({ label: level, value: level })),
    [model.thinkingLevels],
  );
  const canEditThinking = model.thinkingLevels.length > 1;
  const expandable = canEditThinking || editableLimits;
  const [contextDraft, setContextDraft] = useState(
    model.contextWindow ? String(model.contextWindow) : "",
  );
  const [maxTokensDraft, setMaxTokensDraft] = useState(
    model.maxTokens ? String(model.maxTokens) : "",
  );

  function saveLimits(): void {
    const patch: { contextWindow?: number; maxTokens?: number } = {};
    const context = parsePositiveInteger(contextDraft);
    const maxTokens = parsePositiveInteger(maxTokensDraft);
    if (context !== undefined && context !== model.contextWindow) {
      patch.contextWindow = context;
    }
    if (maxTokens !== undefined && maxTokens !== model.maxTokens) {
      patch.maxTokens = maxTokens;
    }
    if (patch.contextWindow !== undefined || patch.maxTokens !== undefined) {
      onEditModel(model, patch);
    }
  }

  return (
    <m.div
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "border-hairline-soft border-b px-5 py-3 last:border-b-0",
        model.enabled ? "bg-chip-faint" : "hover:bg-hover",
      )}
      exit={{ opacity: 0, y: -4 }}
      initial={{ opacity: 0, y: 4 }}
      layout
      transition={{ duration: 0.14, ease: "easeOut" }}
    >
      <div className="grid min-h-[44px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
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
        <div className="flex items-center gap-2">
          {expandable ? (
            <button
              aria-expanded={open}
              aria-label={`Configure ${model.name}`}
              className="flex size-8 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg"
              onClick={() => setOpen((value) => !value)}
              type="button"
            >
              <IconAdjustments size={15} stroke={1.7} />
            </button>
          ) : null}
          <SwitchControl
            ariaLabel={`${model.enabled ? "Disable" : "Enable"} ${model.name}`}
            checked={model.enabled}
            disabled={busy}
            onCheckedChange={(checked) => onToggleModel(model, checked)}
          />
        </div>
      </div>

      <CollapsibleMotion open={open && expandable} preset="default">
        <div className="mt-3 grid gap-4 border-hairline-soft border-t pt-4">
          {canEditThinking ? (
            <div className="grid max-w-xs gap-2">
              <SelectField
                label="Default thinking level"
                onChange={(value) => onEditModel(model, { thinkingLevel: value as ThinkingLevel })}
                options={thinkingOptions}
                value={model.thinkingLevel}
              />
            </div>
          ) : null}
          {editableLimits ? (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <Field
                label="Context window"
                onChange={setContextDraft}
                placeholder="128000"
                value={contextDraft}
              />
              <Field
                label="Max output tokens"
                onChange={setMaxTokensDraft}
                placeholder="16384"
                value={maxTokensDraft}
              />
              <button
                className="flex h-10 items-center justify-center rounded-md bg-fg px-3 text-sm text-canvas transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy}
                onClick={saveLimits}
                type="button"
              >
                Save
              </button>
            </div>
          ) : null}
        </div>
      </CollapsibleMotion>
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
      className="flex min-h-[320px] min-w-0 items-center justify-center px-5 py-10"
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

  return <span className="rounded-md bg-chip px-2 py-1 text-xs text-fg-muted">Setup</span>;
}

function ModelKindBadge({ model }: { model: ProviderModelConfig }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs",
        model.reasoning ? "bg-chip-strong text-fg-muted" : "bg-chip text-fg-faint",
      )}
    >
      {model.reasoning ? <IconBrain size={11} stroke={1.8} /> : null}
      {model.reasoning ? "thinking" : "standard"}
    </span>
  );
}

function TinyBadge({ children }: { children: string }) {
  return <span className="rounded bg-chip px-1.5 py-0.5 text-2xs text-fg-faint">{children}</span>;
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
