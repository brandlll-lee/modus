import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

const OUTPUT_CAP = 60_000;
const RESULT_BODY_CAP = 24_000;
const STDERR_CAP = 20_000;
const SOURCE_FILE_LIMIT = 1;
const INDEX_TIMEOUT_MS = 5 * 60_000;
const QUERY_TIMEOUT_MS = 90_000;
// biome-ignore lint/complexity/useRegexLiterals: regex literals with ESC trip noControlCharactersInRegex.
const ANSI_ESCAPE = new RegExp("\\x1b(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])", "g");

export type FastCodebaseProgress = {
  phase: "indexing" | "querying";
  message: string;
};

export type FastCodebaseResult = {
  text: string;
  details: {
    indexDir: string;
    indexed: boolean;
    kernel: string;
    project: string;
    query: string;
    workspace: string;
  };
};

type CodeGraphCommand = {
  args: string[];
  command: string;
  label: string;
};

type CodeGraphCallResult = {
  exitCode: number;
  isError: boolean;
  stderr: string;
  text: string;
};

type CodeGraphQueryResult = {
  node?: {
    filePath?: string;
    kind?: string;
    name?: string;
    qualifiedName?: string;
    startLine?: number;
  };
};

export type CodeGraphRunner = (
  args: string[],
  options: {
    cwd: string;
    signal?: AbortSignal | undefined;
    timeoutMs?: number | undefined;
    onProgress?: ((line: string) => void) | undefined;
  },
) => Promise<CodeGraphCallResult>;

export type FastCodebaseInput = {
  cwd: string;
  includeCode?: boolean | undefined;
  limit?: number | undefined;
  query: string;
  workspacePath?: string | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: ((progress: FastCodebaseProgress) => void) | undefined;
  runner?: CodeGraphRunner | undefined;
};

function appendCapped(current: string, chunk: string, cap: number): string {
  const next = `${current}${chunk}`;
  return next.length > cap ? next.slice(next.length - cap) : next;
}

function capResultBody(text: string): string {
  if (text.length <= RESULT_BODY_CAP) {
    return text;
  }
  return `${text.slice(0, RESULT_BODY_CAP).trimEnd()}\n\n[Fast Codebase output truncated. Use a narrower query or read the listed files.]`;
}

function codeGraphIndexDir(cwd: string): string {
  return join(cwd, ".codegraph");
}

function isCodeGraphInitialized(cwd: string): boolean {
  return existsSync(join(codeGraphIndexDir(cwd), "codegraph.db"));
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, "");
}

function progressLines(text: string): string[] {
  return stripAnsi(text)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function bundlePackageName(platform = process.platform, arch = process.arch): string {
  return `codegraph-${platform}-${arch}`;
}

function bundleEntry(dir: string): CodeGraphCommand | undefined {
  const node = join(dir, process.platform === "win32" ? "node.exe" : "node");
  const script = join(dir, "lib", "dist", "bin", "codegraph.js");
  if (!existsSync(node) || !existsSync(script)) {
    return undefined;
  }
  return { command: node, args: [script], label: dir };
}

export function resolveCodeGraphCommand(): CodeGraphCommand {
  if (process.env.MODUS_CODEGRAPH_BIN) {
    return {
      command: process.env.MODUS_CODEGRAPH_BIN,
      args: [],
      label: process.env.MODUS_CODEGRAPH_BIN,
    };
  }
  const resourcesPath =
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? process.cwd();
  const packageName = bundlePackageName();
  const candidates = [
    join(resourcesPath, "bin", "codegraph"),
    join(process.cwd(), "resources", "bin", "codegraph"),
    join(process.cwd(), "node_modules", "@colbymchenry", packageName),
    join(process.cwd(), "..", "..", "node_modules", "@colbymchenry", packageName),
  ];
  for (const dir of candidates) {
    const entry = bundleEntry(dir);
    if (entry) {
      return entry;
    }
  }
  return { command: "codegraph", args: [], label: "codegraph" };
}

export function resolveFastCodebaseBinary(): string {
  return resolveCodeGraphCommand().label;
}

function killProcessTree(child: ChildProcess): void {
  if (!child.pid) {
    child.kill("SIGTERM");
    return;
  }
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.on("error", () => child.kill("SIGKILL"));
    return;
  }
  child.kill("SIGTERM");
}

export const runCodeGraphCli: CodeGraphRunner = (args, options) =>
  new Promise<CodeGraphCallResult>((resolveCall, reject) => {
    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }
    const executable = resolveCodeGraphCommand();
    let stdout = "";
    let stderr = "";
    let lastProgress = "";
    let aborted = false;
    let timedOut = false;
    let settled = false;
    const child = spawn(executable.command, [...executable.args, ...args], {
      cwd: options.cwd,
      env: {
        ...process.env,
        CODEGRAPH_TELEMETRY: "off",
        DO_NOT_TRACK: "1",
        NO_COLOR: "1",
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const timeout =
      options.timeoutMs && options.timeoutMs > 0
        ? globalThis.setTimeout(() => {
            timedOut = true;
            killProcessTree(child);
          }, options.timeoutMs)
        : undefined;
    const finish = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout !== undefined) {
        globalThis.clearTimeout(timeout);
      }
      options.signal?.removeEventListener("abort", abort);
      fn();
    };
    const abort = (): void => {
      aborted = true;
      killProcessTree(child);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    const onData = (chunk: unknown, stream: "stdout" | "stderr"): void => {
      const text = String(chunk);
      if (stream === "stdout") {
        stdout = appendCapped(stdout, text, OUTPUT_CAP);
      } else {
        stderr = appendCapped(stderr, text, STDERR_CAP);
      }
      if (options.onProgress) {
        for (const line of progressLines(text)) {
          if (line !== lastProgress) {
            lastProgress = line;
            options.onProgress(line);
          }
        }
      }
    };
    child.stdout.on("data", (chunk) => onData(chunk, "stdout"));
    child.stderr.on("data", (chunk) => onData(chunk, "stderr"));
    child.on("error", (error) => {
      finish(() =>
        reject(
          new Error(
            `Fast Codebase kernel unavailable: ${error.message}. Bundle CodeGraph or set MODUS_CODEGRAPH_BIN.`,
          ),
        ),
      );
    });
    child.on("close", (code) => {
      finish(() => {
        if (aborted || options.signal?.aborted) {
          reject(abortError());
          return;
        }
        if (timedOut) {
          reject(
            new Error(
              `Fast Codebase timed out after ${Math.round((options.timeoutMs ?? 0) / 1000)}s.`,
            ),
          );
          return;
        }
        resolveCall({
          exitCode: code ?? 0,
          isError: (code ?? 0) !== 0,
          stderr: stripAnsi(stderr.trim()),
          text: stripAnsi(stdout.trim()),
        });
      });
    });
  });

function abortError(): Error {
  const error = new Error("Fast Codebase cancelled.");
  error.name = "AbortError";
  return error;
}

function pathKey(path: string): string {
  const value = resolve(path);
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

function details(input: {
  indexed: boolean;
  query: string;
  workspace: string;
}): FastCodebaseResult["details"] {
  return {
    indexDir: codeGraphIndexDir(input.workspace),
    indexed: input.indexed,
    kernel: resolveFastCodebaseBinary(),
    project: basename(input.workspace),
    query: input.query,
    workspace: input.workspace,
  };
}

function skippedResult(input: {
  query: string;
  reason: string;
  workspace: string;
}): FastCodebaseResult {
  return {
    text: [
      "# Fast Codebase",
      `Workspace: ${input.workspace}`,
      "Index: skipped",
      "",
      input.reason,
      "",
      "Next: use a workspace_path inside the current workspace, or fall back to read/grep/find for this turn.",
    ].join("\n"),
    details: details({
      indexed: false,
      query: input.query,
      workspace: input.workspace,
    }),
  };
}

function failureText(result: CodeGraphCallResult): string {
  const text = result.text.trim();
  const stderr = result.stderr.trim();
  const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-12).join("\n");
  return (
    [text, tail ? `stderr:\n${tail}` : ""].filter(Boolean).join("\n\n") ||
    `codegraph exited with code ${result.exitCode} and no output.`
  );
}

function parseStatus(result: CodeGraphCallResult): { pending: boolean } {
  try {
    const status = JSON.parse(result.text) as {
      pendingChanges?: { added?: number; modified?: number; removed?: number };
      worktreeMismatch?: unknown;
    };
    const pending = status.pendingChanges;
    return {
      pending:
        Boolean(status.worktreeMismatch) ||
        Boolean((pending?.added ?? 0) + (pending?.modified ?? 0) + (pending?.removed ?? 0)),
    };
  } catch {
    return { pending: false };
  }
}

function exactHitsText(text: string, limit: number): string {
  try {
    const results = JSON.parse(text) as CodeGraphQueryResult[];
    if (!Array.isArray(results)) {
      return "";
    }
    const hits = results
      .map(({ node }) => {
        if (!node?.filePath) {
          return undefined;
        }
        const line = typeof node.startLine === "number" ? `:${node.startLine}` : "";
        const symbol = node.qualifiedName ?? node.name;
        const label = [node.kind, symbol].filter(Boolean).join(" ");
        return `- ${node.filePath}${line}${label ? ` — ${label}` : ""}`;
      })
      .filter((line): line is string => Boolean(line))
      .slice(0, limit);
    return hits.length ? `**Exact hits**\n\n${hits.join("\n")}\n\n` : "";
  } catch {
    return "";
  }
}

type IndexFlight = {
  callbacks: Set<(progress: FastCodebaseProgress) => void>;
  controller: AbortController;
  promise: Promise<"created">;
  waiters: number;
};

const indexFlights = new Map<string, IndexFlight>();

function joinIndexFlight(
  flight: IndexFlight,
  input: Pick<FastCodebaseInput, "onProgress" | "signal">,
): Promise<"created"> {
  if (input.signal?.aborted) {
    return Promise.reject(abortError());
  }
  let done = false;
  flight.waiters += 1;
  if (input.onProgress) {
    flight.callbacks.add(input.onProgress);
  }
  return new Promise<"created">((resolvePromise, reject) => {
    const cleanup = (): void => {
      if (done) {
        return;
      }
      done = true;
      flight.waiters -= 1;
      if (input.onProgress) {
        flight.callbacks.delete(input.onProgress);
      }
      input.signal?.removeEventListener("abort", abort);
    };
    const abort = (): void => {
      cleanup();
      if (flight.waiters === 0) {
        flight.controller.abort();
      }
      reject(abortError());
    };
    input.signal?.addEventListener("abort", abort, { once: true });
    flight.promise.then(
      (state) => {
        cleanup();
        resolvePromise(state);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

async function initWorkspace(input: {
  cwd: string;
  onProgress?: ((progress: FastCodebaseProgress) => void) | undefined;
  runner: CodeGraphRunner;
  signal?: AbortSignal | undefined;
}): Promise<"created"> {
  input.onProgress?.({ phase: "indexing", message: "Initializing CodeGraph index..." });
  const result = await input.runner(["init", input.cwd, "--verbose"], {
    cwd: input.cwd,
    signal: input.signal,
    timeoutMs: INDEX_TIMEOUT_MS,
    onProgress: (line) => input.onProgress?.({ phase: "indexing", message: line }),
  });
  if (result.isError) {
    throw new Error(`Fast Codebase indexing failed:\n${failureText(result)}`);
  }
  return "created";
}

async function initWorkspaceSingleFlight(
  input: {
    cwd: string;
    runner: CodeGraphRunner;
  } & Pick<FastCodebaseInput, "onProgress" | "signal">,
): Promise<"created"> {
  const key = pathKey(input.cwd);
  let flight = indexFlights.get(key);
  if (!flight) {
    const controller = new AbortController();
    const callbacks = new Set<(progress: FastCodebaseProgress) => void>();
    flight = {
      callbacks,
      controller,
      promise: Promise.resolve()
        .then(() =>
          initWorkspace({
            cwd: input.cwd,
            runner: input.runner,
            signal: controller.signal,
            onProgress: (progress) => {
              for (const callback of callbacks) {
                callback(progress);
              }
            },
          }),
        )
        .finally(() => indexFlights.delete(key)),
      waiters: 0,
    };
    indexFlights.set(key, flight);
  }
  return joinIndexFlight(flight, input);
}

async function ensureIndexed(input: {
  cwd: string;
  onProgress?: ((progress: FastCodebaseProgress) => void) | undefined;
  runner: CodeGraphRunner;
  signal?: AbortSignal | undefined;
}): Promise<"created" | "synced" | "ready"> {
  if (!isCodeGraphInitialized(input.cwd)) {
    return initWorkspaceSingleFlight(input);
  }
  const status = await input.runner(["status", input.cwd, "--json"], {
    cwd: input.cwd,
    signal: input.signal,
    timeoutMs: QUERY_TIMEOUT_MS,
  });
  if (status.isError) {
    throw new Error(`Fast Codebase status failed:\n${failureText(status)}`);
  }
  if (!parseStatus(status).pending) {
    return "ready";
  }
  input.onProgress?.({ phase: "indexing", message: "Syncing CodeGraph index..." });
  const synced = await input.runner(["sync", input.cwd], {
    cwd: input.cwd,
    signal: input.signal,
    timeoutMs: INDEX_TIMEOUT_MS,
    onProgress: (line) => input.onProgress?.({ phase: "indexing", message: line }),
  });
  if (synced.isError) {
    throw new Error(`Fast Codebase sync failed:\n${failureText(synced)}`);
  }
  return "synced";
}

async function queryCodeGraph(input: {
  cwd: string;
  includeCode: boolean;
  limit: number;
  query: string;
  runner: CodeGraphRunner;
  signal?: AbortSignal | undefined;
  onProgress?: ((progress: FastCodebaseProgress) => void) | undefined;
}): Promise<string> {
  input.onProgress?.({ phase: "querying", message: "Querying CodeGraph..." });
  const exact = await input.runner(
    ["query", "-p", input.cwd, "-l", String(input.limit), "--json", input.query],
    {
      cwd: input.cwd,
      signal: input.signal,
      timeoutMs: QUERY_TIMEOUT_MS,
    },
  );
  const exploreArgs = [
    "explore",
    "-p",
    input.cwd,
    "--max-files",
    String(input.includeCode ? Math.min(input.limit, SOURCE_FILE_LIMIT) : 1),
    input.query,
  ];
  const result = await input.runner(exploreArgs, {
    cwd: input.cwd,
    signal: input.signal,
    timeoutMs: QUERY_TIMEOUT_MS,
  });
  if (result.isError) {
    throw new Error(`Fast Codebase query failed:\n${failureText(result)}`);
  }
  return capResultBody(
    `How to use this map:
- Read exact hit line ranges first, not whole files.
- Prefer small reads around listed lines.
- If it is close but missing exact evidence, ask fast_codebase again with a narrower query using the files, symbols, APIs, or relationships below.
- Keep follow-up maps coordinate-first; use include_code only for a narrow implementation lookup.
- Use grep for exact text existence or absence checks, preferably scoped to files or directories found here.

${exact.isError ? "" : exactHitsText(exact.text, input.limit)}**Code map**

${result.text.replaceAll("codegraph_explore", "fast_codebase")}`,
  );
}

function snapshot(cwd: string): string | undefined {
  const dbPath = join(codeGraphIndexDir(cwd), "codegraph.db");
  return existsSync(dbPath) ? statSync(dbPath).mtime.toISOString() : undefined;
}

export async function runFastCodebase(input: FastCodebaseInput): Promise<FastCodebaseResult> {
  const baseCwd = resolve(input.cwd);
  const cwd = input.workspacePath ? resolve(baseCwd, input.workspacePath) : baseCwd;
  const limit = Math.max(1, Math.min(input.limit ?? 8, 12));
  const runner = input.runner ?? runCodeGraphCli;
  if (!isPathInside(baseCwd, cwd)) {
    return skippedResult({
      query: input.query,
      reason: `Fast Codebase did not start indexing because workspace_path is outside the current workspace: ${cwd}`,
      workspace: cwd,
    });
  }
  const indexState = await ensureIndexed({
    cwd,
    onProgress: input.onProgress,
    runner,
    signal: input.signal,
  });
  const body = await queryCodeGraph({
    cwd,
    includeCode: input.includeCode ?? false,
    limit,
    query: input.query,
    runner,
    signal: input.signal,
    onProgress: input.onProgress,
  });
  const text = [
    "# Fast Codebase",
    `Workspace: ${cwd}`,
    `Index: ${indexState} (CodeGraph local index; read current files before editing)${
      snapshot(cwd) ? ` (snapshot: ${snapshot(cwd)})` : ""
    }`,
    "",
    body,
  ].join("\n");
  return {
    text,
    details: details({
      indexed: true,
      query: input.query,
      workspace: cwd,
    }),
  };
}
