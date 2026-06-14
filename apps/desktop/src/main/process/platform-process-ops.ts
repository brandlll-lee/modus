import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Cross-platform operations on an OS process by its real pid. This is the one
 * place platform differences live: every other layer (app launch, kill, status)
 * depends on this interface, never on `process.platform`. Adding a platform or
 * changing how a title is read is a single, isolated change here.
 */
export interface PlatformProcessOps {
  /** True if a process with this pid currently exists. */
  isAlive(pid: number): boolean;
  /** Process name and, where the OS exposes it, the main window title. */
  describe(pid: number): Promise<ProcessDescription>;
  /** Terminate the process and its descendants (frees ports/windows it held). */
  killTree(pid: number): Promise<void>;
}

export type ProcessDescription = {
  pid: number;
  name: string;
  /** Main window title — available on Windows; best-effort/absent elsewhere. */
  windowTitle?: string;
};

/** Liveness via signal 0 — works on every platform Node supports. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = the process exists but is owned by another user → still alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/** Parse `Get-Process` name + MainWindowTitle (one per line). Pure → testable. */
export function parseWindowsProcess(stdout: string, pid: number): ProcessDescription {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim());
  const name = lines[0] ?? "";
  const windowTitle = lines[1] ?? "";
  return {
    pid,
    name: name || `pid ${pid}`,
    ...(windowTitle ? { windowTitle } : {}),
  };
}

/** Parse `ps -o comm=` output to a bare process name. Pure → testable. */
export function parseUnixProcess(stdout: string, pid: number): ProcessDescription {
  const command = stdout.trim();
  const name = command.split("/").pop() || `pid ${pid}`;
  return { pid, name };
}

class WindowsProcessOps implements PlatformProcessOps {
  isAlive(pid: number): boolean {
    return pidAlive(pid);
  }

  async describe(pid: number): Promise<ProcessDescription> {
    const script =
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; ` +
      "if ($p) { Write-Output $p.ProcessName; Write-Output $p.MainWindowTitle }";
    try {
      const { stdout } = await run(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { timeout: 5000, windowsHide: true },
      );
      return parseWindowsProcess(stdout, pid);
    } catch {
      return { pid, name: `pid ${pid}` };
    }
  }

  async killTree(pid: number): Promise<void> {
    await run("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }).catch(
      () => undefined,
    );
  }
}

class UnixProcessOps implements PlatformProcessOps {
  isAlive(pid: number): boolean {
    return pidAlive(pid);
  }

  async describe(pid: number): Promise<ProcessDescription> {
    try {
      const { stdout } = await run("ps", ["-p", String(pid), "-o", "comm="], { timeout: 5000 });
      return parseUnixProcess(stdout, pid);
    } catch {
      return { pid, name: `pid ${pid}` };
    }
  }

  async killTree(pid: number): Promise<void> {
    // A detached child is its own process-group leader, so the negative pid
    // signals the whole tree; fall back to the bare pid if the group send fails.
    const signal = (target: number, sig: NodeJS.Signals): boolean => {
      try {
        process.kill(target, sig);
        return true;
      } catch {
        return false;
      }
    };
    if (!signal(-pid, "SIGTERM")) {
      signal(pid, "SIGTERM");
    }
    await delay(300);
    if (pidAlive(pid)) {
      if (!signal(-pid, "SIGKILL")) {
        signal(pid, "SIGKILL");
      }
    }
  }
}

/** Resolve the process-ops implementation for the current (or given) platform. */
export function createPlatformProcessOps(
  platform: NodeJS.Platform = process.platform,
): PlatformProcessOps {
  // macOS and Linux share the POSIX implementation; Windows is distinct.
  return platform === "win32" ? new WindowsProcessOps() : new UnixProcessOps();
}
