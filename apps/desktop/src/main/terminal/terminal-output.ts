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

/** Compact, single-line label for a command terminal tab. */
export function deriveTitle(command: string): string {
  const oneLine = command.replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
}

/**
 * Args that make `shell` run a single command and then exit, so the child's
 * exit status becomes the terminal's exit code. Used for agent-run commands.
 */
export function shellCommandArgs(shell: string, command: string): string[] {
  const base = shell.toLowerCase();
  if (base.includes("pwsh") || base.includes("powershell")) {
    return ["-NoLogo", "-NoProfile", "-Command", command];
  }
  if (base.includes("cmd")) {
    return ["/d", "/s", "/c", command];
  }
  // bash / zsh / sh: login shell so the user's PATH (nvm, asdf, …) is present.
  return ["-lc", command];
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
