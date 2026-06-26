import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const OUTPUT_CAP = 60_000;
const STDERR_CAP = 20_000;

type JsonObject = Record<string, unknown>;

export type FastCodebaseProgress = {
  phase: "indexing" | "querying";
  message: string;
};

export type FastCodebaseResult = {
  text: string;
  details: {
    cacheDir: string;
    indexed: boolean;
    kernel: string;
    project: string;
    query: string;
    workspace: string;
  };
};

type CbmCallResult = {
  exitCode: number;
  isError: boolean;
  json?: unknown;
  stderr: string;
  text: string;
  tool: string;
};

export type CbmRunner = (
  tool: string,
  args: JsonObject,
  options: {
    cacheDir: string;
    cwd: string;
    progress?: boolean | undefined;
    signal?: AbortSignal | undefined;
    onProgress?: ((line: string) => void) | undefined;
  },
) => Promise<CbmCallResult>;

export type FastCodebaseInput = {
  cacheDir: string;
  cwd: string;
  includeCode?: boolean | undefined;
  limit?: number | undefined;
  query: string;
  signal?: AbortSignal | undefined;
  onProgress?: ((progress: FastCodebaseProgress) => void) | undefined;
  runner?: CbmRunner | undefined;
};

function appendCapped(current: string, chunk: string, cap: number): string {
  const next = `${current}${chunk}`;
  return next.length > cap ? next.slice(next.length - cap) : next;
}

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function textFromEnvelope(stdout: string): { isError: boolean; json?: unknown; text: string } {
  const raw = stdout.trim();
  const envelope = parseMaybeJson(raw);
  if (!envelope || typeof envelope !== "object") {
    return { isError: false, text: raw };
  }
  const obj = envelope as JsonObject;
  const content = Array.isArray(obj.content) ? obj.content : [];
  const firstText = content
    .map((item) =>
      item && typeof item === "object" && typeof (item as JsonObject).text === "string"
        ? ((item as JsonObject).text as string)
        : "",
    )
    .find((text) => text.length > 0);
  const text = firstText ?? raw;
  const json = parseMaybeJson(text);
  return { isError: obj.isError === true, ...(json !== undefined ? { json } : {}), text };
}

export function fastCodebaseBinaryName(platform = process.platform): string {
  return platform === "win32" ? "codebase-memory-mcp.exe" : "codebase-memory-mcp";
}

export function resolveFastCodebaseBinary(): string {
  if (process.env.MODUS_FAST_CODEBASE_BIN) {
    return process.env.MODUS_FAST_CODEBASE_BIN;
  }
  const resourcesPath =
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? process.cwd();
  const bundled = join(resourcesPath, "bin", fastCodebaseBinaryName());
  if (existsSync(bundled)) {
    return bundled;
  }
  const devResource = join(process.cwd(), "resources", "bin", fastCodebaseBinaryName());
  return existsSync(devResource) ? devResource : fastCodebaseBinaryName();
}

export function projectNameFromPath(path: string): string {
  const normalized = resolve(path).replace(/\\/g, "/");
  let out = "";
  let prev = "";
  for (const char of normalized) {
    const safe = /[A-Za-z0-9._-]/.test(char) ? char : "-";
    if ((safe === "-" && prev === "-") || (safe === "." && prev === ".")) {
      continue;
    }
    out += safe;
    prev = safe;
  }
  out = out.replace(/^[-.]+/, "").replace(/-+$/, "");
  return out || "root";
}

export const runCbmCli: CbmRunner = (tool, args, options) =>
  new Promise<CbmCallResult>((resolveCall, reject) => {
    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }
    const command = resolveFastCodebaseBinary();
    const cliArgs = [
      "cli",
      "--json",
      ...(options.progress ? ["--progress"] : []),
      tool,
      JSON.stringify(args),
    ];
    let stdout = "";
    let stderr = "";
    let lastProgress = "";
    let aborted = false;
    let settled = false;
    const child = spawn(command, cliArgs, {
      cwd: options.cwd,
      env: {
        ...process.env,
        CBM_CACHE_DIR: options.cacheDir,
        CBM_LOG_LEVEL: process.env.CBM_LOG_LEVEL ?? "warn",
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const finish = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      options.signal?.removeEventListener("abort", abort);
      fn();
    };
    const abort = (): void => {
      aborted = true;
      child.kill("SIGTERM");
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => {
      stdout = appendCapped(stdout, String(chunk), OUTPUT_CAP);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr = appendCapped(stderr, text, STDERR_CAP);
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed && trimmed !== lastProgress) {
          lastProgress = trimmed;
          options.onProgress?.(trimmed);
        }
      }
    });
    child.on("error", (error) => {
      finish(() =>
        reject(
          new Error(
            `Fast Codebase kernel unavailable: ${error.message}. ` +
              "Install or bundle codebase-memory-mcp, or set MODUS_FAST_CODEBASE_BIN.",
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
        const parsed = textFromEnvelope(stdout);
        resolveCall({
          exitCode: code ?? 0,
          isError: parsed.isError || (code ?? 0) !== 0,
          ...(parsed.json !== undefined ? { json: parsed.json } : {}),
          stderr: stderr.trim(),
          text: parsed.text,
          tool,
        });
      });
    });
  });

function abortError(): Error {
  const error = new Error("Fast Codebase cancelled.");
  error.name = "AbortError";
  return error;
}

function isOverviewQuery(query: string): boolean {
  return (
    /\b(architecture|overview|structure|entry|map)\b/i.test(query) ||
    /架构|总览|结构|入口/.test(query)
  );
}

function isNotIndexed(result: CbmCallResult): boolean {
  return /index_repository|not indexed|No projects indexed|project not found/i.test(
    `${result.text}\n${result.stderr}`,
  );
}

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function resultItems(value: unknown): JsonObject[] {
  const root = asObject(value);
  const results = Array.isArray(root?.results) ? root.results : [];
  return results.filter((item): item is JsonObject => !!asObject(item));
}

function qnOf(item: JsonObject): string | undefined {
  return typeof item.qualified_name === "string" && item.qualified_name
    ? item.qualified_name
    : undefined;
}

function formatKernelResult(title: string, result: CbmCallResult): string {
  const body = result.json !== undefined ? JSON.stringify(result.json, null, 2) : result.text;
  const language = result.json !== undefined ? "json" : "";
  return `## ${title}\n\n\`\`\`${language}\n${body.slice(0, OUTPUT_CAP)}\n\`\`\``;
}

function failureText(result: CbmCallResult): string {
  const text = result.text.trim();
  const stderr = result.stderr.trim();
  if (!stderr || text.includes(stderr)) {
    return text || stderr;
  }
  const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-12).join("\n");
  return [text, tail ? `stderr:\n${tail}` : ""].filter(Boolean).join("\n\n");
}

function indexSnapshot(dbPath: string): string | undefined {
  if (!existsSync(dbPath)) {
    return undefined;
  }
  return statSync(dbPath).mtime.toISOString();
}

async function indexWorkspace(
  input: Required<Pick<FastCodebaseInput, "cacheDir" | "cwd">> &
    Pick<FastCodebaseInput, "onProgress" | "runner" | "signal">,
): Promise<string> {
  input.onProgress?.({ phase: "indexing", message: "Starting Fast Codebase index..." });
  const run = input.runner ?? runCbmCli;
  const result = await run(
    "index_repository",
    { repo_path: input.cwd, mode: "fast", persistence: false },
    {
      cacheDir: input.cacheDir,
      cwd: input.cwd,
      progress: true,
      signal: input.signal,
      onProgress: (line) => input.onProgress?.({ phase: "indexing", message: line }),
    },
  );
  if (result.isError) {
    throw new Error(`Fast Codebase indexing failed:\n${failureText(result)}`);
  }
  const project = asObject(result.json)?.project;
  return typeof project === "string" && project ? project : projectNameFromPath(input.cwd);
}

async function queryKernel(input: {
  cacheDir: string;
  cwd: string;
  includeCode: boolean;
  limit: number;
  project: string;
  query: string;
  runner: CbmRunner;
  signal?: AbortSignal | undefined;
  onProgress?: ((progress: FastCodebaseProgress) => void) | undefined;
}): Promise<{ body: string; result: CbmCallResult }> {
  const overview = isOverviewQuery(input.query);
  input.onProgress?.({
    phase: "querying",
    message: overview ? "Reading architecture..." : "Searching code graph...",
  });
  const result = overview
    ? await input.runner(
        "get_architecture",
        { project: input.project, aspects: ["all"] },
        { cacheDir: input.cacheDir, cwd: input.cwd, signal: input.signal },
      )
    : await input.runner(
        "search_graph",
        { project: input.project, query: input.query, include_connected: true, limit: input.limit },
        { cacheDir: input.cacheDir, cwd: input.cwd, signal: input.signal },
      );
  if (result.isError) {
    return { body: failureText(result), result };
  }
  let primary = formatKernelResult(overview ? "Architecture Overview" : "Search Results", result);
  if (!overview && resultItems(result.json).length === 0) {
    input.onProgress?.({ phase: "querying", message: "Search was empty; reading architecture..." });
    const fallback = await input.runner(
      "get_architecture",
      { project: input.project, aspects: ["all"] },
      { cacheDir: input.cacheDir, cwd: input.cwd, signal: input.signal },
    );
    if (!fallback.isError) {
      primary = `${primary}\n\n${formatKernelResult("Architecture Fallback", fallback)}`;
    }
  }
  if (overview || !input.includeCode) {
    return { body: primary, result };
  }
  input.onProgress?.({ phase: "querying", message: "Reading source snippets..." });
  const snippets: string[] = [];
  for (const qn of resultItems(result.json).map(qnOf).filter(Boolean).slice(0, 3)) {
    const snippet = await input.runner(
      "get_code_snippet",
      { project: input.project, qualified_name: qn, include_neighbors: false },
      { cacheDir: input.cacheDir, cwd: input.cwd, signal: input.signal },
    );
    if (!snippet.isError) {
      snippets.push(formatKernelResult(`Snippet: ${qn}`, snippet));
    }
  }
  return {
    body:
      snippets.length > 0
        ? `${primary}\n\n## Source Snippets\n\n${snippets.join("\n\n")}`
        : primary,
    result,
  };
}

export async function runFastCodebase(input: FastCodebaseInput): Promise<FastCodebaseResult> {
  const cwd = resolve(input.cwd);
  const cacheDir = resolve(input.cacheDir);
  const limit = Math.max(1, Math.min(input.limit ?? 12, 50));
  const runner = input.runner ?? runCbmCli;
  mkdirSync(cacheDir, { recursive: true });
  let project = projectNameFromPath(cwd);
  let dbPath = join(cacheDir, `${project}.db`);
  let indexed = false;
  if (!existsSync(dbPath)) {
    project = await indexWorkspace({
      cacheDir,
      cwd,
      onProgress: input.onProgress,
      runner,
      signal: input.signal,
    });
    dbPath = join(cacheDir, `${project}.db`);
    indexed = true;
  }
  let queried = await queryKernel({
    cacheDir,
    cwd,
    includeCode: input.includeCode ?? false,
    limit,
    project,
    query: input.query,
    runner,
    signal: input.signal,
    onProgress: input.onProgress,
  });
  if (queried.result.isError && isNotIndexed(queried.result)) {
    project = await indexWorkspace({
      cacheDir,
      cwd,
      onProgress: input.onProgress,
      runner,
      signal: input.signal,
    });
    indexed = true;
    queried = await queryKernel({
      cacheDir,
      cwd,
      includeCode: input.includeCode ?? false,
      limit,
      project,
      query: input.query,
      runner,
      signal: input.signal,
      onProgress: input.onProgress,
    });
  }
  if (queried.result.isError) {
    throw new Error(`Fast Codebase query failed:\n${queried.body}`);
  }
  const snapshot = indexSnapshot(dbPath);
  const text = [
    `# Fast Codebase`,
    `Workspace: ${cwd}`,
    `Project: ${project}`,
    `Index: ${indexed ? "created" : "cache hit"}${
      snapshot ? ` (snapshot: ${snapshot}; read current files before editing)` : ""
    }`,
    "",
    queried.body,
  ].join("\n");
  return {
    text,
    details: {
      cacheDir,
      indexed,
      kernel: resolveFastCodebaseBinary(),
      project,
      query: input.query,
      workspace: cwd,
    },
  };
}
