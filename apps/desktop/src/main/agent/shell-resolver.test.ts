import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeAgentShellForPrompt, resolveShellWith, type ShellProbe } from "./shell-resolver";

function probe(overrides: Partial<ShellProbe>): ShellProbe {
  return {
    platform: "win32",
    env: () => undefined,
    exists: () => false,
    which: () => [],
    wslHasDistro: () => false,
    ...overrides,
  };
}

// Build paths the same way the module does, so assertions hold on any OS the
// test suite runs on.
const SYSTEM32_BASH = "C:\\Windows\\System32\\bash.exe";
const WINDOWSAPPS_BASH = "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe";

describe("resolveShellWith — Windows", () => {
  it("finds Git Bash on a non-standard drive via `where git`, skipping the WSL stub", () => {
    const gitExe = join("F:", "Git", "Git", "cmd", "git.exe");
    const gitBash = join(dirname(dirname(gitExe)), "bin", "bash.exe");

    const result = resolveShellWith(
      probe({
        which: (cmd) => {
          if (cmd === "git.exe") return [gitExe];
          // System32 WSL stub is first on PATH, real Git Bash second.
          if (cmd === "bash.exe") return [SYSTEM32_BASH, gitBash];
          return [];
        },
        exists: (p) => p === gitBash,
      }),
    );

    expect(result.shellPath).toBe(gitBash);
    expect(result.source).toBe("git-bash");
    expect(result.usable).toBe(true);
  });

  it("never selects the System32 WSL stub when no distro is installed", () => {
    const result = resolveShellWith(
      probe({
        which: (cmd) => (cmd === "bash.exe" ? [SYSTEM32_BASH, WINDOWSAPPS_BASH] : []),
        exists: (p) => p === SYSTEM32_BASH || p === WINDOWSAPPS_BASH,
        wslHasDistro: () => false,
      }),
    );

    expect(result.shellPath).toBeUndefined();
    expect(result.source).toBe("none");
    expect(result.usable).toBe(false);
    expect(result.warning).toBeDefined();
  });

  it("falls back to the WSL stub only when a distro is installed", () => {
    const result = resolveShellWith(
      probe({
        which: (cmd) => (cmd === "bash.exe" ? [SYSTEM32_BASH] : []),
        exists: (p) => p === SYSTEM32_BASH,
        wslHasDistro: () => true,
      }),
    );

    expect(result.shellPath).toBe(SYSTEM32_BASH);
    expect(result.source).toBe("wsl");
  });

  it("prefers Git Bash under %ProgramFiles%", () => {
    const programFiles = "C:\\Program Files";
    const gitBash = join(programFiles, "Git", "bin", "bash.exe");

    const result = resolveShellWith(
      probe({
        env: (key) => (key === "ProgramFiles" ? programFiles : undefined),
        exists: (p) => p === gitBash,
      }),
    );

    expect(result.shellPath).toBe(gitBash);
    expect(result.source).toBe("git-bash");
  });

  it("honors the MODUS_SHELL_PATH override above everything else", () => {
    const custom = "D:\\tools\\busybox\\bash.exe";
    const result = resolveShellWith(
      probe({
        env: (key) => (key === "MODUS_SHELL_PATH" ? custom : undefined),
        exists: (p) => p === custom,
        which: (cmd) => (cmd === "bash.exe" ? [SYSTEM32_BASH] : []),
      }),
    );

    expect(result.shellPath).toBe(custom);
    expect(result.source).toBe("override");
  });
});

describe("resolveShellWith — macOS/Linux", () => {
  it("defers to PI's default on macOS and labels the detected bash", () => {
    const result = resolveShellWith(
      probe({ platform: "darwin", exists: (p) => p === "/bin/bash" }),
    );

    expect(result.shellPath).toBeUndefined();
    expect(result.source).toBe("unix-default");
    expect(result.usable).toBe(true);
    expect(result.label).toBe("/bin/bash");
  });

  it("defers to PI's default on Linux", () => {
    const result = resolveShellWith(probe({ platform: "linux", exists: (p) => p === "/bin/bash" }));

    expect(result.shellPath).toBeUndefined();
    expect(result.source).toBe("unix-default");
    expect(result.usable).toBe(true);
  });
});

describe("describeAgentShellForPrompt", () => {
  it("tells the model it's a POSIX bash, not cmd/PowerShell, on Windows", () => {
    const text = describeAgentShellForPrompt({
      platform: "win32",
      shellPath: "F:\\Git\\Git\\bin\\bash.exe",
      source: "git-bash",
      usable: true,
      label: "Git Bash (F:\\Git\\Git\\bin\\bash.exe)",
    });

    expect(text).toContain("Windows");
    expect(text).toContain("POSIX");
    expect(text).toMatch(/not cmd\.exe or PowerShell/i);
  });

  it("surfaces the warning when no shell is usable", () => {
    const text = describeAgentShellForPrompt({
      platform: "win32",
      shellPath: undefined,
      source: "none",
      usable: false,
      label: "no POSIX shell found",
      warning: "No usable bash was found.",
    });

    expect(text).toContain("WARNING");
    expect(text).toContain("No usable bash was found.");
  });
});
