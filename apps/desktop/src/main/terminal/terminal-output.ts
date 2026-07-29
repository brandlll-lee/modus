/**
 * Pure terminal text/cursor helpers, factored out of `terminal-service.ts` so
 * they can be unit-tested without pulling in Electron or the database. The
 * service owns process/state; this module owns the byte-accurate slicing the
 * agent's incremental reads depend on.
 */

// Matches CSI/SGR and the common single-char escapes so stored scrollback is
// plain text (what the model reads and what we persist), not raw control bytes.
const ANSI_PATTERN = new RegExp(
  `${String.fromCharCode(27)}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])`,
  "g",
);

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

/** Last `maxBytes` of text, prefixed with a notice when content was dropped. */
export function tailText(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return { text, truncated: false };
  }
  const sliced = Buffer.from(text, "utf8").subarray(-maxBytes).toString("utf8");
  const fromNewline = sliced.indexOf("\n");
  return { text: fromNewline >= 0 ? sliced.slice(fromNewline + 1) : sliced, truncated: true };
}

/**
 * Human-readable wall-clock duration for a command result. Sub-second values
 * stay in ms; up to a minute show one decimal of seconds; longer values show
 * `MmSs`. Used so the model always sees how long a command actually ran — a
 * launcher that "succeeds" in 200ms reads very differently from a build that
 * ran for 40s.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "?";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${seconds}s`;
}

/**
 * Whether the terminal output so far matches a readiness log pattern (used by
 * background launches with `ready_when.log`). The pattern is a case-insensitive
 * regex; an invalid pattern never throws — it simply doesn't match, so a bad
 * model/user regex can't crash the readiness loop.
 */
export function matchesReadyLog(output: string, pattern: string): boolean {
  if (!pattern) {
    return false;
  }
  try {
    return new RegExp(pattern, "i").test(output);
  } catch {
    return false;
  }
}

/** Compact, single-line label for a command terminal tab. */
export function deriveTitle(command: string): string {
  const oneLine = command.replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
}

/**
 * ConPTY sessions start on the system OEM code page (often CP936 on Chinese
 * Windows). UTF-8 byte TUIs need console CP 65001 *inside* the session —
 * CreatePseudoConsole cannot set it. One prelude, shared by interactive + agent.
 */
const POWERSHELL_UTF8_PRELUDE =
  "$OutputEncoding=[Console]::OutputEncoding=[Console]::InputEncoding=[System.Text.Encoding]::UTF8";
const CMD_UTF8_PRELUDE = "chcp 65001>nul";

function shellKind(shell: string): "powershell" | "cmd" | "posix" {
  const base = shell.toLowerCase();
  if (base.includes("pwsh") || base.includes("powershell")) return "powershell";
  if (base.includes("cmd")) return "cmd";
  return "posix";
}

/**
 * Args for an interactive login shell with UTF-8 console CP already set.
 * Returns `undefined` on POSIX (locale UTF-8 is the default).
 */
export function interactiveShellArgs(shell: string): string[] | undefined {
  switch (shellKind(shell)) {
    case "powershell":
      return ["-NoLogo", "-NoExit", "-Command", POWERSHELL_UTF8_PRELUDE];
    case "cmd":
      return ["/d", "/k", CMD_UTF8_PRELUDE];
    default:
      return undefined;
  }
}

/**
 * Args that make `shell` run a single command and then exit, so the child's
 * exit status becomes the terminal's exit code. Used for agent-run commands.
 */
export function shellCommandArgs(
  shell: string,
  command: string,
  options: { utf8?: boolean } = {},
): string[] {
  switch (shellKind(shell)) {
    case "powershell": {
      const line = options.utf8 ? `${POWERSHELL_UTF8_PRELUDE}; ${command}` : command;
      return ["-NoLogo", "-NoProfile", "-Command", line];
    }
    case "cmd": {
      const line = options.utf8 ? `${CMD_UTF8_PRELUDE} & ${command}` : command;
      return ["/d", "/s", "/c", line];
    }
    default:
      // bash / zsh / sh: login shell so the user's PATH (nvm, asdf, …) is present.
      return ["-lc", command];
  }
}

/**
 * Incremental read over a capped scrollback buffer.
 *
 * The service retains only the last `output` bytes of the `produced` total, so
 * `bufferStart = produced - len(output)` is the earliest byte still readable.
 * - `sinceCursor` at/below `bufferStart` → return the buffer tail (truncated if
 *   the requested start fell off the retained window).
 * - `sinceCursor` inside the buffer → return only the bytes after it.
 * The returned text is always bounded by `maxBytes`.
 */
export function sliceSince(input: {
  output: string;
  produced: number;
  sinceCursor?: number | undefined;
  maxBytes: number;
}): { text: string; truncated: boolean } {
  const bufferedBytes = Buffer.byteLength(input.output, "utf8");
  const bufferStart = input.produced - bufferedBytes;
  const since = input.sinceCursor ?? bufferStart;

  if (since <= bufferStart) {
    const tail = tailText(input.output, input.maxBytes);
    return { text: tail.text, truncated: tail.truncated || since < bufferStart };
  }

  const offset = Math.max(0, since - bufferStart);
  const tail = tailText(
    Buffer.from(input.output, "utf8").subarray(offset).toString("utf8"),
    input.maxBytes,
  );
  return { text: tail.text, truncated: tail.truncated };
}
