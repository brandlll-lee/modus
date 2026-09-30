import { IconFolder, IconRefresh } from "@tabler/icons-react";
import { useEffect, useState } from "react";

export function McpSettingsPanel({
  cwd,
  sessionId,
}: {
  cwd: string | undefined;
  sessionId: string | undefined;
}) {
  const [locations, setLocations] = useState<string[]>([]);
  const [report, setReport] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    let request = 0;
    setLocations([]);
    setReport("");
    setError(undefined);
    if (!sessionId) return;
    const load = () => {
      const current = ++request;
      void Promise.all([window.modus.mcp.locations(sessionId), window.modus.mcp.status(sessionId)])
        .then(([paths, reports]) => {
          if (active && request === current) {
            setLocations(paths);
            setReport(reports.map((entry) => entry.report).join("\n"));
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
      await window.modus.mcp.sync(cwd);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="min-w-0 space-y-5">
      <header className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">MCP</h2>
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
      {error ? (
        <p role="alert" className="break-words text-sm text-danger">
          {error}
        </p>
      ) : null}
      {!sessionId ? <p className="text-sm text-fg-muted">No active session.</p> : null}
      {report ? (
        <pre className="whitespace-pre-wrap break-words text-sm text-fg-muted">{report}</pre>
      ) : null}
      <div className="divide-y divide-hairline-soft">
        {locations.map((path) => (
          <div key={path} className="flex min-w-0 items-center gap-3 py-3">
            <p className="min-w-0 flex-1 break-all text-xs text-fg-muted">{path}</p>
            <button
              type="button"
              title="Open configuration folder"
              aria-label="Open configuration folder"
              className="shrink-0 rounded p-2 hover:bg-hover"
              onClick={() => {
                if (sessionId)
                  void window.modus.mcp
                    .openConfig({ sessionId, path })
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
