import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const OUTPUT_CAP = 60_000;
const STDERR_CAP = 20_000;
const INDEX_TIMEOUT_MS = 5 * 60_000;
const OVERVIEW_LIMIT = 5;

type JsonObject = Record<string, unknown>;

export type FastCodebaseProgress = {
  phase: "indexing" | "querying";
  message: string;
};

export type FastCodebaseResult = {
  text: string;
  details: {
    cacheDir: string;
    candidateWorkspaces?: string[];
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
    timeoutMs?: number | undefined;
    onProgress?: ((line: string) => void) | undefined;
  },
) => Promise<CbmCallResult>;

export type FastCodebaseInput = {
  cacheDir: string;
  cwd: string;
  includeCode?: boolean | undefined;
  limit?: number | undefined;
  query: string;
  workspacePath?: string | undefined;
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

function pathKey(path: string): string {
  const value = resolve(path);
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function samePath(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right);
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

function gitRoot(cwd: string): string | undefined {
  const result = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    return undefined;
  }
  const root = result.stdout.trim();
  return root ? resolve(root) : undefined;
}

function directChildGitRoots(cwd: string): string[] {
  try {
    return readdirSync(cwd, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(cwd, entry.name))
      .filter((child) => {
        const root = gitRoot(child);
        return root ? samePath(root, child) : false;
      });
  } catch {
    return [];
  }
}

function skippedResult(input: {
  cacheDir: string;
  candidateWorkspaces?: string[];
  query: string;
  reason: string;
  workspace: string;
}): FastCodebaseResult {
  const candidates = input.candidateWorkspaces ?? [];
  const next =
    candidates.length > 0
      ? "Next: call fast_codebase again with workspace_path set to one candidate."
      : "Next: switch to a valid git workspace, or fall back to read/grep/find for this turn.";
  const candidateText =
    candidates.length > 0
      ? ["Candidate workspaces:", ...candidates.map((path) => `- ${path}`)].join("\n")
      : "Candidate workspaces: none";
  return {
    text: [
      "# Fast Codebase",
      `Workspace: ${input.workspace}`,
      "Index: skipped",
      "",
      input.reason,
      "",
      candidateText,
      "",
      next,
    ].join("\n"),
    details: {
      cacheDir: input.cacheDir,
      ...(candidates.length > 0 ? { candidateWorkspaces: candidates } : {}),
      indexed: false,
      kernel: resolveFastCodebaseBinary(),
      project: projectNameFromPath(input.workspace),
      query: input.query,
      workspace: input.workspace,
    },
  };
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
    let timedOut = false;
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
        if (timedOut) {
          reject(
            new Error(
              `Fast Codebase timed out after ${Math.round((options.timeoutMs ?? 0) / 1000)}s.`,
            ),
          );
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

function cleanPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function gitTrackedFiles(cwd: string): Set<string> | undefined {
  const result = spawnSync("git", ["-C", cwd, "ls-files", "-z", "--cached", "--", "."], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    return undefined;
  }
  const files = result.stdout
    .split("\0")
    .map(cleanPath)
    .filter((file) => file && !file.startsWith(".modus/"));
  return files.length > 0 ? new Set(files) : undefined;
}

function configuredGeneratedFiles(files: Set<string>, cwd: string): Set<string> {
  const prefixes = new Set<string>();
  for (const file of files) {
    if (!/(^|\/)tsconfig[^/]*\.json$/i.test(file)) {
      continue;
    }
    let config: JsonObject | undefined;
    try {
      config = asObject(parseMaybeJson(readFileSync(join(cwd, file), "utf8")));
    } catch {
      continue;
    }
    const outDir = asObject(config?.compilerOptions)?.outDir;
    if (typeof outDir !== "string" || !outDir.trim()) {
      continue;
    }
    prefixes.add(cleanPath(join(dirname(file), outDir)).replace(/\/+$/, ""));
  }
  return new Set(
    [...files].filter((file) =>
      [...prefixes].some(
        (prefix) => file.startsWith(`${prefix}/`) || file.startsWith(`${prefix}-`),
      ),
    ),
  );
}

function pruneIndexToGitTracked(dbPath: string, cwd: string): Set<string> | undefined {
  const files = gitTrackedFiles(cwd);
  if (!files || !existsSync(dbPath)) {
    return files;
  }
  const generatedFiles = configuredGeneratedFiles(files, cwd);
  const keptFiles = new Set([...files].filter((file) => !generatedFiles.has(file)));
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("begin");
    db.exec("create temp table if not exists allowed_files(path text primary key) without rowid");
    db.exec("create temp table if not exists generated_files(path text primary key) without rowid");
    db.exec("delete from allowed_files");
    db.exec("delete from generated_files");
    const insert = db.prepare("insert into allowed_files(path) values (?)");
    for (const file of keptFiles) {
      insert.run(file);
    }
    const insertGenerated = db.prepare("insert into generated_files(path) values (?)");
    for (const file of generatedFiles) {
      insertGenerated.run(file);
    }
    db.exec(`
      create temp table removed_nodes as
      select id from nodes
      where file_path <> ''
        and (file_path like '.modus/%'
          or exists (select 1 from generated_files where generated_files.path = nodes.file_path)
          or not exists (
          select 1 from allowed_files where allowed_files.path = nodes.file_path
        ))
    `);
    db.exec(`
      delete from edges
      where source_id in (select id from removed_nodes)
         or target_id in (select id from removed_nodes)
    `);
    db.exec("delete from nodes where id in (select id from removed_nodes)");
    db.exec(`
      delete from file_hashes
      where rel_path like '.modus/%'
         or exists (select 1 from generated_files where generated_files.path = file_hashes.rel_path)
         or not exists (select 1 from allowed_files where allowed_files.path = file_hashes.rel_path)
    `);
    db.exec("drop table removed_nodes");
    db.exec("commit");
  } catch (error) {
    try {
      db.exec("rollback");
    } catch {
      // Keep the original failure.
    }
    throw error;
  } finally {
    db.close();
  }
  return keptFiles;
}

function hasLanguage(root: JsonObject, language: string): boolean {
  const languages = Array.isArray(root.languages) ? root.languages : [];
  return languages.some((item) => asObject(item)?.language === language);
}

function itemFile(item: unknown): string {
  const obj = asObject(item);
  const file = obj?.file ?? obj?.file_path;
  return typeof file === "string" ? cleanPath(file).toLowerCase() : "";
}

function sourceRank(item: unknown, root: JsonObject): number {
  const file = itemFile(item);
  if (!file) {
    return 0;
  }
  if (/\.d\.ts$/.test(file)) {
    return 1;
  }
  if (hasLanguage(root, "TypeScript") && /\.(js|jsx)$/.test(file)) {
    return 1;
  }
  return 0;
}

function takeArray(root: JsonObject, key: string, limit: number): unknown[] | undefined {
  const value = root[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const ranked = [...value].sort((a, b) => sourceRank(a, root) - sourceRank(b, root));
  const preferred = ranked.filter((item) => sourceRank(item, root) === 0);
  return (preferred.length > 0 ? preferred : ranked).slice(0, limit);
}

function addFile(value: unknown, files: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      addFile(item, files);
    }
    return;
  }
  const obj = asObject(value);
  if (!obj) {
    return;
  }
  for (const key of ["file", "file_path"]) {
    const file = obj[key];
    if (typeof file === "string" && file) {
      files.push(cleanPath(file));
    }
  }
}

function suggestedReads(
  root: JsonObject,
  indexedFiles: Set<string> | undefined,
  limit: number,
): string[] {
  const files: string[] = [];
  if (indexedFiles) {
    for (const file of indexedFiles) {
      if (/(^|\/)(readme\.md|package\.json)$/i.test(file)) {
        files.push(file);
      }
    }
  }
  addFile(root.entry_points, files);
  addFile(root.routes, files);
  addFile(root.hotspots, files);
  return [...new Set(files.filter((file) => !file.startsWith(".modus/")))].slice(0, limit);
}

function formatArchitectureOverview(
  result: CbmCallResult,
  indexedFiles: Set<string> | undefined,
): string {
  const root = asObject(result.json);
  if (!root) {
    return formatKernelResult("Architecture Overview", result);
  }
  const body: JsonObject = {};
  for (const key of ["project", "total_nodes", "total_edges"]) {
    if (root[key] !== undefined) {
      body[key] = root[key];
    }
  }
  for (const key of [
    "languages",
    "packages",
    "entry_points",
    "routes",
    "hotspots",
    "node_labels",
    "edge_types",
  ]) {
    const items = takeArray(root, key, OVERVIEW_LIMIT);
    if (items) {
      body[key] = items;
    }
  }
  const reads = suggestedReads(body, indexedFiles, OVERVIEW_LIMIT);
  if (reads.length > 0) {
    body.suggested_reads = reads;
  }
  return `## Architecture Overview\n\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\``;
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

type IndexFlight = {
  callbacks: Set<(progress: FastCodebaseProgress) => void>;
  controller: AbortController;
  promise: Promise<string>;
  waiters: number;
};

const indexFlights = new Map<string, IndexFlight>();

function indexFlightKey(cacheDir: string, cwd: string): string {
  return `${pathKey(cacheDir)}\0${pathKey(cwd)}`;
}

function joinIndexFlight(
  flight: IndexFlight,
  input: Pick<FastCodebaseInput, "onProgress" | "signal">,
): Promise<string> {
  if (input.signal?.aborted) {
    return Promise.reject(abortError());
  }
  let done = false;
  flight.waiters += 1;
  if (input.onProgress) {
    flight.callbacks.add(input.onProgress);
  }
  return new Promise<string>((resolvePromise, reject) => {
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
      (project) => {
        cleanup();
        resolvePromise(project);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

async function runIndexWorkspace(
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
      timeoutMs: INDEX_TIMEOUT_MS,
      onProgress: (line) => input.onProgress?.({ phase: "indexing", message: line }),
    },
  );
  if (result.isError) {
    throw new Error(`Fast Codebase indexing failed:\n${failureText(result)}`);
  }
  const project = asObject(result.json)?.project;
  return typeof project === "string" && project ? project : projectNameFromPath(input.cwd);
}

async function indexWorkspace(
  input: Required<Pick<FastCodebaseInput, "cacheDir" | "cwd">> &
    Pick<FastCodebaseInput, "onProgress" | "runner" | "signal">,
): Promise<string> {
  const key = indexFlightKey(input.cacheDir, input.cwd);
  let flight = indexFlights.get(key);
  if (!flight) {
    const controller = new AbortController();
    const callbacks = new Set<(progress: FastCodebaseProgress) => void>();
    flight = {
      callbacks,
      controller,
      promise: Promise.resolve()
        .then(() =>
          runIndexWorkspace({
            ...input,
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
  indexedFiles?: Set<string> | undefined;
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
  let primary = overview
    ? formatArchitectureOverview(result, input.indexedFiles)
    : formatKernelResult("Search Results", result);
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
  const baseCwd = resolve(input.cwd);
  const cwd = input.workspacePath ? resolve(baseCwd, input.workspacePath) : baseCwd;
  const cacheDir = resolve(input.cacheDir);
  const limit = Math.max(1, Math.min(input.limit ?? 8, 12));
  const runner = input.runner ?? runCbmCli;
  mkdirSync(cacheDir, { recursive: true });
  if (!isPathInside(baseCwd, cwd)) {
    return skippedResult({
      cacheDir,
      query: input.query,
      reason: `Fast Codebase did not start indexing because workspace_path is outside the current workspace: ${cwd}`,
      workspace: cwd,
    });
  }
  const root = gitRoot(cwd);
  if (!root || !samePath(root, cwd)) {
    return skippedResult({
      cacheDir,
      candidateWorkspaces: input.workspacePath ? [] : directChildGitRoots(baseCwd),
      query: input.query,
      reason:
        "Fast Codebase did not start indexing because the selected workspace is not a valid git root.",
      workspace: cwd,
    });
  }
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
  const indexedFiles = pruneIndexToGitTracked(dbPath, cwd);
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
    indexedFiles,
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
      indexedFiles: pruneIndexToGitTracked(join(cacheDir, `${project}.db`), cwd),
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
