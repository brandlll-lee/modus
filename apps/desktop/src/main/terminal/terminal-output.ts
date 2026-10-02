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
