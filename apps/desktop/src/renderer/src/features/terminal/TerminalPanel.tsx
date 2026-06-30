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
import { animate, m, useMotionValue } from "motion/react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TerminalEvent, TerminalInfo } from "../../../../shared/contracts";
import { EmptyState } from "../../components/ui/Panel";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";

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

const DEFAULT_TERMINAL_LIST_WIDTH = 240;
const TERMINAL_LIST_TRANSITION = { duration: 0.2, ease: [0.22, 1, 0.36, 1] } as const;

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

/** Terminal owns its palette; app UI tokens should not make the shell feel like a document. */
function createTerminalTheme(): ITheme {
  const s = getComputedStyle(document.documentElement);
  const fg = token(s, "--color-terminal-fg", "#cccccc");
  const bg = token(s, "--color-terminal-bg", "#0c0c0c");
  const selection = token(s, "--color-terminal-selection", "rgba(255, 255, 255, 0.22)");
  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: selection,
    black: token(s, "--color-terminal-ansi-black", "#0c0c0c"),
    red: token(s, "--color-terminal-ansi-red", "#c50f1f"),
    green: token(s, "--color-terminal-ansi-green", "#13a10e"),
    yellow: token(s, "--color-terminal-ansi-yellow", "#c19c00"),
    blue: token(s, "--color-terminal-ansi-blue", "#0037da"),
    magenta: token(s, "--color-terminal-ansi-magenta", "#881798"),
    cyan: token(s, "--color-terminal-ansi-cyan", "#3a96dd"),
    white: token(s, "--color-terminal-ansi-white", "#cccccc"),
    brightBlack: token(s, "--color-terminal-ansi-bright-black", "#767676"),
    brightRed: token(s, "--color-terminal-ansi-bright-red", "#e74856"),
    brightGreen: token(s, "--color-terminal-ansi-bright-green", "#16c60c"),
    brightYellow: token(s, "--color-terminal-ansi-bright-yellow", "#f9f1a5"),
    brightBlue: token(s, "--color-terminal-ansi-bright-blue", "#3b78ff"),
    brightMagenta: token(s, "--color-terminal-ansi-bright-magenta", "#b4009e"),
    brightCyan: token(s, "--color-terminal-ansi-bright-cyan", "#61d6d6"),
    brightWhite: token(s, "--color-terminal-ansi-bright-white", "#f2f2f2"),
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
      fontFamily: token(
        getComputedStyle(document.documentElement),
        "--font-terminal",
        '"Cascadia Mono", "Cascadia Code", "SFMono-Regular", Consolas, Menlo, "DejaVu Sans Mono", monospace',
      ),
      fontSize: 13,
      fontWeight: 400,
      fontWeightBold: 600,
      lineHeight: 1.2,
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
    void document.fonts?.ready.then(() => {
      scheduleSync();
      term.refresh(0, term.rows - 1);
    });

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
    <div
      className={cn("modus-terminal-host absolute inset-x-3 top-2 bottom-2", !active && "hidden")}
      ref={hostRef}
    />
  );
}

export function TerminalPanel({ workspaceId, cwd, sessionId, active = true }: TerminalPanelProps) {
  const registryRef = useRef<Registry>(new Map());
  const tabsRef = useRef<TerminalTab[]>([]);
  const spawning = useRef(false);
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const sidebarW = useMotionValue(DEFAULT_TERMINAL_LIST_WIDTH);

  const addTab = useCallback((info: TerminalTab): void => {
    setTabs((prev) => (prev.some((item) => item.id === info.id) ? prev : [...prev, info]));
  }, []);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    const controls = animate(
      sidebarW,
      sidebarOpen ? DEFAULT_TERMINAL_LIST_WIDTH : 0,
      TERMINAL_LIST_TRANSITION,
    );
    return () => controls.stop();
  }, [sidebarOpen, sidebarW]);

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
        addTab(info);
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
  }, [addTab, workspaceId]);

  const createTab = useCallback(
    async (targetCwd: string | null | undefined): Promise<TerminalTab | undefined> => {
      if (!workspaceId) return undefined;
      const info = await window.modus.terminal.create({
        workspaceId,
        ...(targetCwd !== null && targetCwd !== undefined ? { cwd: targetCwd } : {}),
        cols: 80,
        rows: 24,
      });
      addTab(info);
      return info;
    },
    [addTab, workspaceId],
  );

  const spawn = useCallback(async (): Promise<TerminalTab | undefined> => {
    if (spawning.current) return undefined;
    spawning.current = true;
    try {
      const info = await createTab(cwd);
      if (info) setActiveId(info.id);
      return info;
    } finally {
      spawning.current = false;
    }
  }, [createTab, cwd]);

  const spawnDefaultTerminals = useCallback(async (): Promise<void> => {
    if (!workspaceId || !cwd || spawning.current) return;
    spawning.current = true;
    try {
      const project = await createTab(cwd);
      const home = await createTab(null);
      setActiveId(project?.id ?? home?.id ?? null);
    } finally {
      spawning.current = false;
    }
  }, [createTab, cwd, workspaceId]);

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
      if (!mine.some((item: TerminalInfo) => item.origin === "user") && cwd) {
        await spawnDefaultTerminals();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, workspaceId, cwd, spawnDefaultTerminals]);

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
    <section className="flex h-full min-h-0 flex-col">
      <div className="toolbar-row flex shrink-0 items-center justify-end gap-1 border-hairline border-b pr-1.5 pl-3">
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <TerminalAction
            disabled={!activeTab || activeTab.status === "exited"}
            label="Clear terminal"
            onClick={clearActive}
          >
            <IconEraser size={18} stroke={1.7} />
          </TerminalAction>
          <TerminalAction
            disabled={!activeTab}
            label="Kill terminal"
            onClick={() => activeId && closeTab(activeId)}
          >
            <IconTrash size={18} stroke={1.7} />
          </TerminalAction>
          <TerminalAction
            disabled={!hasWorkspace}
            label="New terminal"
            onClick={() => void spawn()}
          >
            <IconPlus size={18} stroke={1.7} />
          </TerminalAction>
          <TerminalAction
            active={sidebarOpen}
            label={sidebarOpen ? "Hide terminal list" : "Show terminal list"}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <IconTerminal2 size={18} stroke={1.7} />
          </TerminalAction>
        </div>
      </div>

      {hasWorkspace ? (
        <div className="flex min-h-0 flex-1">
          <m.div
            className="shrink-0 overflow-hidden border-hairline border-r"
            style={{ width: sidebarW }}
          >
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex h-10 shrink-0 items-center gap-2 px-2 text-fg-muted text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {visibleTabs.length} {visibleTabs.length === 1 ? "Terminal" : "Terminals"}
                </span>
                <TerminalAction
                  disabled={!hasWorkspace}
                  label="New terminal"
                  onClick={() => void spawn()}
                >
                  <IconPlus size={18} stroke={1.7} />
                </TerminalAction>
              </div>
              <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1.5 py-1">
                {visibleTabs.length > 0 ? (
                  visibleTabs.map((tab) => (
                    <TerminalTabRow
                      active={tab.id === activeId}
                      key={tab.id}
                      onClose={() => closeTab(tab.id)}
                      onSelect={() => setActiveId(tab.id)}
                      tab={tab}
                    />
                  ))
                ) : (
                  <div className="px-3 py-2 text-fg-faint text-xs">No terminals</div>
                )}
              </div>
            </div>
          </m.div>

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
    <div
      className={cn(
        "group flex h-8 items-center gap-1 rounded-md pr-1 transition-colors",
        active ? "bg-active text-fg" : "text-fg hover:bg-active/80",
        exited && "opacity-50",
      )}
    >
      <button
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-l-md px-2 text-left text-sm"
        onClick={onSelect}
        title={tab.command ?? tabLabel(tab)}
        type="button"
      >
        <IconTerminal2 className="toolbar-icon shrink-0" size={18} stroke={1.7} />
        <span className="min-w-0 flex-1 truncate">{tabLabel(tab)}</span>
        {tab.origin === "agent" ? (
          <span className="shrink-0 rounded bg-accent-soft px-1 py-px font-medium text-2xs text-accent">
            Agent
          </span>
        ) : null}
      </button>
      <button
        aria-label="Close terminal"
        className="flex size-5 shrink-0 items-center justify-center rounded-md text-fg-muted opacity-0 transition-opacity hover:bg-hover hover:text-fg group-hover:opacity-100 focus-visible:opacity-100"
        onClick={onClose}
        type="button"
      >
        <IconX size={14} stroke={1.8} />
      </button>
    </div>
  );
}

function TerminalAction({
  active = false,
  label,
  onClick,
  disabled,
  children,
}: {
  active?: boolean;
  label: string;
  onClick(): void;
  disabled?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label} side="bottom">
      <button
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "toolbar-icon-button flex items-center justify-center rounded-md transition-colors hover:bg-hover disabled:opacity-35 disabled:hover:bg-transparent",
          active && "bg-active",
        )}
        data-active={active}
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        {children}
      </button>
    </Tooltip>
  );
}
