import {
  IconArrowLeft,
  IconCube,
  IconEdit,
  IconMoon,
  IconMoonStars,
  IconPalette,
  IconPlugConnected,
  IconPlus,
  IconSearch,
  IconServerCog,
  IconSettings,
  IconSun,
  IconTrash,
  IconUser,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type {
  ConfigScope,
  ModelSettingsState,
  SubagentDetail,
  SubagentInfo,
  WorkspaceInfo,
} from "../../../../shared/contracts";
import { CollapsibleMotion } from "../../components/ui/CollapsibleMotion";
import { ShinyText } from "../../components/ui/ShinyText";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";
import { type ThemeMode, useTheme } from "../../lib/theme";
import { ApprovalModeSettings } from "./ApprovalModeSettings";
import { SelectField, SwitchControl } from "./form-controls";
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

type SettingsSectionId =
  | "general"
  | "model-provider"
  | "appearance"
  | "skills"
  | "subagents"
  | "mcp";
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
    <div className="flex min-h-0 flex-1 overflow-hidden bg-panel">
      <SettingsSidebar
        activeSection={activeSection}
        onBack={onClose}
        onQueryChange={setSettingsQuery}
        onSectionChange={setActiveSection}
        query={settingsQuery}
      />
      <main className="scroll-thin min-w-0 flex-1 overflow-y-auto border-hairline-strong border-l bg-canvas">
        <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-8 px-10 pt-16 pb-12">
          {activeSection === "general" ? (
            <GeneralSettingsPanel cwd={workspaceCwd} workspaces={workspaces} />
          ) : null}
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
          {activeSection === "subagents" ? (
            <SubagentsSettingsPanel cwd={workspaceCwd} workspaces={workspaces} />
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
    <aside className="flex w-[260px] shrink-0 flex-col bg-panel px-2.5 py-3">
      <button
        className="mb-4 flex h-8 items-center gap-2 rounded-md px-2 text-sm text-fg-muted transition-colors hover:bg-hover hover:text-fg"
        onClick={onBack}
        type="button"
      >
        <IconArrowLeft size={16} stroke={1.7} />
        Back
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
            active={activeSection === "subagents"}
            icon={<IconUser size={16} stroke={1.7} />}
            onClick={() => onSectionChange("subagents")}
          >
            Subagents
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

function GeneralSettingsPanel({
  cwd,
  workspaces = [],
}: {
  cwd?: string | undefined;
  workspaces?: WorkspaceInfo[] | undefined;
}) {
  return (
    <>
      <SettingsPageHeader
        description="Choose when Modus asks before risky agent actions — globally or per project."
        title="General"
      />
      <ApprovalModeSettings {...(cwd ? { cwd } : {})} workspaces={workspaces} />
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
            description="Switch between light, dark, and softer Dark+ palettes."
            title="Color scheme"
          />
          <SettingsRow
            control={<ReadOnlyPill>Inter + Noto SC</ReadOnlyPill>}
            description="Self-hosted Inter Variable (Latin) and Noto Sans SC Variable (CJK); system faces only cover gaps."
            title="Font family"
          />
        </SettingsList>
      </SettingsSection>
    </>
  );
}
type SettingsProjectTab = { rootPath: string; displayName: string };

const projectLabel = (cwd: string): string =>
  cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? "Project";

function settingsProjectTabs(
  cwd: string | undefined,
  workspaces: WorkspaceInfo[],
): SettingsProjectTab[] {
  const seen = new Set<string>();
  const tabs: SettingsProjectTab[] = [];
  const push = (rootPath: string, displayName: string): void => {
    if (!rootPath || seen.has(rootPath)) return;
    seen.add(rootPath);
    tabs.push({ rootPath, displayName: displayName || projectLabel(rootPath) });
  };
  if (cwd) push(cwd, workspaces.find((workspace) => workspace.rootPath === cwd)?.displayName ?? "");
  for (const workspace of workspaces) push(workspace.rootPath, workspace.displayName);
  return tabs;
}

const THEME_OPTIONS: ReadonlyArray<{ value: ThemeMode; label: string; icon: typeof IconSun }> = [
  { value: "light", label: "Light", icon: IconSun },
  { value: "dark", label: "Dark", icon: IconMoon },
  { value: "dark-plus", label: "Eye-care Dark", icon: IconMoonStars },
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

type SubagentFormState = {
  path?: string;
  scope: ConfigScope;
  projectCwd: string;
  name: string;
  description: string;
  model: string;
  readOnly: boolean;
  tools: string;
  disallowedTools: string;
  isolation: "shared" | "worktree";
  body: string;
};

function emptySubagentForm(scope: ConfigScope = "workspace", projectCwd = ""): SubagentFormState {
  return {
    scope,
    projectCwd,
    name: "",
    description: "",
    model: "inherit",
    readOnly: false,
    tools: "",
    disallowedTools: "",
    isolation: "shared",
    body: "",
  };
}

function formFromSubagent(subagent: SubagentDetail): SubagentFormState {
  return {
    path: subagent.path,
    scope: subagent.scope,
    projectCwd: "",
    name: subagent.name,
    description: subagent.description,
    model: subagent.model,
    readOnly: subagent.readOnly,
    tools: (subagent.tools ?? []).join(", "),
    disallowedTools: (subagent.disallowedTools ?? []).join(", "),
    isolation: subagent.isolation,
    body: subagent.body,
  };
}

function splitToolList(value: string): string[] | undefined {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function ScopeChoice({
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
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-1 rounded-lg border p-3 text-left",
        active ? "border-focus-ring bg-chip-faint" : "border-hairline-soft bg-surface/45",
      )}
    >
      <span className="flex items-center gap-1.5 text-sm">
        {icon}
        {label}
      </span>
      <span className="text-2xs text-fg-faint">{description}</span>
    </button>
  );
}

function SubagentsSettingsPanel({
  cwd,
  workspaces,
}: {
  cwd: string | undefined;
  workspaces: WorkspaceInfo[];
}) {
  const [subagents, setSubagents] = useState<SubagentInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [form, setForm] = useState<SubagentFormState | undefined>();
  const [saving, setSaving] = useState(false);
  const [activeScope, setActiveScope] = useState<ConfigScope>("user");
  const [selectedProjectCwd, setSelectedProjectCwd] = useState(cwd ?? "");
  const projectTabs = useMemo(() => settingsProjectTabs(cwd, workspaces), [cwd, workspaces]);
  const selectedProject =
    projectTabs.find((project) => project.rootPath === selectedProjectCwd) ?? projectTabs[0];
  const effectiveProjectCwd = selectedProject?.rootPath ?? selectedProjectCwd;
  const visibleSubagents = useMemo(
    () =>
      subagents.filter((subagent) =>
        activeScope === "workspace" ? subagent.scope === "workspace" : subagent.scope === "user",
      ),
    [activeScope, subagents],
  );
  const projectSelectOptions = projectTabs.map((project) => ({
    label: project.displayName,
    value: project.rootPath,
  }));

  async function refresh(targetCwd: string): Promise<void> {
    if (!targetCwd) {
      setSubagents([]);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      setSubagents(await window.modus.subagents.list(targetCwd));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cwd) {
      setSelectedProjectCwd(cwd);
    }
  }, [cwd]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the selected project scope changes.
  useEffect(() => {
    void refresh(effectiveProjectCwd);
  }, [effectiveProjectCwd]);

  async function editSubagent(subagent: SubagentInfo): Promise<void> {
    if (!effectiveProjectCwd) return;
    setError(undefined);
    try {
      const detail = await window.modus.subagents.get({
        cwd: effectiveProjectCwd,
        path: subagent.path,
      });
      if (detail) {
        setForm({ ...formFromSubagent(detail), projectCwd: effectiveProjectCwd });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveSubagent(current: SubagentFormState): Promise<void> {
    const targetCwd = current.scope === "workspace" ? current.projectCwd : effectiveProjectCwd;
    if (!targetCwd || !current.name.trim() || !current.body.trim()) {
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const tools = splitToolList(current.tools);
      const disallowedTools = splitToolList(current.disallowedTools);
      const payload = {
        cwd: targetCwd,
        name: current.name.trim(),
        description: current.description.trim(),
        model: current.model.trim() || "inherit",
        readOnly: current.readOnly,
        ...(tools ? { tools } : {}),
        ...(disallowedTools ? { disallowedTools } : {}),
        isolation: current.isolation,
        body: current.body.trim(),
      };
      if (current.path) {
        await window.modus.subagents.update({ ...payload, path: current.path });
      } else {
        await window.modus.subagents.create({ ...payload, scope: current.scope });
      }
      setActiveScope(current.scope);
      setSelectedProjectCwd(targetCwd);
      setForm(undefined);
      await refresh(targetCwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function removeSubagent(subagent: SubagentInfo): Promise<void> {
    if (!effectiveProjectCwd || !subagent.deletable) return;
    const confirmed = window.confirm(`Delete subagent "${subagent.name}"?`);
    if (!confirmed) return;
    setError(undefined);
    try {
      setSubagents(
        await window.modus.subagents.delete({ cwd: effectiveProjectCwd, path: subagent.path }),
      );
      if (form?.path === subagent.path) {
        setForm(undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function scopeBadge(subagent: SubagentInfo): string {
    return subagent.scope === "user" ? `home · ${subagent.source}` : `project · ${subagent.source}`;
  }

  function startCreate(scope: ConfigScope): void {
    setActiveScope(scope);
    setForm(emptySubagentForm(scope, effectiveProjectCwd));
  }

  return (
    <>
      <SettingsPageHeader
        actions={
          <>
            <button
              className="flex h-8 items-center gap-1.5 rounded-md border border-hairline bg-surface px-2.5 text-xs text-fg transition-colors hover:bg-hover disabled:opacity-40"
              disabled={!effectiveProjectCwd}
              onClick={() =>
                void window.modus.subagents.openDir({
                  cwd: effectiveProjectCwd,
                  scope: activeScope,
                })
              }
              type="button"
            >
              <IconWorld size={14} stroke={1.7} />
              Open folder
            </button>
            <button
              className="flex h-8 items-center gap-1.5 rounded-md bg-fg px-2.5 text-canvas text-xs transition-colors hover:bg-fg-muted disabled:opacity-40"
              disabled={!effectiveProjectCwd}
              onClick={() =>
                setForm((current) =>
                  current ? undefined : emptySubagentForm(activeScope, effectiveProjectCwd),
                )
              }
              type="button"
            >
              <IconPlus size={14} stroke={2} />
              New
            </button>
          </>
        }
        description="Create specialized agents for focused work in parallel. Definitions are Markdown files in your agents folder."
        title="Subagents"
      />

      <div className="flex flex-wrap items-center gap-1">
        <button
          className={cn(
            "h-8 rounded-md px-3 text-sm transition-colors",
            activeScope === "user"
              ? "bg-active text-fg"
              : "text-fg-muted hover:bg-hover hover:text-fg",
          )}
          onClick={() => {
            setActiveScope("user");
            setForm(undefined);
          }}
          type="button"
        >
          Home
        </button>
        {projectTabs.map((project) => {
          const active = activeScope === "workspace" && project.rootPath === effectiveProjectCwd;
          return (
            <button
              className={cn(
                "h-8 max-w-40 truncate rounded-md px-3 text-sm transition-colors",
                active ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
              )}
              key={project.rootPath}
              onClick={() => {
                setActiveScope("workspace");
                setSelectedProjectCwd(project.rootPath);
                setForm(undefined);
              }}
              title={project.rootPath}
              type="button"
            >
              {project.displayName}
            </button>
          );
        })}
      </div>

      {error ? <p className="-mt-4 text-danger text-xs">{error}</p> : null}

      <CollapsibleMotion open={Boolean(form && effectiveProjectCwd)} preset="default">
        {form ? (
          <div className="flex flex-col gap-3 rounded-lg border border-hairline-soft bg-panel px-5 py-4">
            {!form.path ? (
              <div className="grid gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <ScopeChoice
                    active={form.scope === "user"}
                    description="Available in every workspace."
                    icon={<IconUser size={16} stroke={1.7} />}
                    label="Home"
                    onClick={() => setForm({ ...form, scope: "user" })}
                  />
                  <ScopeChoice
                    active={form.scope === "workspace"}
                    description="Stored in one workspace."
                    icon={<IconCube size={16} stroke={1.7} />}
                    label="Project"
                    onClick={() =>
                      setForm({
                        ...form,
                        scope: "workspace",
                        projectCwd: form.projectCwd || projectTabs[0]?.rootPath || "",
                      })
                    }
                  />
                </div>
                {form.scope === "workspace" && projectSelectOptions.length > 1 ? (
                  <SelectField
                    label="Project"
                    onChange={(projectCwd) => setForm({ ...form, projectCwd })}
                    options={projectSelectOptions}
                    value={form.projectCwd}
                  />
                ) : null}
              </div>
            ) : (
              <div className="rounded-md border border-hairline-soft bg-surface px-3 py-2 text-fg-muted text-xs">
                Location: {form.scope === "user" ? "Home" : "Project"}
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,220px)]">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-fg-subtle">Name</span>
                <input
                  className="h-8 rounded-md border border-hairline bg-surface px-2.5 font-mono text-sm text-fg outline-none focus:border-focus-ring"
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="security-auditor"
                  value={form.name}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-fg-subtle">Model</span>
                <input
                  className="h-8 rounded-md border border-hairline bg-surface px-2.5 font-mono text-sm text-fg outline-none focus:border-focus-ring"
                  onChange={(event) => setForm({ ...form, model: event.target.value })}
                  placeholder="inherit"
                  value={form.model}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-fg-subtle">Description</span>
              <textarea
                className="scroll-thin min-h-[68px] resize-none rounded-md border border-hairline bg-surface px-2.5 py-2 text-sm text-fg leading-5 outline-none focus:border-focus-ring"
                maxLength={280}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="Use for security-sensitive auth, payment, or permission changes"
                value={form.description}
              />
            </label>
            <div className="flex items-center justify-between gap-4 rounded-md border border-hairline-soft bg-surface px-3 py-2">
              <span>
                <span className="block text-sm text-fg">Readonly</span>
                <span className="block text-xs text-fg-faint">
                  Disable write/shell/control tools
                </span>
              </span>
              <SwitchControl
                ariaLabel="Readonly subagent"
                checked={form.readOnly}
                onCheckedChange={(checked) => setForm({ ...form, readOnly: checked })}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px]">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-fg-subtle">Tools</span>
                <input
                  className="h-8 rounded-md border border-hairline bg-surface px-2.5 font-mono text-sm text-fg outline-none focus:border-focus-ring"
                  onChange={(event) => setForm({ ...form, tools: event.target.value })}
                  placeholder="read, grep, web_search"
                  value={form.tools}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-fg-subtle">Disallowed tools</span>
                <input
                  className="h-8 rounded-md border border-hairline bg-surface px-2.5 font-mono text-sm text-fg outline-none focus:border-focus-ring"
                  onChange={(event) => setForm({ ...form, disallowedTools: event.target.value })}
                  placeholder="shell, process"
                  value={form.disallowedTools}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-fg-subtle">Isolation</span>
                <select
                  className="h-8 rounded-md border border-hairline bg-surface px-2.5 text-sm text-fg outline-none focus:border-focus-ring"
                  onChange={(event) =>
                    setForm({
                      ...form,
                      isolation: event.target.value === "worktree" ? "worktree" : "shared",
                    })
                  }
                  value={form.isolation}
                >
                  <option value="shared">shared</option>
                  <option value="worktree">worktree</option>
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-fg-subtle">Instructions</span>
              <textarea
                className="scroll-thin min-h-56 resize-y rounded-md border border-hairline bg-surface px-3 py-2 font-mono text-xs text-fg leading-5 outline-none placeholder:text-fg-faint focus:border-focus-ring"
                onChange={(event) => setForm({ ...form, body: event.target.value })}
                placeholder={
                  "You are a focused security reviewer.\n\nWhen invoked:\n1. Inspect the relevant code.\n2. Report concrete risks.\n3. Do not edit files unless asked."
                }
                value={form.body}
              />
            </label>
            <div className="flex items-center justify-end gap-2">
              <button
                className="flex h-8 items-center rounded-md border border-hairline bg-surface px-3 text-xs text-fg-muted transition-colors hover:bg-hover"
                onClick={() => setForm(undefined)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="flex h-8 items-center gap-1.5 rounded-md bg-fg px-3 text-canvas text-xs transition-colors hover:bg-fg-muted disabled:opacity-40"
                disabled={!form.name.trim() || !form.body.trim() || saving}
                onClick={() => void saveSubagent(form)}
                type="button"
              >
                {saving ? (
                  <ShinyText className="text-canvas">Saving…</ShinyText>
                ) : form.path ? (
                  "Save subagent"
                ) : (
                  "Create subagent"
                )}
              </button>
            </div>
          </div>
        ) : null}
      </CollapsibleMotion>

      <SettingsSection
        title={
          activeScope === "workspace"
            ? `${selectedProject?.displayName ?? "Project"} subagents`
            : "Home subagents"
        }
      >
        {!effectiveProjectCwd ? (
          <div className="rounded-lg border border-hairline-soft bg-panel px-5 py-6">
            <p className="text-sm text-fg-muted">
              Open a workspace to discover and create subagents.
            </p>
          </div>
        ) : loading && visibleSubagents.length === 0 ? (
          <div className="rounded-lg border border-hairline-soft bg-panel px-5 py-6 text-sm text-fg-muted">
            <ShinyText>Discovering subagents…</ShinyText>
          </div>
        ) : visibleSubagents.length === 0 ? (
          <div className="rounded-lg border border-hairline-soft bg-panel px-5 py-10 text-center">
            <div className="text-sm text-fg-muted">No Subagents Yet</div>
            <div className="mt-1 text-xs text-fg-faint">
              {activeScope === "workspace"
                ? "Create project agents for this workspace."
                : "Create home agents available in every workspace."}
            </div>
            <button
              className="mt-4 h-8 rounded-md border border-hairline bg-surface px-3 text-xs text-fg transition-colors hover:bg-hover"
              onClick={() => startCreate(activeScope)}
              type="button"
            >
              New Subagent
            </button>
          </div>
        ) : (
          <SettingsList>
            {visibleSubagents.map((subagent) => (
              <div
                className="group/subagent grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-hairline-soft border-b px-4 py-3 last:border-b-0"
                key={subagent.path}
              >
                <button
                  className="min-w-0 text-left"
                  onClick={() => void editSubagent(subagent)}
                  type="button"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-fg">/{subagent.name}</span>
                    <ReadOnlyPill>{subagent.model || "inherit"}</ReadOnlyPill>
                    {subagent.readOnly ? <ReadOnlyPill>readonly</ReadOnlyPill> : null}
                    {subagent.isolation === "worktree" ? (
                      <ReadOnlyPill>worktree</ReadOnlyPill>
                    ) : null}
                    <span className="rounded bg-chip-faint px-1.5 py-px text-2xs text-fg-faint">
                      {scopeBadge(subagent)}
                    </span>
                  </div>
                  {subagent.description ? (
                    <div className="mt-1 truncate text-xs text-fg-muted">
                      {subagent.description}
                    </div>
                  ) : null}
                </button>
                <div className="flex items-center gap-1">
                  <Tooltip content="Edit subagent" side="bottom" sideOffset={6}>
                    <button
                      aria-label={`Edit ${subagent.name}`}
                      className="flex size-7 items-center justify-center rounded-md text-fg-faint opacity-0 transition-all hover:bg-hover hover:text-fg group-hover/subagent:opacity-100"
                      onClick={() => void editSubagent(subagent)}
                      type="button"
                    >
                      <IconEdit size={14} stroke={1.8} />
                    </button>
                  </Tooltip>
                  {subagent.deletable ? (
                    <Tooltip content="Delete subagent" side="bottom" sideOffset={6}>
                      <button
                        aria-label={`Delete ${subagent.name}`}
                        className="flex size-7 items-center justify-center rounded-md text-fg-faint opacity-0 transition-all hover:bg-danger/10 hover:text-danger group-hover/subagent:opacity-100"
                        onClick={() => void removeSubagent(subagent)}
                        type="button"
                      >
                        <IconTrash size={14} stroke={1.8} />
                      </button>
                    </Tooltip>
                  ) : null}
                </div>
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

function _SearchField({
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

function _EmptyState({ description, title }: { description: string; title: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <div className="text-sm text-fg-muted">{title}</div>
      <div className="mx-auto mt-1 max-w-[300px] text-xs text-fg-faint">{description}</div>
    </div>
  );
}
