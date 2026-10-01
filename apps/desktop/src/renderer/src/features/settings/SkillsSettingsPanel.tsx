import { IconFolder, IconRefresh } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { SkillState } from "../../../../shared/contracts";
import { ResourceRow } from "../../components/ui/ResourceRow";
import { SearchField } from "../../components/ui/SearchField";
import { SettingsPageHeader } from "../../components/ui/SettingsPageHeader";

export function SkillsSettingsPanel({
  cwd,
  sessionId,
}: {
  cwd: string | undefined;
  sessionId: string | undefined;
}) {
  const [state, setState] = useState<SkillState>({ skills: [], diagnostics: [] });
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    let request = 0;
    setState({ skills: [], diagnostics: [] });
    setError(undefined);
    if (!sessionId) return;
    const load = () => {
      const current = ++request;
      void window.modus.skills
        .list(sessionId)
        .then((result) => {
          if (active && request === current) {
            setState(result);
            setError(undefined);
          }
        })
        .catch((cause: unknown) => {
          if (active && request === current) setError(String(cause));
        });
    };
    load();
    const unsubscribe = window.modus.skills.onChanged((path) => {
      if (path === cwd) load();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [cwd, sessionId]);
  async function refresh() {
    if (!cwd || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await window.modus.skills.refresh(cwd);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  const filtered = state.skills.filter((skill) =>
    `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="min-w-0 space-y-5">
      <SettingsPageHeader
        actions={
          <button
            type="button"
            title="Refresh resources"
            aria-label="Refresh resources"
            disabled={!sessionId || busy}
            onClick={() => void refresh()}
            className="toolbar-icon-button flex items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
          >
            <IconRefresh aria-hidden size={16} stroke={1.8} />
          </button>
        }
        description="See the skills loaded by the current session and where each one came from."
        title="Skills"
      />
      <SearchField
        ariaLabel="Search skills"
        onChange={setQuery}
        placeholder="Search skills"
        value={query}
      />
      {error ? (
        <p role="alert" className="break-words text-sm text-danger">
          {error}
        </p>
      ) : null}
      {state.diagnostics.map((diagnostic) => (
        <p
          role="status"
          key={`${diagnostic.path}:${diagnostic.message}`}
          className="break-words text-xs text-fg-muted"
        >
          {diagnostic.message}
          {diagnostic.path ? ` (${diagnostic.path})` : ""}
        </p>
      ))}
      {!sessionId ? (
        <p className="text-sm text-fg-muted">No active session.</p>
      ) : !filtered.length ? (
        <p className="text-sm text-fg-muted">No loaded skills match.</p>
      ) : null}
      <div className="space-y-1">
        {filtered.map((skill) => (
          <ResourceRow
            action={{
              icon: <IconFolder aria-hidden size={16} stroke={1.8} />,
              label: `Open ${skill.name} folder`,
              onClick: () => {
                if (sessionId)
                  void window.modus.skills
                    .openDir({ sessionId, path: skill.path })
                    .catch((cause: unknown) => setError(String(cause)));
              },
            }}
            description={skill.description}
            key={skill.path}
            meta={skill.path}
            title={skill.name}
          />
        ))}
      </div>
    </section>
  );
}
