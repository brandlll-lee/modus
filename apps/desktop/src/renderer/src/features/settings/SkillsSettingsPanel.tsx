import { IconFolder } from "@tabler/icons-react";
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
  const [loading, setLoading] = useState(Boolean(sessionId));
  useEffect(() => {
    let active = true;
    let request = 0;
    setState({ skills: [], diagnostics: [] });
    setError(undefined);
    if (!sessionId) return;
    const load = () => {
      const current = ++request;
      setLoading(true);
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
        })
        .finally(() => {
          if (active && request === current) setLoading(false);
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
  const filtered = state.skills.filter((skill) =>
    `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="min-w-0 space-y-5">
      <SettingsPageHeader title="Skills" />
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
      ) : loading ? (
        <p role="status" className="text-sm text-fg-muted">
          Loading skills...
        </p>
      ) : !error && !filtered.length ? (
        <p className="text-sm text-fg-muted">
          {state.skills.length
            ? "No skills match your search."
            : "No skills loaded for this session."}
        </p>
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
