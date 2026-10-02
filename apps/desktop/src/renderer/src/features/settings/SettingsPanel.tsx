import {
  IconArrowLeft,
  IconCube,
  IconPalette,
  IconPlugConnected,
  IconRefresh,
  IconServerCog,
} from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import type { ModelSettingsState } from "../../../../shared/contracts";
import { NavItem } from "../../components/layout/NavItem";
import { SearchField } from "../../components/ui/SearchField";
import { ToolbarButton } from "../../components/ui/ToolbarButton";
import { AppearanceSettingsPanel } from "./AppearanceSettingsPanel";
import { McpSettingsPanel } from "./McpSettingsPanel";
import { ProviderSettingsPanel } from "./ProviderSettingsPanel";
import { SkillsSettingsPanel } from "./SkillsSettingsPanel";

type SettingsPanelProps = {
  sessionId?: string | undefined;
  state: ModelSettingsState | null;
  onClose(): void;
  onReloadConfiguration(): Promise<void>;
  workspaceCwd?: string | undefined;
};

type SettingsSectionId = "model-provider" | "appearance" | "skills" | "mcp";
const SETTINGS_NAV_ITEMS: ReadonlyArray<{
  id: SettingsSectionId;
  label: string;
  icon: ReactNode;
}> = [
  {
    id: "model-provider",
    label: "Model & Provider",
    icon: <IconServerCog size={16} stroke={1.7} />,
  },
  { id: "appearance", label: "Appearance", icon: <IconPalette size={16} stroke={1.7} /> },
  { id: "mcp", label: "MCP", icon: <IconPlugConnected size={16} stroke={1.7} /> },
  { id: "skills", label: "Skills", icon: <IconCube size={16} stroke={1.7} /> },
];

export function SettingsPanel({
  sessionId,
  state,
  onClose,
  onReloadConfiguration,
  workspaceCwd,
}: SettingsPanelProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("model-provider");
  const [settingsQuery, setSettingsQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean }>();
  async function reload() {
    if (busy) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      await onReloadConfiguration();
      setFeedback({ message: "PI configuration reloaded.", error: false });
    } catch (cause) {
      setFeedback({ message: String(cause), error: true });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <SettingsSidebar
        activeSection={activeSection}
        onBack={onClose}
        onQueryChange={setSettingsQuery}
        onSectionChange={setActiveSection}
        query={settingsQuery}
        busy={busy}
        feedback={feedback}
        onReload={() => void reload()}
      />
      <main className="scroll-thin min-w-0 flex-1 overflow-y-auto bg-canvas">
        <div className="settings-content">
          {activeSection === "appearance" ? <AppearanceSettingsPanel /> : null}
          {activeSection === "model-provider" ? <ProviderSettingsPanel state={state} /> : null}
          {activeSection === "skills" ? (
            <SkillsSettingsPanel cwd={workspaceCwd} sessionId={sessionId} />
          ) : null}
          {activeSection === "mcp" ? (
            <McpSettingsPanel cwd={workspaceCwd} sessionId={sessionId} />
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
  onReload,
  busy,
  feedback,
}: {
  activeSection: SettingsSectionId;
  busy: boolean;
  feedback: { message: string; error: boolean } | undefined;
  onReload(): void;
  query: string;
  onBack(): void;
  onQueryChange(query: string): void;
  onSectionChange(section: SettingsSectionId): void;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = SETTINGS_NAV_ITEMS.filter((item) =>
    item.label.toLowerCase().includes(normalizedQuery),
  );

  return (
    <aside className="context-sidebar flex shrink-0 flex-col px-3 py-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <button
          className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-fg-muted transition-colors hover:bg-hover hover:text-fg"
          onClick={onBack}
          type="button"
        >
          <IconArrowLeft size={16} stroke={1.7} />
          Settings
        </button>
        <ToolbarButton label="重新加载 PI 配置" disabled={busy} onClick={onReload}>
          <IconRefresh
            size={16}
            stroke={1.7}
            className={busy ? "animate-spin motion-reduce:animate-none" : undefined}
          />
        </ToolbarButton>
      </div>
      {busy || feedback ? (
        <p
          role={feedback?.error ? "alert" : "status"}
          className={`mb-3 px-2 text-xs break-words ${feedback?.error ? "text-danger" : "text-fg-muted"}`}
        >
          {busy ? "Reloading PI configuration..." : feedback?.message}
        </p>
      ) : null}

      <SearchField
        ariaLabel="Search settings"
        className="mb-5"
        onChange={onQueryChange}
        placeholder="Search settings"
        value={query}
      />

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <SettingsNavGroup title="Preferences">
          {visibleItems.length > 0 ? (
            visibleItems.map((item) => (
              <NavItem
                active={activeSection === item.id}
                icon={item.icon}
                key={item.id}
                onClick={() => onSectionChange(item.id)}
              >
                {item.label}
              </NavItem>
            ))
          ) : (
            <div className="px-2 py-3 text-xs text-fg-faint">No matching settings</div>
          )}
        </SettingsNavGroup>
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
