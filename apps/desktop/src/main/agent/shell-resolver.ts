/**
 * Cross-platform resolution of a usable POSIX shell for the agent `bash` tool.
 *
 * Why this module exists
 * ----------------------
 * PI's built-in shell resolution (`getShellConfig` in @earendil-works/pi-coding-agent)
 * is broken on common Windows setups:
 *   - It only auto-detects Git Bash under %ProgramFiles%\Git and %ProgramFiles(x86)%\Git.
 *     Git installed on any other drive/location (e.g. F:\Git\Git) is missed.
 *   - Its PATH fallback runs `where bash.exe` and takes the FIRST match, which on
 *     Windows 10/11 is usually C:\Windows\System32\bash.exe — the WSL launcher.
 *   - If WSL has no distro installed, that launcher prints a UTF-16LE banner and
 *     exits non-zero. PI decodes it as UTF-8 → mojibake, and the bash tool "fails".
 *
 * This module concentrates that whole mess behind one small interface. It returns
 * an explicit `shellPath` to inject into PI ONLY when PI's own default would be
 * wrong (Windows). On macOS/Linux PI's default (/bin/bash → which bash → sh) is
 * already correct, so we defer (shellPath: undefined) and just describe it.
 *
 * The resolution logic is a pure function over a `ShellProbe` seam, so every
 * platform branch is unit-testable without touching the real filesystem.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Where the resolved shell came from. */
export type ShellSource =
  | "override" // explicit MODUS_SHELL_PATH env
  | "git-bash" // a real Git Bash / MSYS2 / Cygwin bash
  | "path-bash" // a non-WSL bash found on PATH
  | "wsl" // the System32 WSL launcher, only when a distro is installed
  | "unix-default" // macOS/Linux: defer to PI's own default
  | "none"; // no usable POSIX shell found

export type ResolvedAgentShell = {
  /**
   * Absolute path to inject into PI's bash tool via SettingsManager.shellPath.
   * `undefined` means "defer to PI's built-in resolution" (correct on Unix).
   */
  shellPath: string | undefined;
  platform: NodeJS.Platform;
  /** Human-readable label for prompts and logs, e.g. "Git Bash (F:\\Git\\Git\\bin\\bash.exe)". */
  label: string;
  source: ShellSource;
  /** Whether a working POSIX shell is expected to be available. */
  usable: boolean;
  /** Present when no usable shell was found, with guidance for the user. */
  warning?: string;
};

/**
 * The seam. A small surface over the host environment so resolution can be
 * tested with a fake. Two adapters satisfy it: `nodeShellProbe` (real) and the
 * fakes in shell-resolver.test.ts.
 */
export type ShellProbe = {
  platform: NodeJS.Platform;
  env(key: string): string | undefined;
  exists(path: string): boolean;
  /** Ordered PATH matches for a command name (like `where`/`which -a`). */
  which(command: string): string[];
  /** True if WSL has at least one installed distribution. */
  wslHasDistro(): boolean;
};

function isWslStub(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.includes("\\system32\\") || lower.includes("\\windowsapps\\");
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/** Gather candidate Git Bash paths on Windows, in priority order. */
function windowsGitBashCandidates(probe: ShellProbe): string[] {
  const candidates: string[] = [];

  // 1. Known install roots from environment.
  for (const key of ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "LOCALAPPDATA"]) {
    const base = probe.env(key);
    if (!base) {
      continue;
    }
    candidates.push(join(base, "Git", "bin", "bash.exe"));
    // Scoop / per-user installs land under LOCALAPPDATA\Programs\Git.
    candidates.push(join(base, "Programs", "Git", "bin", "bash.exe"));
  }

  // 2. Derive the Git root from `where git` (handles any drive/location).
  //    git.exe typically lives at <root>\cmd\git.exe or <root>\bin\git.exe,
  //    with bash at <root>\bin\bash.exe and <root>\usr\bin\bash.exe.
  for (const gitPath of [...probe.which("git.exe"), ...probe.which("git")]) {
    const root = dirname(dirname(gitPath));
    candidates.push(join(root, "bin", "bash.exe"));
    candidates.push(join(root, "usr", "bin", "bash.exe"));
  }

  // 3. Any non-WSL bash already on PATH (Cygwin, MSYS2, custom Git).
  for (const bash of [...probe.which("bash.exe"), ...probe.which("bash")]) {
    if (!isWslStub(bash)) {
      candidates.push(bash);
    }
  }

  return uniq(candidates);
}

function resolveWindows(probe: ShellProbe): ResolvedAgentShell {
  const base = { platform: probe.platform } as const;

  // Explicit escape hatch wins.
  const override = probe.env("MODUS_SHELL_PATH");
  if (override && probe.exists(override)) {
    return {
      ...base,
      shellPath: override,
      source: "override",
      usable: true,
      label: `Custom shell (${override})`,
    };
  }

  for (const candidate of windowsGitBashCandidates(probe)) {
    if (probe.exists(candidate)) {
      return {
        ...base,
        shellPath: candidate,
        source: "git-bash",
        usable: true,
        label: `Git Bash (${candidate})`,
      };
    }
  }

  // Only use the WSL launcher when a distro is actually installed; otherwise it
  // emits the UTF-16 "no distribution" banner that started this whole problem.
  const wslStub = [...probe.which("bash.exe"), ...probe.which("bash")].find(isWslStub);
  if (wslStub && probe.exists(wslStub) && probe.wslHasDistro()) {
    return {
      ...base,
      shellPath: wslStub,
      source: "wsl",
      usable: true,
      label: `WSL bash (${wslStub})`,
    };
  }

  return {
    ...base,
    shellPath: undefined,
    source: "none",
    usable: false,
    label: "no POSIX shell found",
    warning:
      "No usable bash was found. The bash tool needs Git for Windows (https://git-scm.com/download/win) " +
      "or a WSL distro. You can also set MODUS_SHELL_PATH to a bash.exe.",
  };
}

const UNIX_BASH_CANDIDATES = [
  "/bin/bash",
  "/usr/bin/bash",
  "/usr/local/bin/bash",
  "/opt/homebrew/bin/bash",
];

function resolveUnix(probe: ShellProbe): ResolvedAgentShell {
  // PI's default already does /bin/bash → which bash → sh correctly on Unix,
  // so we defer (shellPath: undefined) and only produce a label for the prompt.
  const detected = UNIX_BASH_CANDIDATES.find((path) => probe.exists(path));
  return {
    platform: probe.platform,
    shellPath: undefined,
    source: "unix-default",
    usable: true,
    label: detected ?? "the system shell (bash/sh)",
  };
}

/** Pure resolution over the probe seam. The interface is the test surface. */
export function resolveShellWith(probe: ShellProbe): ResolvedAgentShell {
  return probe.platform === "win32" ? resolveWindows(probe) : resolveUnix(probe);
}

/** Real adapter over Node's fs/child_process. */
export function nodeShellProbe(): ShellProbe {
  return {
    platform: process.platform,
    env: (key) => process.env[key],
    exists: (path) => {
      try {
        return existsSync(path);
      } catch {
        return false;
      }
    },
    which: (command) => {
      const finder = process.platform === "win32" ? "where" : "which";
      const args = process.platform === "win32" ? [command] : ["-a", command];
      try {
        const result = spawnSync(finder, args, {
          encoding: "utf-8",
          timeout: 5000,
          windowsHide: true,
        });
        if (result.status !== 0 || !result.stdout) {
          return [];
        }
        return result.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
      } catch {
        return [];
      }
    },
    wslHasDistro: () => {
      if (process.platform !== "win32") {
        return false;
      }
      try {
        // `wsl -l -q` exits non-zero with no output when no distro is installed.
        // Its output is UTF-16LE, so decode the raw buffer explicitly.
        const result = spawnSync("wsl.exe", ["-l", "-q"], { timeout: 5000, windowsHide: true });
        if (result.status !== 0 || !result.stdout) {
          return false;
        }
        const text = Buffer.from(result.stdout).toString("utf16le").replace(/\0/g, "");
        return text.split(/\r?\n/).some((line) => line.trim().length > 0);
      } catch {
        return false;
      }
    },
  };
}

let cached: ResolvedAgentShell | undefined;

/** Resolve (and cache) the agent shell for this process. */
export function resolveAgentShell(): ResolvedAgentShell {
  cached ??= resolveShellWith(nodeShellProbe());
  return cached;
}

/**
 * Build the OS/shell context appended to the agent's system prompt so the model
 * writes shell commands compatible with the actual environment.
 */
export function describeAgentShellForPrompt(shell: ResolvedAgentShell): string {
  const osName =
    shell.platform === "win32" ? "Windows" : shell.platform === "darwin" ? "macOS" : "Linux";

  const lines = [
    "<runtime_environment>",
    `You are running inside the Modus desktop app on ${osName}.`,
    `The \`bash\` tool executes commands through a POSIX shell: ${shell.label}.`,
    "Always write POSIX-compatible shell commands (ls, cat, grep, rg, find, test, head, etc.).",
  ];

  if (shell.platform === "win32") {
    lines.push(
      "This is a POSIX bash (Git Bash/MSYS2), NOT cmd.exe or PowerShell. " +
        "Use forward-slash paths and POSIX syntax; do not use Windows-only commands " +
        "like dir, type, findstr, or PowerShell cmdlets.",
    );
  }

  if (!shell.usable && shell.warning) {
    lines.push(`WARNING: ${shell.warning}`);
  }

  lines.push("</runtime_environment>");
  return lines.join("\n");
}
