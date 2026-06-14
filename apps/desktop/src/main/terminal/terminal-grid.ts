import headless from "@xterm/headless";

// `@xterm/headless` ships as CommonJS, so the ESM main bundle must default-import
// it and pull `Terminal` off the namespace (a named import throws at runtime).
const { Terminal } = headless;
type Terminal = InstanceType<typeof Terminal>;

/**
 * A headless terminal screen for the AGENT's view of a PTY.
 *
 * The right-panel xterm renders raw PTY bytes for the human; the agent instead
 * needs the *rendered text* it would see on screen. Feeding the raw bytes
 * (cursor moves, carriage returns, line clears) into a real VT emulator and
 * reading back its grid is the only correct way to get that: progress bars and
 * spinners that redraw in place collapse to their final line instead of being
 * appended frame-by-frame (the old `stripAnsi`-and-concatenate approach turned
 * one `npm install` into thousands of duplicated lines).
 *
 * Two text surfaces back the agent's incremental reads:
 *  - `scrollback`: lines that have scrolled out of the viewport. Immutable once
 *    committed, so byte offsets into it are stable — the cursor space the
 *    incremental `readTerminal` relies on. Capped to a tail.
 *  - `screen()`: the live viewport, re-rendered on demand. Volatile (a redraw
 *    rewrites it in place), so it is returned fresh on every read.
 */

/** Scrollback depth kept by the emulator (lines above the viewport). */
const SCROLLBACK_LINES = 5_000;
/** Cap on retained committed scrollback text; older bytes fall off the front. */
const MAX_SCROLLBACK_BYTES = 64 * 1024;

export class TerminalGrid {
  private readonly term: Terminal;
  private rows: number;
  /** Highest scrollback row already folded into `scrollback`. */
  private committedBaseY = 0;
  /** Writes whose async parse hasn't completed yet. */
  private inflight = 0;
  /** Resolvers waiting for the parse queue to drain (see `flush`). */
  private drainers: Array<() => void> = [];
  /** Committed (scrolled-off) text, capped to a tail. Immutable prefix. */
  scrollback = "";
  /** Monotonic count of committed bytes ever produced — the read cursor space. */
  produced = 0;

  constructor(cols: number, rows: number) {
    this.rows = rows;
    this.term = new Terminal({
      cols: Math.max(1, cols),
      rows: Math.max(1, rows),
      scrollback: SCROLLBACK_LINES,
      allowProposedApi: true,
    });
  }

  /** Feed raw PTY output (ANSI included). Commits any newly-scrolled lines. */
  write(data: string): void {
    this.inflight += 1;
    this.term.write(data, () => {
      this.commit();
      this.inflight -= 1;
      if (this.inflight === 0 && this.drainers.length > 0) {
        const drainers = this.drainers;
        this.drainers = [];
        for (const drain of drainers) {
          drain();
        }
      }
    });
  }

  /**
   * Resolve once every queued write has been parsed into the screen. xterm
   * parses asynchronously, so callers that read right after the last write
   * (e.g. the moment a command exits) await this to avoid missing the tail.
   */
  flush(): Promise<void> {
    if (this.inflight === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.drainers.push(resolve));
  }

  resize(cols: number, rows: number): void {
    this.rows = Math.max(1, rows);
    this.term.resize(Math.max(1, cols), this.rows);
  }

  dispose(): void {
    this.term.dispose();
  }

  /**
   * Fold lines that have scrolled out of the viewport into `scrollback`. Only
   * the delta since the last commit is serialized, so this stays cheap under a
   * fast stream regardless of total output size.
   */
  private commit(): void {
    const buffer = this.term.buffer.active;
    for (let y = this.committedBaseY; y < buffer.baseY; y += 1) {
      const line = `${buffer.getLine(y)?.translateToString(true) ?? ""}\n`;
      this.scrollback += line;
      this.produced += Buffer.byteLength(line, "utf8");
    }
    this.committedBaseY = buffer.baseY;
    if (this.scrollback.length > MAX_SCROLLBACK_BYTES) {
      this.scrollback = this.scrollback.slice(-MAX_SCROLLBACK_BYTES);
    }
  }

  /** The live viewport text, trailing blank lines trimmed. */
  screen(): string {
    const buffer = this.term.buffer.active;
    const lines: string[] = [];
    for (let y = 0; y < this.rows; y += 1) {
      lines.push(buffer.getLine(buffer.baseY + y)?.translateToString(true) ?? "");
    }
    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    return lines.join("\n");
  }

  /** Full rendered text: committed scrollback followed by the live viewport. */
  render(): string {
    const screen = this.screen();
    if (!screen) {
      return this.scrollback;
    }
    return this.scrollback ? `${this.scrollback}${screen}` : screen;
  }
}
