import "@xterm/xterm/css/xterm.css";
import { IconPlus, IconTerminal2 } from "@tabler/icons-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { m } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalEvent, TerminalInfo } from "../../../../shared/contracts";
import { cn } from "../../lib/cn";

type TerminalPanelProps = {
  workspaceId?: string | undefined;
  cwd?: string | undefined;
};

export function TerminalPanel({ workspaceId, cwd }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const terminalInfoRef = useRef<TerminalInfo | null>(null);
  const buffersRef = useRef<Record<string, string>>({});
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);

  const activeTerminal = terminals.find((terminal) => terminal.id === activeTerminalId) ?? null;

  const refreshTerminals = useCallback(async () => {
    const nextTerminals: TerminalInfo[] = await window.modus.terminal.list();
    const workspaceTerminals = workspaceId
      ? nextTerminals.filter((terminal) => terminal.workspaceId === workspaceId)
      : nextTerminals;
    setTerminals(workspaceTerminals);
    setActiveTerminalId((current) => current ?? workspaceTerminals[0]?.id ?? null);
  }, [workspaceId]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "JetBrains Mono, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.4,
      theme: {
        background: "#171718",
        foreground: "#ededec",
        cursor: "#9d9d9a",
        selectionBackground: "#ffffff22",
        black: "#171718",
        brightBlack: "#4c4c50",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();
    terminal.write("\x1b[38;5;245mModus terminal ready. Spawn a shell to begin.\x1b[0m\r\n");
    terminalRef.current = terminal;
    fitRef.current = fitAddon;

    // 容器尺寸变化时重新适配（切换 Tab、窗口缩放）
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        if (terminalInfoRef.current) {
          void window.modus.terminal.resize({
            terminalId: terminalInfoRef.current.id,
            cols: terminal.cols,
            rows: terminal.rows,
          });
        }
      } catch {
        /* 容器隐藏时 fit 可能抛错，忽略 */
      }
    });
    resizeObserver.observe(containerRef.current);

    const disposeData = terminal.onData((data) => {
      if (terminalInfoRef.current) {
        void window.modus.terminal.write({ terminalId: terminalInfoRef.current.id, data });
      }
    });

    const unsubscribe = window.modus.terminal.onEvent((event: TerminalEvent) => {
      if (event.type === "terminal.data") {
        buffersRef.current[event.terminalId] =
          (buffersRef.current[event.terminalId] ?? "") + event.data;
      }

      if (event.type === "terminal.data" && event.terminalId === terminalInfoRef.current?.id) {
        terminal.write(event.data);
      }

      if (event.type === "terminal.exit") {
        const exitText = `\r\n\x1b[38;5;245m[process exited: ${event.exitCode}]\x1b[0m\r\n`;
        buffersRef.current[event.terminalId] =
          (buffersRef.current[event.terminalId] ?? "") + exitText;
        if (event.terminalId === terminalInfoRef.current?.id) {
          terminal.write(exitText);
        }
        void refreshTerminals();
      }
    });

    return () => {
      resizeObserver.disconnect();
      unsubscribe();
      disposeData.dispose();
      terminal.dispose();
    };
  }, [refreshTerminals]);

  async function spawnTerminal(): Promise<void> {
    if (!workspaceId || !cwd || !terminalRef.current || !fitRef.current) {
      return;
    }

    fitRef.current.fit();
    const info = await window.modus.terminal.create({
      workspaceId,
      cwd,
      cols: terminalRef.current.cols,
      rows: terminalRef.current.rows,
    });
    terminalInfoRef.current = info;
    buffersRef.current[info.id] = `\x1b[38;5;110m[spawned ${info.shell} in ${info.cwd}]\x1b[0m\r\n`;
    setTerminals((current) => [...current.filter((terminal) => terminal.id !== info.id), info]);
    setActiveTerminalId(info.id);
  }

  useEffect(() => {
    void refreshTerminals();
  }, [refreshTerminals]);

  useEffect(() => {
    const nextActive = terminals.find((terminal) => terminal.id === activeTerminalId) ?? null;
    terminalInfoRef.current = nextActive;
    if (!terminalRef.current || !nextActive) {
      return;
    }

    terminalRef.current.clear();
    terminalRef.current.write(
      buffersRef.current[nextActive.id] ||
        `\x1b[38;5;110m${nextActive.shell} ${nextActive.cwd}\x1b[0m\r\n`,
    );
    fitRef.current?.fit();
  }, [activeTerminalId, terminals]);

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-hairline border-b px-2">
        <div className="flex min-w-0 items-center gap-2 text-sm text-fg">
          <IconTerminal2 className="text-fg-subtle" size={15} stroke={1.65} />
          <span className="truncate">{activeTerminal?.shell ?? "pwsh"}</span>
        </div>
        <button
          aria-label="New terminal"
          className="flex size-7 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg-subtle disabled:opacity-40"
          disabled={!workspaceId || !cwd}
          onClick={() => void spawnTerminal()}
          type="button"
        >
          <IconPlus size={15} stroke={1.65} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 bg-panel">
        <div className="w-[250px] shrink-0 border-hairline border-r px-2 py-3">
          <div className="mb-2 text-xs text-fg-subtle">
            {Math.max(terminals.length, 1)} Terminal
          </div>
          <div className="space-y-1">
            {getTerminalItems(terminals).map((terminal) => {
              const selected =
                terminal.id === activeTerminalId || (!activeTerminalId && terminal.id === "idle");
              return (
                <m.button
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors",
                    selected ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
                  )}
                  initial={{ opacity: 0, y: 3 }}
                  key={terminal.id}
                  onClick={() => terminal.id !== "idle" && setActiveTerminalId(terminal.id)}
                  transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                  type="button"
                >
                  <IconTerminal2 className="shrink-0 text-fg-subtle" size={15} stroke={1.65} />
                  <span className="truncate">{terminal.shell}</span>
                </m.button>
              );
            })}
          </div>
        </div>
        <div className="min-h-0 flex-1 px-2 py-2">
          <div className="h-full w-full" ref={containerRef} />
        </div>
      </div>
    </section>
  );
}

function getTerminalItems(terminals: TerminalInfo[]): Array<Pick<TerminalInfo, "id" | "shell">> {
  return terminals.length ? terminals : [{ id: "idle", shell: "pwsh" }];
}
