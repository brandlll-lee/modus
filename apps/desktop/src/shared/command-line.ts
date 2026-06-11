/**
 * Minimal shell-style command line splitting/joining for the MCP server form:
 * users paste one line ("npx -y @scope/server ."), we store command + args.
 * Supports double/single quotes; no escapes/expansion — this is a UI helper,
 * not a shell.
 */

export function splitCommandLine(line: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let hasToken = false;

  for (const char of line) {
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      hasToken = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (hasToken) {
        parts.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }
    current += char;
    hasToken = true;
  }
  if (hasToken) {
    parts.push(current);
  }
  return parts;
}

/** Inverse of splitCommandLine — quotes tokens containing whitespace. */
export function joinCommandLine(parts: string[]): string {
  return parts
    .map((part) => {
      if (part === "") {
        return '""';
      }
      return /[\s"']/.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part;
    })
    .join(" ");
}
