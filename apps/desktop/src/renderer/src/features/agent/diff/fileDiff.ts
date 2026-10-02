export type FileDiffLine = {
  kind: "add" | "del" | "context" | "gap";
  newLine?: number;
  oldLine?: number;
  text: string;
};

export type FileDiff = {
  lines: FileDiffLine[];
  added: number;
  removed: number;
  hiddenLineCount: number;
};

export function fileDiff(details: unknown): FileDiff | undefined {
  if (
    !details ||
    typeof details !== "object" ||
    !("diff" in details) ||
    typeof details.diff !== "string"
  )
    return undefined;
  const lines: FileDiffLine[] = [];
  let added = 0;
  let removed = 0;
  let hiddenLineCount = 0;
  for (const raw of details.diff.split("\n")) {
    const match = /^([+\- ]) *(\d*) (.*)$/.exec(raw);
    if (!match) continue;
    const [, sign, number, text] = match;
    const kind = sign === "+" ? "add" : sign === "-" ? "del" : number ? "context" : "gap";
    if (kind === "add") added++;
    if (kind === "del") removed++;
    if (lines.length < 600)
      lines.push({
        kind,
        text: text ?? "",
        ...(number
          ? kind === "add"
            ? { newLine: Number(number) }
            : { oldLine: Number(number) }
          : {}),
      });
    else hiddenLineCount++;
  }
  return lines.length ? { lines, added, removed, hiddenLineCount } : undefined;
}

export function toolTargetPath(args: unknown): string | undefined {
  if (!args || typeof args !== "object" || !("path" in args)) return undefined;
  return typeof args.path === "string" && args.path.trim() ? args.path : undefined;
}
