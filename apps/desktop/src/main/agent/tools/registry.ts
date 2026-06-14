import type { ToolCallEvent, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PermissionAction } from "../../../shared/contracts";
import {
  BUILTIN_TOOL_CATALOG,
  type ToolCatalogEntry,
  type ToolProfileName,
} from "../../../shared/tools";

/**
 * Runtime tool registry. Wraps the shared catalog with PI-SDK-dependent behavior:
 * dynamic permission classification and custom-tool registration. Built-in tools
 * come from the shared catalog; custom tools are registered at runtime and flow
 * through the same activation/permission/UI pipeline.
 */

export type ToolClassification = {
  action: PermissionAction;
  dangerous: boolean;
};

export type ToolClassifier = (event: ToolCallEvent) => ToolClassification;

/** Per-session adjustments layered on top of a profile's default active set. */
export type ToolOverrides = {
  enable?: string[];
  disable?: string[];
};

export type RegisterToolInput = {
  /** Catalog metadata; `kind` is forced to "custom". */
  entry: Omit<ToolCatalogEntry, "kind">;
  /** The PI tool definition handed to `createAgentSession({ customTools })`. */
  definition: ToolDefinition;
  /** Optional dynamic permission classifier (for tools whose risk depends on args). */
  classify?: ToolClassifier;
};

const DEFAULT_ACTION: PermissionAction = "mcp.call";

/** Primary target string for a tool call (command, path, else the raw input). */
export function getToolTarget(event: ToolCallEvent): string {
  if ("command" in event.input && typeof event.input.command === "string") {
    return event.input.command;
  }
  if ("path" in event.input && typeof event.input.path === "string") {
    return event.input.path;
  }
  return JSON.stringify(event.input);
}

function isGitWriteCommand(command: string): boolean {
  return /\bgit\s+(commit|push|reset|clean|checkout\s+--|restore\b|branch\s+-D|worktree\s+remove|stash\s+(drop|clear))\b/i.test(
    command,
  );
}

function isMutatingShellCommand(command: string): boolean {
  return /\b(rm|mv|touch|chmod|chown)\b|(^|\s)(>|>>|<<)\s*|\b(npm|pnpm|yarn)\s+(i|install|add)\b/i.test(
    command,
  );
}

/**
 * Risk verdict for a raw shell command string. Shared by the built-in `bash`
 * tool and the custom `terminal_run` tool so both gate dangerous commands the
 * same way: git-write and mutating commands prompt; everything else runs.
 */
export function classifyShellCommand(command: string): ToolClassification {
  if (isGitWriteCommand(command)) {
    return { action: "git.write", dangerous: true };
  }
  return { action: "shell.execute", dangerous: isMutatingShellCommand(command) };
}

/** Built-in bash classifier: only git-write / mutating commands require approval. */
const bashClassifier: ToolClassifier = (event) => classifyShellCommand(getToolTarget(event));

function abortError(): Error {
  const error = new Error("Tool call aborted by user.");
  error.name = "AbortError";
  return error;
}

/**
 * Resolve `run()` normally, but reject as soon as `signal` aborts. PI passes a
 * per-call AbortSignal to every tool's `execute`; built-in tools honor it, but a
 * custom tool that ignores it (a browser click/wait, a web fetch, a terminal
 * read) keeps running after the user hits Stop. Because `AgentSession.abort()`
 * waits for the agent to go idle, that one un-cancellable tool blocks the whole
 * abort and the run appears stuck on "Working". Racing the work against the
 * signal lets abort settle immediately.
 */
function raceAbort<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  if (!signal) {
    return run();
  }
  if (signal.aborted) {
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    run().then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Make a custom tool's `execute` cancellable by honoring the AbortSignal PI hands
 * it (the third argument). Applied once at registration so every custom tool —
 * present and future — is abortable without per-tool changes. Definitions without
 * an `execute` (e.g. test stubs) pass through untouched.
 */
function makeToolAbortable(definition: ToolDefinition): ToolDefinition {
  const execute = definition.execute;
  if (typeof execute !== "function") {
    return definition;
  }
  return {
    ...definition,
    execute: (...args: Parameters<typeof execute>) =>
      raceAbort(args[2] as AbortSignal | undefined, () => execute(...args)),
  };
}

export class ToolRegistry {
  private readonly entries = new Map<string, ToolCatalogEntry>();
  private readonly definitions = new Map<string, ToolDefinition>();
  private readonly classifiers = new Map<string, ToolClassifier>();

  constructor(builtins: ToolCatalogEntry[] = BUILTIN_TOOL_CATALOG) {
    for (const entry of builtins) {
      this.entries.set(entry.name, entry);
    }
    this.classifiers.set("bash", bashClassifier);
  }

  /** Register a custom LLM-callable tool. It joins the activation/permission/UI pipeline. */
  registerTool(input: RegisterToolInput): void {
    const entry: ToolCatalogEntry = { ...input.entry, kind: "custom" };
    this.entries.set(entry.name, entry);
    // Wrap once so every custom tool honors the abort signal (see makeToolAbortable).
    this.definitions.set(entry.name, makeToolAbortable(input.definition));
    if (input.classify) {
      this.classifiers.set(entry.name, input.classify);
    }
  }

  /** Remove a previously registered custom tool (no-op for builtins/unknown). */
  unregisterTool(name: string): void {
    if (this.entries.get(name)?.kind !== "custom") {
      return;
    }
    this.entries.delete(name);
    this.definitions.delete(name);
    this.classifiers.delete(name);
  }

  /** Active tool names for a profile → `createAgentSession({ tools })`. */
  resolveActiveTools(profile: ToolProfileName, overrides?: ToolOverrides): string[] {
    const active = new Set<string>();
    for (const entry of this.entries.values()) {
      if (entry.profiles.includes(profile)) {
        active.add(entry.name);
      }
    }
    for (const name of overrides?.enable ?? []) {
      active.add(name);
    }
    for (const name of overrides?.disable ?? []) {
      active.delete(name);
    }
    return [...active];
  }

  /** Custom tool definitions active for a profile → `createAgentSession({ customTools })`. */
  getCustomToolDefinitions(profile: ToolProfileName, overrides?: ToolOverrides): ToolDefinition[] {
    const active = new Set(this.resolveActiveTools(profile, overrides));
    const definitions: ToolDefinition[] = [];
    for (const [name, definition] of this.definitions) {
      if (active.has(name)) {
        definitions.push(definition);
      }
    }
    return definitions;
  }

  /** Decide whether a tool call needs approval and under which permission action. */
  classify(event: ToolCallEvent): ToolClassification {
    const classifier = this.classifiers.get(event.toolName);
    if (classifier) {
      return classifier(event);
    }
    const entry = this.entries.get(event.toolName);
    if (entry) {
      return {
        action: entry.permission.action ?? DEFAULT_ACTION,
        dangerous: entry.permission.danger !== "safe",
      };
    }
    // Unregistered tool: preserve the legacy name heuristic (permissive except delete/remove).
    if (/delete|remove/i.test(event.toolName)) {
      return { action: "file.delete", dangerous: true };
    }
    return { action: DEFAULT_ACTION, dangerous: false };
  }

  getEntry(name: string): ToolCatalogEntry | undefined {
    return this.entries.get(name);
  }
}

/** Process-wide registry seeded with the built-in tools. */
export const toolRegistry = new ToolRegistry();
