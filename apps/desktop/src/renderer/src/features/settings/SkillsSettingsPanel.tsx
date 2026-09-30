import { IconFolder, IconRefresh, IconSearch } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { SkillState } from "../../../../shared/contracts";

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
      <header className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Skills</h2>
        <button
          type="button"
          title="Refresh resources"
          aria-label="Refresh resources"
          disabled={!sessionId || busy}
          onClick={() => void refresh()}
          className="rounded p-2 hover:bg-hover disabled:opacity-40"
        >
          <IconRefresh size={18} />
        </button>
      </header>
      <label className="flex items-center gap-2 border-b border-hairline-soft py-2">
        <IconSearch size={16} />
        <input
          aria-label="Search skills"
          placeholder="Search skills"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>
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
      <div className="divide-y divide-hairline-soft">
        {filtered.map((skill) => (
          <div key={skill.path} className="flex min-w-0 items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <h3 className="break-words text-sm font-medium">{skill.name}</h3>
              <p className="break-words text-sm text-fg-muted">{skill.description}</p>
              <p className="break-all text-xs text-fg-faint">{skill.path}</p>
            </div>
            <button
              type="button"
              title="Open skill folder"
              aria-label={`Open ${skill.name} folder`}
              className="shrink-0 rounded p-2 hover:bg-hover"
              onClick={() => {
                if (sessionId)
                  void window.modus.skills
                    .openDir({ sessionId, path: skill.path })
                    .catch((cause: unknown) => setError(String(cause)));
              }}
            >
              <IconFolder size={18} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
