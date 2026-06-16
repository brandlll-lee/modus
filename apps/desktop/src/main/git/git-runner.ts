import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { classifyGitError, GitError } from "./git-errors";

const execFileAsync = promisify(execFile);

/**
 * Hardened, cross-platform git command runner — the single place every git
 * invocation flows through. Mirrors the flags wezterm/Warp use for a headless
 * host:
 *  - `GIT_TERMINAL_PROMPT=0` / `GIT_EDITOR=true`: network + commit ops fail fast
 *    instead of blocking the main process on an interactive prompt.
 *  - `GIT_OPTIONAL_LOCKS=0`: read commands don't take the repo lock.
 *  - `-c diff.autoRefreshIndex=false`: read commands never rewrite the index's
 *    stat cache, so merely *viewing* status can't make a clean tree look dirty
 *    or contend for `index.lock`.
 */
const BASE_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_EDITOR: "true",
};

const GLOBAL_ARGS = ["-c", "diff.autoRefreshIndex=false"];

const MAX_BUFFER = 1024 * 1024 * 20;

/* ── Cross-platform binary resolution (P4) ──────────────────────────────────
 * Under WSL, `appendWindowsPath` puts `/mnt/c/.../git.exe` on PATH, so a bare
 * `git` can resolve to the Windows binary — dramatically slower, mishandles
 * Linux paths, and breaks Linux-side hooks. On WSL we pick the first `git` on
 * PATH that is NOT under `/mnt/*`. Everywhere else the OS lookup of `git` is
 * correct. Cached for the process (PATH is effectively static). */
let cachedGitBinary: string | undefined;

function isWsl(): boolean {
  return process.platform === "linux" && existsSync("/proc/sys/fs/binfmt_misc/WSLInterop");
}

function isExecutableFile(path: string): boolean {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return false;
    // On POSIX require an exec bit; on Windows presence is enough.
    return process.platform === "win32" || (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/** Resolve the git binary, skipping Windows `git.exe` reachable via `/mnt/*` under WSL. */
export function resolveGitBinary(): string {
  if (cachedGitBinary) return cachedGitBinary;
  if (!isWsl()) {
    cachedGitBinary = "git";
    return cachedGitBinary;
  }
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir || dir.startsWith("/mnt")) continue;
    const candidate = join(dir, "git");
    if (isExecutableFile(candidate)) {
      cachedGitBinary = candidate;
      return cachedGitBinary;
    }
  }
  // No Linux-side git found; fall back to bare name (may hit a Windows .exe).
  cachedGitBinary = "git";
  return cachedGitBinary;
}

export type RunGitOptions = {
  /** Extra env vars merged over the hardened base (e.g. a temporary index file). */
  env?: Record<string, string> | undefined;
  /**
   * Full PATH to expose to the child so user-installed hook binaries (e.g.
   * `git-lfs` invoked by a `pre-push` hook) resolve. Packaged Electron strips
   * the user's shell PATH, which is why push/commit must pass it explicitly.
   */
  hookPath?: string | undefined;
};

function buildEnv(options: RunGitOptions): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...BASE_ENV,
    ...(options.hookPath ? { PATH: options.hookPath } : {}),
    ...options.env,
  };
}

function toGitError(error: unknown): GitError {
  const stderr =
    typeof error === "object" && error !== null && "stderr" in error
      ? String((error as { stderr?: unknown }).stderr ?? "").trim()
      : "";
  if (stderr) return classifyGitError(stderr);
  if (error instanceof Error) return new GitError("unknown", error.message, error.message);
  return new GitError("unknown", String(error));
}

/** Run git; throws a structured {@link GitError} on failure. Returns raw stdout. */
export async function runGit(
  cwd: string,
  args: string[],
  options: RunGitOptions = {},
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(resolveGitBinary(), [...GLOBAL_ARGS, ...args], {
      cwd,
      windowsHide: true,
      maxBuffer: MAX_BUFFER,
      env: buildEnv(options),
    });
    return stdout;
  } catch (error) {
    throw toGitError(error);
  }
}

/** Run git tolerantly: never throws, returns trimmed stdout ("" on failure). */
export async function runGitSafe(cwd: string, args: string[]): Promise<string> {
  try {
    return (await runGit(cwd, args)).trim();
  } catch {
    return "";
  }
}

/** Like {@link runGitSafe} but preserves trailing whitespace (blob contents are not trimmed). */
export async function runGitSafeRaw(cwd: string, args: string[]): Promise<string> {
  try {
    return await runGit(cwd, args);
  } catch {
    return "";
  }
}

/**
 * Run a `git diff`-family command. Diff commands exit 1 (not an error) when
 * differences exist under `--exit-code`/`--quiet`; treat that as success and
 * return stdout. Exit > 1 is a real failure.
 */
export async function runGitDiff(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(resolveGitBinary(), [...GLOBAL_ARGS, ...args], {
      cwd,
      windowsHide: true,
      maxBuffer: MAX_BUFFER,
      env: buildEnv({}),
    });
    return stdout;
  } catch (error) {
    const e = error as { code?: number; stdout?: string };
    if (e.code === 1 && typeof e.stdout === "string") {
      return e.stdout;
    }
    throw toGitError(error);
  }
}

/** True when a git operation holds the index lock — callers must not write. */
export function isIndexLocked(gitDir: string): boolean {
  return existsSync(join(gitDir, "index.lock"));
}

/* ── Hook PATH (P4) ─────────────────────────────────────────────────────────
 * A packaged GUI app on macOS/Linux does NOT inherit the user's login-shell
 * PATH, so a `pre-push`/`pre-commit` hook that shells out to a user-installed
 * binary (e.g. `git-lfs`, in a Homebrew prefix) fails. We resolve the login
 * shell's PATH once and pass it to hook-running ops. Windows GUIs inherit PATH,
 * so this is a no-op there. Defensive: short timeout, falls back to the current
 * PATH, never throws. */
let cachedUserPath: string | undefined | null = null;

export async function resolveUserPath(): Promise<string | undefined> {
  if (process.platform === "win32") return undefined;
  if (cachedUserPath !== null) return cachedUserPath;
  const shell = process.env.SHELL || "/bin/bash";
  try {
    const { stdout } = await execFileAsync(shell, ["-lc", 'printf %s "$PATH"'], {
      timeout: 2500,
      windowsHide: true,
    });
    cachedUserPath = stdout.trim() || process.env.PATH;
  } catch {
    cachedUserPath = process.env.PATH;
  }
  return cachedUserPath;
}
