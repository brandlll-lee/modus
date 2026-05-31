export function readJsonLines(
  chunk: Buffer | string,
  state: { buffer: string },
  onValue: (value: unknown) => void,
): void {
  state.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");

  while (true) {
    const newlineIndex = state.buffer.indexOf("\n");

    if (newlineIndex === -1) {
      return;
    }

    let line = state.buffer.slice(0, newlineIndex);
    state.buffer = state.buffer.slice(newlineIndex + 1);

    if (line.endsWith("\r")) {
      line = line.slice(0, -1);
    }

    if (!line.trim()) {
      continue;
    }

    onValue(JSON.parse(line));
  }
}
