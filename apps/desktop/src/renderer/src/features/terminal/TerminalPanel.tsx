import "@xterm/xterm/css/xterm.css";
import { IconPlayerPlay } from "@tabler/icons-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import type { TerminalInfo } from "../../../../shared/contracts";
import { PanelHeader } from "../../components/ui/Panel";
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
  const [terminalInfo, setTerminalInfo] = useState<TerminalInfo | null>(null);

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

    const unsubscribe = window.modus.terminal.onEvent(
      (event: { type: string; data?: string; exitCode?: number }) => {
        if (event.type === "terminal.data") {
          terminal.write(event.data ?? "");
        }

        if (event.type === "terminal.exit") {
          terminal.write(`\r\n\x1b[38;5;245m[process exited: ${event.exitCode}]\x1b[0m\r\n`);
        }
      },
    );

    return () => {
      resizeObserver.disconnect();
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
    terminalRef.current.write(`\x1b[38;5;110m[spawned ${info.shell} in ${info.cwd}]\x1b[0m\r\n`);
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Terminal">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex items-center gap-1.5 text-xs",
              terminalInfo ? "text-fg-muted" : "text-fg-faint",
            )}
          >
            <span
              className={cn("size-1.5 rounded-full", terminalInfo ? "bg-fg-muted" : "bg-fg-faint")}
            />
            {terminalInfo ? "running" : "idle"}
          </span>
          <button
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-subtle transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
            disabled={!workspaceId || !cwd || Boolean(terminalInfo)}
            onClick={() => void spawnTerminal()}
            type="button"
          >
            <IconPlayerPlay size={13} stroke={1.6} /> Spawn shell
          </button>
        </div>
      </PanelHeader>
      <div className="min-h-0 flex-1 bg-panel px-2 pb-2">
        <div className="h-full w-full" ref={containerRef} />
      </div>
    </section>
  );
}
