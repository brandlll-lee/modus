import { describe, expect, it } from "vitest";
import { TerminalGrid } from "./terminal-grid";

/** xterm parses writes on a timer, so let the screen settle before reading. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 40));
}

describe("TerminalGrid", () => {
  it("renders plain lines as written", async () => {
    const grid = new TerminalGrid(80, 24);
    grid.write("hello\r\nworld\r\n");
    await flush();
    const text = grid.render();
    expect(text).toContain("hello");
    expect(text).toContain("world");
    grid.dispose();
  });

  it("collapses a carriage-return progress redraw to its final frame", async () => {
    const grid = new TerminalGrid(80, 24);
    grid.write("downloading 10%\rdownloading 55%\rdownloading 100%\r\ndone\r\n");
    await flush();
    const text = grid.render();
    expect(text).toContain("downloading 100%");
    expect(text).not.toContain("downloading 10%");
    expect(text).not.toContain("downloading 55%");
    expect(text).toContain("done");
    grid.dispose();
  });

  it("does not duplicate when a region is rewritten via cursor-up (npm/gauge pattern)", async () => {
    const grid = new TerminalGrid(80, 24);
    grid.write("a\r\nb\r\nc\r\n");
    grid.write("\x1b[3A"); // cursor up 3 rows, back onto the "a" line
    grid.write("X\r\nY\r\nZ\r\n");
    await flush();
    const lines = grid
      .render()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    // The rewrite overwrote each original line in place — no leftover a/b/c.
    expect(lines).toEqual(["X", "Y", "Z"]);
    grid.dispose();
  });

  it("commits scrolled-off lines as monotonic scrollback bytes", async () => {
    const grid = new TerminalGrid(80, 3); // tiny viewport forces scrolling
    for (let i = 0; i < 20; i += 1) {
      grid.write(`line ${i}\r\n`);
    }
    await flush();
    expect(grid.produced).toBeGreaterThan(0);
    expect(grid.render()).toContain("line 19");
    grid.dispose();
  });
});
