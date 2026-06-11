/**
 * Pure helpers for the terminal tool card. Terminal tools serialize their
 * result as text (see main/agent/tools/terminal-tools.ts), so the renderer gets
 * a single `output` string. These helpers pull out the command, a status line,
 * and the body so the card can render a clean terminal-style preview without the
 * tool's framing leaking into the UI.
 */

export type TerminalToolName =
  | "terminal_run"
  | "terminal_read"
  | "terminal_list"
  | "terminal_write"
  | "terminal_kill"
  | "bash";

/** Tools that render as a Cursor-style terminal card instead of a flat row. */
export const TERMINAL_CARD_TOOLS = new Set<string>(["terminal_run", "terminal_read", "bash"]);

export type ParsedTerminal = {
  /** Command line, when one is recoverable from args/output. */
  command?: string;
  /** One-line status (e.g. "running", "exited 0"), when present. */
  status?: string;
  /** The terminal body, framing stripped. */
  body: string;
  /** Earlier output was dropped upstream. */
  truncated: boolean;
};

function str(value: unknown): string {
  return value == null ? "" : String(value);
}

/** Command argument for terminal_run / bash, when available. */
export function terminalCommand(name: string, args: unknown): string | undefined {
  const a = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  if (name === "bash" || name === "terminal_run") {
    const command = str(a.command).trim();
    return command || undefined;
  }
  if (name === "terminal_read" || name === "terminal_write" || name === "terminal_kill") {
    const id = str(a.terminal_id).trim();
    return id ? `terminal ${id}` : undefined;
  }
  return undefined;
}

/**
 * Parse the tool's `output` text into command/status/body.
 *
 * `terminal_run` frames output as:
 *   `$ <command>\n[terminal <id> — <status>; cursor=N]\n\n<body>`
 * `terminal_read` frames it as:
 *   `[terminal <id> · <status> · …cursor=N]\n\n<body>`
 * `bash` has no framing — the whole output is the body.
 */
export function parseTerminalOutput(name: string, args: unknown, output: string): ParsedTerminal {
  const fallbackCommand = terminalCommand(name, args);
  const truncated = /\[earlier output truncated\]/.test(output);
  const cleaned = output.replace(/\n?\[earlier output truncated\]/g, "");

  if (name === "bash") {
    return {
      ...(fallbackCommand ? { command: fallbackCommand } : {}),
      body: cleaned.trimEnd(),
      truncated,
    };
  }

  const lines = cleaned.split("\n");
  let command = fallbackCommand;
  let status: string | undefined;
  let bodyStart = 0;

  // `$ <command>` header (terminal_run).
  if (lines[0]?.startsWith("$ ")) {
    command = lines[0].slice(2).trim();
    bodyStart = 1;
  }

  // `[terminal … — status; cursor=N]` or `[terminal … · status · …]` status line.
  const statusLine = lines[bodyStart];
  if (statusLine?.startsWith("[") && /terminal/i.test(statusLine)) {
    status = extractStatus(statusLine);
    bodyStart += 1;
    // Skip the blank separator the formatter inserts before the body.
    if (lines[bodyStart] === "") {
      bodyStart += 1;
    }
  }

  const body = lines.slice(bodyStart).join("\n").trim();
  return {
    ...(command ? { command } : {}),
    ...(status ? { status } : {}),
    body: body === "(no new output)" ? "" : body,
    truncated,
  };
}

/** Pull a short status token ("running", "exited 0") from a framing line. */
function extractStatus(line: string): string | undefined {
  const inner = line.replace(/^\[/, "").replace(/\]$/, "");
  // terminal_run: "terminal <id> — <status>; cursor=N"
  const dash = inner.split(" — ")[1];
  if (dash) {
    return dash.split(";")[0]?.trim();
  }
  // terminal_read: "terminal <id> · <status> · pid … · cursor=N"
  const parts = inner.split(" · ");
  if (parts.length >= 2 && parts[1]) {
    return parts[1].trim();
  }
  return undefined;
}

/** Last `maxLines` non-trailing-empty lines of `body`, for the collapsed preview. */
export function tailLines(body: string, maxLines: number): { text: string; hidden: number } {
  if (!body) {
    return { text: "", hidden: 0 };
  }
  const lines = body.split("\n");
  if (lines.length <= maxLines) {
    return { text: body, hidden: 0 };
  }
  return {
    text: lines.slice(-maxLines).join("\n"),
    hidden: lines.length - maxLines,
  };
}
