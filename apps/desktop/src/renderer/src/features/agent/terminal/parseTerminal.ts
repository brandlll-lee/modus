import { getToolUiMeta } from "../../../../../shared/tools";
export type ParsedTerminal = {
  command?: string;
  body: string;
};
export function terminalCommand(name: string, args: unknown): string | undefined {
  const key = getToolUiMeta(name)?.primaryArgKey;
  const value =
    args && typeof args === "object" && key ? (args as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" ? value : undefined;
}
export function parseTerminalOutput(name: string, args: unknown, output: string): ParsedTerminal {
  const command = terminalCommand(name, args);
  return { ...(command ? { command } : {}), body: output.trimEnd() };
}
