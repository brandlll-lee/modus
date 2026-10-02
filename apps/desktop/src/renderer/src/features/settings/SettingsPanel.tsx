import {
  IconArrowLeft,
  IconCube,
  IconPalette,
  IconPlugConnected,
  IconServerCog,
} from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import type { ModelSettingsState, WorkspaceInfo } from "../../../../shared/contracts";
import { NavItem } from "../../components/layout/NavItem";
import { SearchField } from "../../components/ui/SearchField";
import { AppearanceSettingsPanel } from "./AppearanceSettingsPanel";
import { McpSettingsPanel } from "./McpSettingsPanel";
import { ProviderSettingsPanel } from "./ProviderSettingsPanel";
import { SkillsSettingsPanel } from "./SkillsSettingsPanel";

type SettingsPanelProps = {
  sessionId?: string | undefined;
  state: ModelSettingsState | null;
  onClose(): void;
  onRefreshCatalog(): Promise<void>;
  workspaceCwd?: string | undefined;
  workspaces?: WorkspaceInfo[] | undefined;
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
  onRefreshCatalog,
  workspaceCwd,
  workspaces = [],
}: SettingsPanelProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("model-provider");
  const [settingsQuery, setSettingsQuery] = useState("");
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <SettingsSidebar
        activeSection={activeSection}
        onBack={onClose}
        onQueryChange={setSettingsQuery}
        onSectionChange={setActiveSection}
        query={settingsQuery}
      />
      <main className="scroll-thin min-w-0 flex-1 overflow-y-auto bg-canvas">
        <div className="settings-content">
          {activeSection === "appearance" ? <AppearanceSettingsPanel /> : null}
          {activeSection === "model-provider" ? (
            <ProviderSettingsPanel state={state} onRefresh={onRefreshCatalog} />
          ) : null}
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
}: {
  activeSection: SettingsSectionId;
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
      <button
        className="mb-4 flex h-8 items-center gap-2 rounded-md px-2 text-sm text-fg-muted transition-colors hover:bg-hover hover:text-fg"
        onClick={onBack}
        type="button"
      >
        <IconArrowLeft size={16} stroke={1.7} />
        Settings
      </button>

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
