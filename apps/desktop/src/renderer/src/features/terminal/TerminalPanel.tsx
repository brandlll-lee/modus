import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import type { TerminalInfo } from "../../../../shared/contracts";

type TerminalPanelProps = {
  workspaceId?: string | undefined;
  cwd?: string | undefined;
};

export function TerminalPanel({ workspaceId, cwd }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const terminalInfoRef = useRef<TerminalInfo | null>(null);
  const [terminalInfo, setTerminalInfo] = useState<TerminalInfo | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "JetBrains Mono, Consolas, monospace",
      fontSize: 12,
      theme: {
        background: "#000000",
        foreground: "#d4d4d8",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();
    terminal.write("Modus terminal ready. Open a workspace to spawn a shell.\r\n");
    terminalRef.current = terminal;
    fitRef.current = fitAddon;

    const disposeData = terminal.onData((data) => {
      if (terminalInfoRef.current) {
        void window.modus.terminal.write({ terminalId: terminalInfoRef.current.id, data });
      }
    });

    const unsubscribe = window.modus.terminal.onEvent(
      (event: { type: string; data?: string; exitCode?: number }) => {
        if (event.type === "terminal.data") {
          terminal.write(event.data ?? "");
        }

        if (event.type === "terminal.exit") {
          terminal.write(`\r\n[process exited: ${event.exitCode}]\r\n`);
        }
      },
    );

    return () => {
      unsubscribe();
      disposeData.dispose();
      terminal.dispose();
    };
  }, []);

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
    setTerminalInfo(info);
    terminalRef.current.write(`\r\n[spawned ${info.shell} in ${info.cwd}]\r\n`);
  }

  return (
    <section className="flex min-h-72 flex-col border-zinc-800 border-t">
      <div className="flex items-center justify-between px-4 py-2">
        <h2 className="font-medium text-sm text-zinc-100">Terminal</h2>
        <button
          className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-300 disabled:opacity-40"
          disabled={!workspaceId || !cwd || Boolean(terminalInfo)}
          onClick={() => void spawnTerminal()}
          type="button"
        >
          Spawn shell
        </button>
      </div>
      <div className="min-h-56 flex-1 bg-black p-2" ref={containerRef} />
    </section>
  );
}
