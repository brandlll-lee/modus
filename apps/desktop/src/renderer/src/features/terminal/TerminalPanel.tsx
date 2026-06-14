import "@xterm/xterm/css/xterm.css";
import {
  IconEraser,
  IconLock,
  IconPlus,
  IconTerminal2,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { type ITheme, Terminal } from "@xterm/xterm";
import { m } from "motion/react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TerminalEvent, TerminalInfo } from "../../../../shared/contracts";
import { EmptyState } from "../../components/ui/Panel";
import { cn } from "../../lib/cn";

const FONT_MONO =
  '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, "SF Mono", Consolas, monospace';

/** "C:\\WINDOWS\\system32\\cmd.exe" → "cmd", "/bin/bash" → "bash". */
function shellLabel(shell: string): string {
  const base = shell.split(/[/\\]/).pop() ?? shell;
  return base.replace(/\.exe$/i, "") || shell;
}

type TerminalTab = TerminalInfo;

/** Agent terminals show their command; user shells show the shell name. */
function tabLabel(tab: TerminalTab): string {
  if (tab.origin === "agent") {
    return tab.title ?? tab.command ?? "agent";
  }
  return shellLabel(tab.shell);
}

/**
 * Per-PTY routing slot owned at the panel level. The panel subscribes to the
 * IPC event stream ONCE (before any spawn) and parks output here; when a
 * `TerminalView` mounts it claims the slot, drains the buffer, and takes over
 * live writes. This is what guarantees the very first shell prompt is never
 * dropped in the gap between `create()` and the xterm being ready.
 */
type TerminalSink = {
  buffer: string[];
  write?: ((data: string) => void) | undefined;
  clear?: (() => void) | undefined;
  exit?: ((code: number) => void) | undefined;
};
type Registry = Map<string, TerminalSink>;

type TerminalPanelProps = {
  workspaceId?: string | undefined;
  cwd?: string | undefined;
  /** Active agent session; agent terminals are scoped to it for isolation. */
  sessionId?: string | undefined;
  /** True when the inspector's Terminal tab is the active one. */
  active?: boolean;
};

/**
 * Per-session isolation, mirrored from the composer bar's scope rule: agent
 * terminals belong to the session that started them and only show there; user
 * shells are workspace-level and shared across that workspace's sessions.
 */
function isTabInScope(tab: TerminalTab, sessionId: string | undefined): boolean {
  if (tab.origin === "agent") {
    return sessionId !== undefined && tab.sessionId === sessionId;
  }
  return true;
}

function token(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return styles.getPropertyValue(name).trim() || fallback;
}

/** Build an xterm theme from the live Modus design tokens so it tracks the app. */
function createTerminalTheme(): ITheme {
  const s = getComputedStyle(document.documentElement);
  const fg = token(s, "--color-fg", "#e4e4e3");
  const bg = token(s, "--color-canvas", "#131314");
  const muted = token(s, "--color-fg-muted", "#b4b4b1");
  const faint = token(s, "--color-fg-faint", "#5a5a5d");
  const success = token(s, "--color-success", "#3fae87");
  const danger = token(s, "--color-danger", "#e5687a");
  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: "rgba(255, 255, 255, 0.16)",
    black: "#15151a",
    red: danger,
    green: success,
    yellow: "#d8b56b",
    blue: "#6aa0ff",
    magenta: "#c08cff",
    cyan: "#56b6c2",
    white: muted,
    brightBlack: faint,
    brightRed: "#ff7b8a",
    brightGreen: "#57c99a",
    brightYellow: "#e6c87b",
    brightBlue: "#8bbbff",
    brightMagenta: "#d0a8ff",
    brightCyan: "#74c7d4",
    brightWhite: fg,
  };
}

/**
 * Coalesce a burst of small IPC chunks into one `term.write` per microtask.
 * xterm buffers internally, but collapsing dozens of writes per frame into one
 * keeps the parser cheap under heavy output (build logs, `cat` of a big file).
 */
function createWriter(term: Terminal): (data: string) => void {
  let queue: string[] = [];
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    if (queue.length === 0) return;
    const data = queue.join("");
    queue = [];
    term.write(data);
  };
  return (data: string) => {
    queue.push(data);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  };
}

/**
 * One live xterm instance bound to one PTY. Kept mounted for the terminal's
 * whole life (hidden when not the active tab) so running programs — vim, top,
 * a dev server — keep their screen state instead of being replayed from text.
 */
function TerminalView({
  tab,
  active,
  registry,
  readOnly = false,
}: {
  tab: TerminalTab;
  active: boolean;
  registry: Registry;
  readOnly?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const id = tab.id;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: FONT_MONO,
      fontSize: 12,
      fontWeight: 400,
      fontWeightBold: 600,
      lineHeight: 1.4,
      letterSpacing: 0,
      scrollback: 10_000,
      theme: createTerminalTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;

    // Ctrl/Cmd+Shift+C copies the selection; Ctrl/Cmd+Shift+V pastes. Plain
    // Ctrl+C is deliberately left alone so it still sends SIGINT to the shell.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.shiftKey && event.key.toLowerCase() === "c") {
        const selection = term.getSelection();
        if (selection) {
          void navigator.clipboard.writeText(selection).catch(() => {});
          return false;
        }
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === "v") {
        void navigator.clipboard
          .readText()
          .then((text) => {
            if (text) term.paste(text);
          })
          .catch(() => {});
        return false;
      }
      return true;
    });

    const dataSub = term.onData((data) => {
      // Agent terminals are read-only in the viewer: the agent owns the PTY, so
      // user keystrokes are swallowed (matching the read-only banner).
      if (readOnly) {
        return;
      }
      void window.modus.terminal.write({ terminalId: id, data });
    });

    // Claim the routing slot: drain whatever buffered before we were ready,
    // then take over live writes / clear / exit.
    const write = createWriter(term);
    const entry = registry.get(id) ?? { buffer: [] };
    for (const chunk of entry.buffer) write(chunk);
    entry.buffer = [];
    entry.write = write;
    entry.clear = () => term.clear();
    entry.exit = (code) => {
      term.write(`\r\n\x1b[38;5;245m[process exited with code ${code}]\x1b[0m\r\n`);
    };
    registry.set(id, entry);

    // Fit + push the new size to the PTY, debounced to a frame and guarded
    // against a hidden (zero-size) container where fit() would throw.
    let raf = 0;
    let lastCols = 0;
    let lastRows = 0;
    const syncSize = () => {
      if (host.clientWidth === 0 || host.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      if (term.cols === lastCols && term.rows === lastRows) return;
      lastCols = term.cols;
      lastRows = term.rows;
      void window.modus.terminal.resize({ terminalId: id, cols: term.cols, rows: term.rows });
    };
    const scheduleSync = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        syncSize();
      });
    };
    const resizeObserver = new ResizeObserver(scheduleSync);
    resizeObserver.observe(host);
    scheduleSync();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      dataSub.dispose();
      const current = registry.get(id);
      if (current) {
        current.write = undefined;
        current.clear = undefined;
        current.exit = undefined;
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [tab.id, registry, readOnly]);

  // Becoming visible (tab switch or panel reveal): re-fit, push size, focus.
  useEffect(() => {
    if (!active) return;
    const term = termRef.current;
    const fit = fitRef.current;
    const host = hostRef.current;
    if (!term || !fit || !host) return;
    const raf = requestAnimationFrame(() => {
      if (host.clientWidth === 0 || host.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      void window.modus.terminal.resize({ terminalId: tab.id, cols: term.cols, rows: term.rows });
      term.scrollToBottom();
      if (tab.status !== "exited") term.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [active, tab.id, tab.status]);

  return (
    <div className={cn("absolute inset-0 px-2.5 py-1.5", !active && "hidden")} ref={hostRef} />
  );
}

export function TerminalPanel({ workspaceId, cwd, sessionId, active = true }: TerminalPanelProps) {
  const registryRef = useRef<Registry>(new Map());
  const tabsRef = useRef<TerminalTab[]>([]);
  const spawning = useRef(false);
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // Subscribe to PTY output exactly once, ahead of any spawn, so the first
  // prompt is parked in the registry until a view claims it.
  useEffect(() => {
    const registry = registryRef.current;
    const unsubscribe = window.modus.terminal.onEvent((event: TerminalEvent) => {
      // A terminal opened elsewhere (the agent running a command) — surface it
      // as a live tab so the user can watch it, deduping against local spawns.
      if (event.type === "terminal.created") {
        const info = event.terminal;
        if (workspaceId && info.workspaceId !== workspaceId) return;
        setTabs((prev) => (prev.some((item) => item.id === info.id) ? prev : [...prev, info]));
        return;
      }
      let entry = registry.get(event.terminalId);
      if (!entry) {
        entry = { buffer: [] };
        registry.set(event.terminalId, entry);
      }
      if (event.type === "terminal.data") {
        if (entry.write) entry.write(event.data);
        else entry.buffer.push(event.data);
        return;
      }
      if (event.type === "terminal.exit") {
        entry.exit?.(event.exitCode);
        setTabs((prev) =>
          prev.map((item) =>
            item.id === event.terminalId
              ? {
                  ...item,
                  status: "exited" as const,
                  exitCode: event.exitCode,
                  endedAt: new Date().toISOString(),
                }
              : item,
          ),
        );
      }
    });
    return unsubscribe;
  }, [workspaceId]);

  const spawn = useCallback(async (): Promise<void> => {
    if (!workspaceId || !cwd || spawning.current) return;
    spawning.current = true;
    try {
      const info = await window.modus.terminal.create({ workspaceId, cwd, cols: 80, rows: 24 });
      setTabs((prev) => [...prev, info]);
      setActiveId(info.id);
    } finally {
      spawning.current = false;
    }
  }, [workspaceId, cwd]);

  // Reconnect existing sessions when the terminal tab opens; auto-start one if
  // there are none. Gated on `active` so we never spawn a hidden background
  // shell the user didn't ask for.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      const all = await window.modus.terminal.list();
      if (cancelled) return;
      const mine = workspaceId
        ? all.filter((item: TerminalInfo) => item.workspaceId === workspaceId)
        : all;
      setTabs(mine);
      setActiveId((current) => current ?? mine[0]?.id ?? null);
      if (mine.length === 0 && cwd) {
        await spawn();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, workspaceId, cwd, spawn]);

  const closeTab = useCallback((id: string): void => {
    void window.modus.terminal.remove(id).catch(() => {});
    registryRef.current.delete(id);
    const prev = tabsRef.current;
    const index = prev.findIndex((item) => item.id === id);
    const next = prev.filter((item) => item.id !== id);
    setTabs(next);
    setActiveId((current) =>
      current === id ? (next[Math.min(index, next.length - 1)]?.id ?? null) : current,
    );
  }, []);

  const clearActive = useCallback((): void => {
    if (activeId) registryRef.current.get(activeId)?.clear?.();
  }, [activeId]);

  const visibleTabs = useMemo(
    () => tabs.filter((tab) => isTabInScope(tab, sessionId)),
    [tabs, sessionId],
  );
  const agentTabs = visibleTabs.filter((tab) => tab.origin === "agent");
  const userTabs = visibleTabs.filter((tab) => tab.origin === "user");
  const visibleKey = visibleTabs.map((tab) => tab.id).join(",");

  // Keep the selection inside the visible set: switching session/project can
  // hide the active agent terminal, so fall back to the first visible one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: visibleKey encodes the visible-tab identity that should retrigger this; visibleTabs is recreated each render.
  useEffect(() => {
    setActiveId((current) =>
      current && visibleTabs.some((tab) => tab.id === current)
        ? current
        : (visibleTabs[0]?.id ?? null),
    );
  }, [visibleKey]);

  const activeTab = visibleTabs.find((item) => item.id === activeId) ?? null;
  const hasWorkspace = Boolean(workspaceId && cwd);
  const agentOwnsActive = activeTab?.origin === "agent" && activeTab.status !== "exited";

  return (
    <section className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-hairline border-b px-2">
        <div className="flex min-w-0 items-center gap-2 text-sm text-fg">
          <IconTerminal2 className="shrink-0 text-fg-subtle" size={15} stroke={1.65} />
          <span className="truncate">{activeTab ? tabLabel(activeTab) : "Terminal"}</span>
          {activeTab?.origin === "agent" ? (
            <span className="shrink-0 rounded bg-accent-soft px-1 py-px font-medium text-2xs text-accent">
              Agent
            </span>
          ) : null}
          {activeTab?.status === "exited" ? (
            <span className="shrink-0 font-mono text-2xs text-fg-faint">
              exited {activeTab.exitCode}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <TermAction
            disabled={!activeTab || activeTab.status === "exited"}
            label="Clear terminal"
            onClick={clearActive}
          >
            <IconEraser size={15} stroke={1.65} />
          </TermAction>
          <TermAction
            disabled={!activeTab}
            label="Kill terminal"
            onClick={() => activeId && closeTab(activeId)}
          >
            <IconTrash size={15} stroke={1.65} />
          </TermAction>
          <TermAction disabled={!hasWorkspace} label="New terminal" onClick={() => void spawn()}>
            <IconPlus size={15} stroke={1.65} />
          </TermAction>
        </div>
      </div>

      {hasWorkspace ? (
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[200px] shrink-0 flex-col border-hairline border-r">
            <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto px-1.5 py-2">
              {agentTabs.length > 0 ? (
                <TerminalGroup
                  activeId={activeId}
                  label="Agent"
                  onClose={closeTab}
                  onSelect={setActiveId}
                  tabs={agentTabs}
                />
              ) : null}
              {userTabs.length > 0 ? (
                <TerminalGroup
                  activeId={activeId}
                  label="Terminals"
                  onClose={closeTab}
                  onSelect={setActiveId}
                  tabs={userTabs}
                />
              ) : null}
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col bg-canvas">
            {agentOwnsActive ? (
              <div className="flex shrink-0 items-center gap-1.5 border-hairline-soft border-b bg-accent-soft/40 px-3 py-1 text-2xs text-fg-muted">
                <IconLock className="shrink-0 text-accent" size={12} stroke={1.8} />
                Agent is using this terminal — read-only
              </div>
            ) : null}
            <div className="relative min-h-0 flex-1">
              {tabs.map((tab) => (
                <TerminalView
                  active={tab.id === activeId}
                  key={tab.id}
                  readOnly={tab.origin === "agent"}
                  registry={registryRef.current}
                  tab={tab}
                />
              ))}
              {visibleTabs.length === 0 ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-fg-faint">
                  No active terminals. Press + to start one.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <EmptyState
          className="h-full"
          hint="Open a workspace to use the terminal."
          icon={<IconTerminal2 size={22} stroke={1.4} />}
        />
      )}
    </section>
  );
}

function TerminalGroup({
  label,
  tabs,
  activeId,
  onSelect,
  onClose,
}: {
  label: string;
  tabs: TerminalTab[];
  activeId: string | null;
  onSelect(id: string): void;
  onClose(id: string): void;
}) {
  return (
    <div className="space-y-0.5">
      <div className="px-1.5 pb-0.5 text-2xs uppercase tracking-wide text-fg-faint">{label}</div>
      {tabs.map((tab) => (
        <TerminalTabRow
          active={tab.id === activeId}
          key={tab.id}
          onClose={() => onClose(tab.id)}
          onSelect={() => onSelect(tab.id)}
          tab={tab}
        />
      ))}
    </div>
  );
}

function TerminalTabRow({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: TerminalTab;
  active: boolean;
  onSelect(): void;
  onClose(): void;
}) {
  const exited = tab.status === "exited";
  return (
    <m.div
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "group flex h-7 items-center gap-1 rounded-md pr-1 pl-2 transition-colors",
        active ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
        exited && "opacity-50",
      )}
      initial={{ opacity: 0, y: 2 }}
      transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
        onClick={onSelect}
        title={tab.command ?? tabLabel(tab)}
        type="button"
      >
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            exited ? "bg-fg-faint" : tab.origin === "agent" ? "bg-accent" : "bg-success",
          )}
        />
        <span className="min-w-0 flex-1 truncate">{tabLabel(tab)}</span>
      </button>
      <button
        aria-label="Close terminal"
        className="flex size-5 shrink-0 items-center justify-center rounded text-fg-faint opacity-0 transition-all hover:bg-hover hover:text-fg group-hover:opacity-100"
        onClick={onClose}
        type="button"
      >
        <IconX size={13} stroke={1.8} />
      </button>
    </m.div>
  );
}

function TermAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick(): void;
  disabled?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      className="flex size-7 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg-subtle disabled:opacity-40 disabled:hover:bg-transparent"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}
