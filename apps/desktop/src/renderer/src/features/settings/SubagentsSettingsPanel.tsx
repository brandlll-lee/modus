import { IconEdit, IconPlus, IconTrash, IconWorld } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ConfigScope,
  SubagentDetail,
  SubagentInfo,
  WorkspaceInfo,
} from "../../../../shared/contracts";
import { CollapsibleMotion } from "../../components/ui/CollapsibleMotion";
import { SettingsPageHeader } from "../../components/ui/SettingsPageHeader";
import { ShinyText } from "../../components/ui/ShinyText";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";
import { ReadOnlyPill, SettingsList, SettingsSection } from "./SettingsLayout";
import { SubagentForm, type SubagentFormState } from "./SubagentForm";

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

export function SubagentsSettingsPanel({
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
          <SubagentForm
            value={form}
            onChange={setForm}
            onSave={() => void saveSubagent(form)}
            onCancel={() => setForm(undefined)}
            saving={saving}
            projects={projectSelectOptions}
          />
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
