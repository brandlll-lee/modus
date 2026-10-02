import { IconFolder } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Field, SelectField } from "../../components/ui/FormControls";
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
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [commands, setCommands] = useState<Array<{ name: string; description?: string }>>([]);
  const [command, setCommand] = useState("mcp");
  const [args, setArgs] = useState("");
  const [result, setResult] = useState("");
  useEffect(() => {
    let active = true;
    let request = 0;
    setLocations([]);
    setReport("");
    setError(undefined);
    setResult("");
    setCommands([]);
    if (!sessionId) return;
    const load = () => {
      const current = ++request;
      setLoading(true);
      void window.modus.mcp
        .status(sessionId)
        .then(async (reports) => {
          const [paths, available] = await Promise.all([
            window.modus.mcp.locations(sessionId),
            window.modus.mcp.commands(sessionId),
          ]);
          if (active && request === current) {
            setLocations(paths);
            setReport(reports.map((entry) => entry.report).join("\n"));
            setCommands(available);
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
  async function runCommand() {
    if (!sessionId || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setResult(await window.modus.mcp.runCommand({ sessionId, name: command, args }));
      const reports = await window.modus.mcp.status(sessionId);
      setReport(reports.map((entry) => entry.report).join("\n"));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="min-w-0 space-y-5">
      <SettingsPageHeader title="MCP" />
      {error ? (
        <p role="alert" className="break-words text-sm text-danger">
          {error}
        </p>
      ) : null}
      {!sessionId ? <p className="text-sm text-fg-muted">No active session.</p> : null}
      {sessionId && loading ? (
        <p role="status" className="text-sm text-fg-muted">
          Loading MCP status...
        </p>
      ) : null}
      {report ? (
        <pre className="overflow-x-auto rounded-lg border border-hairline-soft bg-panel p-4 whitespace-pre-wrap break-words text-sm text-fg-muted">
          {report}
        </pre>
      ) : null}
      {!loading && !error && sessionId && !report ? (
        <p className="text-sm text-fg-muted">The MCP extension returned no status.</p>
      ) : null}
      {commands.length ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void runCommand();
          }}
          className="flex flex-wrap items-end gap-3 border-t border-hairline-soft pt-4"
        >
          <SelectField
            label="MCP command"
            value={command}
            onChange={setCommand}
            options={commands.map((entry) => ({ value: entry.name, label: `/${entry.name}` }))}
          />
          <div className="min-w-[160px] flex-1">
            <Field label="Arguments" value={args} onChange={setArgs} placeholder="" />
          </div>
          <Button type="submit" disabled={busy || loading}>
            {busy ? "Running..." : "Run"}
          </Button>
          <p className="w-full text-xs text-fg-muted">
            {commands.find((entry) => entry.name === command)?.description}
          </p>
        </form>
      ) : null}
      {result ? (
        <p role="status" className="whitespace-pre-wrap break-words text-sm text-fg-muted">
          {result}
        </p>
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
