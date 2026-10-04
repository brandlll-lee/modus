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
  signal?: AbortSignal | undefined;
  maxBuffer?: number | undefined;
};

function buildEnv(options: RunGitOptions): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...BASE_ENV,
    ...options.env,
  };
}

function toGitError(error: unknown): GitError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
  ) {
    return new GitError("output-too-large", "Git output exceeded the safe preview limit.");
  }
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
  options.signal?.throwIfAborted();
  try {
    const { stdout } = await execFileAsync(resolveGitBinary(), [...GLOBAL_ARGS, ...args], {
      cwd,
      windowsHide: true,
      maxBuffer: options.maxBuffer ?? MAX_BUFFER,
      env: buildEnv(options),
      signal: options.signal,
    });
    return stdout;
  } catch (error) {
    throw toGitError(error);
  }
}

/** Run git tolerantly: never throws, returns trimmed stdout ("" on failure). */
export async function runGitSafe(
  cwd: string,
  args: string[],
  options: RunGitOptions = {},
): Promise<string> {
  try {
    return (await runGit(cwd, args, options)).trim();
  } catch {
    return "";
  }
}
