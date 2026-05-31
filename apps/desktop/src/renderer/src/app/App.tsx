import { useEffect, useState } from "react";
import type { AgentEvent, AgentSessionInfo, WorkspaceInfo } from "../../../shared/contracts";
import { StatusPill } from "../components/StatusPill";
import { DiffPanel } from "../features/diff/DiffPanel";
import { TerminalPanel } from "../features/terminal/TerminalPanel";
import { changedFiles, sessions, timeline } from "./sample-data";

type SecurityState = {
  contextIsolation: boolean;
  nodeIntegration: boolean;
  sandbox: boolean;
  senderValidation: boolean;
};

function getSessionTone(status: string): "neutral" | "success" | "warning" {
  if (status === "Running") {
    return "success";
  }

  if (status === "Queued") {
    return "warning";
  }

  return "neutral";
}

function Sidebar({
  workspaces,
  activeWorkspace,
  onOpenWorkspace,
  onSelectWorkspace,
  agentSession,
}: {
  workspaces: WorkspaceInfo[];
  activeWorkspace: WorkspaceInfo | null;
  onOpenWorkspace(): void;
  onSelectWorkspace(workspace: WorkspaceInfo): void;
  agentSession: AgentSessionInfo | null;
}) {
  return (
    <aside className="flex min-w-72 flex-col border-zinc-800 border-r bg-zinc-950/80">
      <div className="border-zinc-800 border-b p-4">
        <div className="text-zinc-500 text-xs uppercase tracking-[0.22em]">Workspaces</div>
        <div className="mt-3 space-y-2">
          {workspaces.map((workspace) => (
            <button
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 text-left transition hover:border-zinc-700 hover:bg-zinc-900"
              key={workspace.id}
              onClick={() => onSelectWorkspace(workspace)}
              type="button"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-sm text-zinc-100">{workspace.displayName}</span>
                <StatusPill tone={activeWorkspace?.id === workspace.id ? "success" : "neutral"}>
                  {activeWorkspace?.id === workspace.id ? "Active" : "Recent"}
                </StatusPill>
              </div>
              <div className="mt-1 truncate text-xs text-zinc-500">{workspace.rootPath}</div>
            </button>
          ))}
          <button
            className="w-full rounded-xl border border-dashed border-zinc-700 p-3 text-center text-sm text-zinc-300 transition hover:bg-zinc-900"
            onClick={onOpenWorkspace}
            type="button"
          >
            Open local workspace
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="flex items-center justify-between">
          <div className="text-zinc-500 text-xs uppercase tracking-[0.22em]">Agent Sessions</div>
          <button
            className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
            type="button"
          >
            New
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {agentSession ? (
            <button
              className="w-full rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-left"
              type="button"
            >
              <div className="font-medium text-sm text-zinc-100">{agentSession.title}</div>
              <div className="mt-1 text-xs text-emerald-300">{agentSession.status}</div>
            </button>
          ) : null}
          {sessions.map((session) => (
            <button
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-left transition hover:border-zinc-700 hover:bg-zinc-900"
              key={session.id}
              type="button"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-sm text-zinc-100">{session.title}</div>
                  <div className="mt-1 text-xs text-zinc-500">{session.branch}</div>
                </div>
                <StatusPill tone={getSessionTone(session.status)}>{session.status}</StatusPill>
              </div>
              <div className="mt-3 text-xs text-zinc-500">{session.model}</div>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function Timeline({
  activeWorkspace,
  agentSession,
  agentEvents,
  onCreateAgent,
  onPromptAgent,
}: {
  activeWorkspace: WorkspaceInfo | null;
  agentSession: AgentSessionInfo | null;
  agentEvents: Array<{ id: string; event: AgentEvent }>;
  onCreateAgent(): void;
  onPromptAgent(message: string): void;
}) {
  const [prompt, setPrompt] = useState("");

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-zinc-950">
      <header className="flex items-center justify-between border-zinc-800 border-b px-6 py-4">
        <div>
          <h1 className="font-semibold text-lg text-zinc-50">Agent Window</h1>
          <p className="text-sm text-zinc-500">
            {activeWorkspace
              ? activeWorkspace.rootPath
              : "Open a local repository to start a pi-powered session."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill tone="success">M2-M7</StatusPill>
          <StatusPill>{activeWorkspace?.isGitRepository ? "Git" : "No Git"}</StatusPill>
        </div>
      </header>

      <section className="flex-1 overflow-auto px-6 py-5">
        <div className="mx-auto max-w-4xl space-y-4">
          {timeline.map((item) => (
            <article
              className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4"
              key={item.id}
            >
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm text-zinc-100">{item.title}</div>
                <StatusPill tone={item.role === "tool" ? "warning" : "neutral"}>
                  {item.role}
                </StatusPill>
              </div>
              <p className="mt-3 text-sm leading-6 text-zinc-300">{item.body}</p>
            </article>
          ))}
          {agentEvents.map(({ event, id }) => (
            <article className="rounded-2xl border border-zinc-800 bg-black/40 p-4" key={id}>
              <div className="font-medium text-sm text-zinc-100">{event.type}</div>
              <pre className="mt-3 whitespace-pre-wrap text-xs text-zinc-400">
                {JSON.stringify(event, null, 2)}
              </pre>
            </article>
          ))}
        </div>
      </section>

      <footer className="border-zinc-800 border-t bg-zinc-950 p-4">
        <div className="mx-auto max-w-4xl rounded-2xl border border-zinc-800 bg-zinc-900 p-3 shadow-2xl">
          <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
            <span>@file</span>
            <span>@folder</span>
            <span>@git-diff</span>
            <span>@terminal</span>
            <span>@session</span>
          </div>
          <textarea
            className="min-h-20 w-full resize-none bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ask the local agent to work on this repo..."
            value={prompt}
          />
          <div className="mt-3 flex items-center justify-between">
            <div className="text-xs text-zinc-500">
              Enter queues while running. Ctrl+Enter sends now.
            </div>
            <button
              className="rounded-xl bg-zinc-100 px-4 py-2 font-medium text-sm text-zinc-950"
              disabled={!agentSession}
              onClick={() => {
                onPromptAgent(prompt);
                setPrompt("");
              }}
              type="button"
            >
              Send
            </button>
            <button
              className="ml-2 rounded-xl border border-zinc-700 px-4 py-2 font-medium text-sm text-zinc-200 disabled:opacity-40"
              disabled={!activeWorkspace || Boolean(agentSession)}
              onClick={onCreateAgent}
              type="button"
            >
              Start pi
            </button>
          </div>
        </div>
      </footer>
    </main>
  );
}

function Inspector({
  securityState,
  activeWorkspace,
}: {
  securityState: SecurityState | null;
  activeWorkspace: WorkspaceInfo | null;
}) {
  return (
    <aside className="flex w-96 flex-col border-zinc-800 border-l bg-zinc-950/90">
      <div className="border-zinc-800 border-b p-4">
        <div className="text-zinc-500 text-xs uppercase tracking-[0.22em]">Inspector</div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <StatusPill>Diff</StatusPill>
          <StatusPill>Terminal</StatusPill>
          <StatusPill>Context</StatusPill>
        </div>
      </div>

      <section className="border-zinc-800 border-b p-4">
        <h2 className="font-medium text-sm text-zinc-100">Changed Files</h2>
        <div className="mt-3 space-y-2">
          {changedFiles.map((file) => (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3" key={file.path}>
              <div className="truncate text-sm text-zinc-200">{file.path}</div>
              <div className="mt-1 flex justify-between text-xs text-zinc-500">
                <span>{file.status}</span>
                <span>{file.lines}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-zinc-800 border-b p-4">
        <h2 className="font-medium text-sm text-zinc-100">Security Baseline</h2>
        <div className="mt-3 space-y-2 text-sm">
          {securityState ? (
            Object.entries(securityState).map(([key, value]) => (
              <div className="flex items-center justify-between" key={key}>
                <span className="text-zinc-500">{key}</span>
                <StatusPill tone={value ? "success" : "danger"}>{String(value)}</StatusPill>
              </div>
            ))
          ) : (
            <div className="text-zinc-500">Loading preload IPC state...</div>
          )}
        </div>
      </section>

      <DiffPanel cwd={activeWorkspace?.rootPath} />
      <TerminalPanel cwd={activeWorkspace?.rootPath} workspaceId={activeWorkspace?.id} />
    </aside>
  );
}

export function App() {
  const [version, setVersion] = useState<string>("dev");
  const [securityState, setSecurityState] = useState<SecurityState | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceInfo | null>(null);
  const [agentSession, setAgentSession] = useState<AgentSessionInfo | null>(null);
  const [agentEvents, setAgentEvents] = useState<Array<{ id: string; event: AgentEvent }>>([]);

  useEffect(() => {
    void window.modus.app.version().then(setVersion);
    void window.modus.app.securityState().then(setSecurityState);
    void window.modus.workspace.list().then((items: WorkspaceInfo[]) => {
      setWorkspaces(items);
      setActiveWorkspace(items[0] ?? null);
    });
    return window.modus.agent.onEvent((event: AgentEvent) => {
      setAgentEvents((events) => [
        ...events.slice(-20),
        { id: `${Date.now()}:${crypto.randomUUID()}`, event },
      ]);
    });
  }, []);

  async function openWorkspace(): Promise<void> {
    const workspace = await window.modus.workspace.open();

    if (!workspace) {
      return;
    }

    setActiveWorkspace(workspace);
    setWorkspaces(await window.modus.workspace.list());
  }

  async function createAgent(): Promise<void> {
    if (!activeWorkspace) {
      return;
    }

    setAgentSession(
      await window.modus.agent.create({
        workspaceId: activeWorkspace.id,
        cwd: activeWorkspace.rootPath,
        title: "Modus local agent",
      }),
    );
  }

  function promptAgent(message: string): void {
    if (!agentSession || !message.trim()) {
      return;
    }

    void window.modus.agent.prompt({ sessionId: agentSession.id, message });
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <div className="flex h-10 items-center justify-between border-zinc-800 border-b bg-zinc-950 px-4">
        <div className="font-semibold text-sm">Modus</div>
        <div className="text-xs text-zinc-500">v{version} · local-first desktop</div>
      </div>
      <div className="flex min-h-0 flex-1">
        <Sidebar
          activeWorkspace={activeWorkspace}
          agentSession={agentSession}
          onOpenWorkspace={() => void openWorkspace()}
          onSelectWorkspace={setActiveWorkspace}
          workspaces={workspaces}
        />
        <Timeline
          activeWorkspace={activeWorkspace}
          agentEvents={agentEvents}
          agentSession={agentSession}
          onCreateAgent={() => void createAgent()}
          onPromptAgent={promptAgent}
        />
        <Inspector activeWorkspace={activeWorkspace} securityState={securityState} />
      </div>
    </div>
  );
}
