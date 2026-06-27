import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

const OUTPUT_CAP = 60_000;
const STDERR_CAP = 20_000;
const SOURCE_FILE_LIMIT = 3;
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
    signature?: string;
  };
  score?: number;
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

function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean),
    ),
  ];
}

function queryResultRank(result: CodeGraphQueryResult, terms: string[]): number {
  const node = result.node;
  if (!node) {
    return 0;
  }
  const text = [node.name, node.qualifiedName, node.filePath, node.signature]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const matchScore = terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
  const kindScore =
    {
      file: 4,
      class: 4,
      function: 4,
      method: 4,
      interface: 3,
      struct: 3,
      type_alias: 3,
      field: 1,
      property: 1,
      variable: 1,
      enum: -3,
      enum_member: -3,
      import: -4,
    }[node.kind ?? ""] ?? 0;
  return matchScore + kindScore;
}

function rankedQueryText(text: string, query: string, limit: number): string {
  try {
    const results = JSON.parse(text) as CodeGraphQueryResult[];
    if (!Array.isArray(results)) {
      return text;
    }
    const terms = queryTerms(query);
    return JSON.stringify(
      results
        .sort(
          (left, right) =>
            queryResultRank(right, terms) - queryResultRank(left, terms) ||
            (right.score ?? 0) - (left.score ?? 0),
        )
        .slice(0, limit),
      null,
      2,
    );
  } catch {
    return text;
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
  const queryLimit = Math.min(input.limit * 4, 48);
  const args = input.includeCode
    ? [
        "explore",
        "-p",
        input.cwd,
        "--max-files",
        String(Math.min(input.limit, SOURCE_FILE_LIMIT)),
        input.query,
      ]
    : ["query", "-p", input.cwd, "-l", String(queryLimit), "--json", input.query];
  const result = await input.runner(args, {
    cwd: input.cwd,
    signal: input.signal,
    timeoutMs: QUERY_TIMEOUT_MS,
  });
  if (result.isError) {
    throw new Error(`Fast Codebase query failed:\n${failureText(result)}`);
  }
  return (
    input.includeCode ? result.text : rankedQueryText(result.text, input.query, input.limit)
  ).slice(0, OUTPUT_CAP);
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
