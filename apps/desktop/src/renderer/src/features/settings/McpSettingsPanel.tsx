import { IconFolder, IconRefresh } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { ResourceRow } from "../../components/ui/ResourceRow";
import { SettingsPageHeader } from "../../components/ui/SettingsPageHeader";

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
        description="See the MCP servers and configuration sources loaded by the current session."
        title="MCP"
      />
      {error ? (
        <p role="alert" className="break-words text-sm text-danger">
          {error}
        </p>
      ) : null}
      {!sessionId ? <p className="text-sm text-fg-muted">No active session.</p> : null}
      {report ? (
        <pre className="overflow-x-auto rounded-lg border border-hairline-soft bg-panel p-4 whitespace-pre-wrap break-words text-sm text-fg-muted">
          {report}
        </pre>
      ) : null}
      <div className="space-y-1">
        {locations.map((path) => (
          <ResourceRow
            key={path}
            action={{
              icon: <IconFolder aria-hidden size={16} stroke={1.8} />,
              label: "Open configuration folder",
              onClick: () => {
                if (sessionId)
                  void window.modus.mcp
                    .openConfig({ sessionId, path })
                    .catch((cause: unknown) => setError(String(cause)));
              },
            }}
            title={path}
          />
        ))}
      </div>
    </section>
  );
}
